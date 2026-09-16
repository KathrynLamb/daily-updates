// src/evaluations.ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "./db.js";
import {
  decideEvaluation,
  evaluateDraft,
  evaluatorVersion,
} from "./evaluator.js";
import { sourcesAreCurrent } from "./source-freshness.js";
import { staffRolesFor } from "./authorization.js";
import {
  reviewModel,
  rubricVersion,
  rubric,
} from "./content-reviewer.js";

const paramsSchema = z.object({
  revisionId: z.uuid(),
});

const rulesSchema = z.strictObject({
  maxCharacters: z.number().int().min(1).max(5000),
  minSources: z.number().int().min(1),
});

export async function evaluationRoutes(app: FastifyInstance) {
  app.post("/revisions/:revisionId/evaluations", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);

    if (!params.success) {
      return reply.code(400).send({
        error: "Invalid revision ID",
      });
    }

    const actor = request.actor;

    if (!actor) {
      throw new Error(
        "Protected route reached without an authenticated actor"
      );
    }

    const permittedRoles = staffRolesFor("evaluation:create");
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Access is checked before any evidence is read. The revision,
      // its source snapshot, the current observations and the stored
      // AI review all belong to one setting, so nothing below may run
      // for a user outside it.
      //
      // Locking the child, membership and user rows means access
      // cannot be revoked between this check and the evaluation
      // being recorded.
      const revisions = await client.query<{
        id: string;
        text: string;
        source_snapshot: unknown[];
        child_id: string;
        observation_date: string;
      }>(
        `SELECT
           r.id,
           r.text,
           r.source_snapshot,
           u.child_id,
           u.observation_date::text AS observation_date
         FROM draft_revisions r
         JOIN updates u
           ON u.id = r.update_id
         JOIN children c
           ON c.id = u.child_id
         JOIN setting_memberships sm
           ON sm.setting_id = c.setting_id
         JOIN app_users au
           ON au.id = sm.user_id
         WHERE r.id = $1
           AND sm.user_id = $2
           AND sm.role = ANY($3::text[])
           AND au.disabled_at IS NULL
         FOR SHARE OF c, sm, au`,
        [
          params.data.revisionId,
          actor.userId,
          permittedRoles,
        ]
      );

      const revision = revisions.rows[0];

      if (!revision) {
        await client.query("ROLLBACK");

        // The same response covers both a missing revision and one
        // belonging to another setting, avoiding ID enumeration.
        return reply.code(403).send({
          error: "Not permitted to evaluate this revision",
        });
      }

      const policies = await client.query<{
        version: number;
        rules: unknown;
      }>(
        `SELECT p.version, p.rules
         FROM active_evaluation_policy a
         JOIN evaluation_policies p
           ON p.version = a.policy_version
         WHERE a.id = 1`
      );

      const policy = policies.rows[0];

      if (!policy) {
        throw new Error("No active evaluation policy");
      }

      const rules = rulesSchema.parse(policy.rules);

      const evaluation = evaluateDraft(
        revision.text,
        revision.source_snapshot,
        rules
      );

      const currentSources = await client.query(
        `SELECT id, child_id,
                observation_date::text AS observation_date,
                category, text
         FROM observations
         WHERE child_id = $1 AND observation_date = $2`,
        [revision.child_id, revision.observation_date]
      );

      const current = sourcesAreCurrent(
        revision.source_snapshot,
        currentSources.rows
      );

      evaluation.results.push({
        ruleId: "source_freshness",
        outcome: current ? "pass" : "fail",
        reason: current
          ? "Source observations match the saved snapshot."
          : "Source observations changed; refresh the draft sources.",
      });


      const reviews = await client.query<{
        id: string;
        status: string;
        verdict: string | null;
        reason: string | null;
        returned_model: string | null;
        coverage_verdict: string | null;
        coverage_reason: string | null;
        covered_observation_ids: string[] | null;
        missing_observation_ids: string[] | null;
        unknown_observation_ids: string[] | null;
      }>(
        `SELECT id, status, verdict, reason, returned_model,
                coverage_verdict, coverage_reason,
                covered_observation_ids,
                missing_observation_ids,
                unknown_observation_ids
         FROM content_reviews
         WHERE draft_revision_id = $1
           AND requested_model = $2
           AND rubric_version = $3
           AND rubric_text = $4
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [revision.id, reviewModel, rubricVersion, rubric]
      );

      const review = reviews.rows[0];

      let groundingOutcome: "pass" | "fail" | "error" | "review" =
        "review";
      let groundingReason =
        "No completed matching content review.";

      let coverageOutcome: "pass" | "fail" | "error" | "review" =
        "review";
      let coverageReason =
        "No completed matching content review.";

      if (review?.status === "error") {
        groundingOutcome = "error";
        groundingReason = "The content review failed to complete.";

        coverageOutcome = "error";
        coverageReason = "The content review failed to complete.";
      } else if (review?.status === "completed") {
        if (review.returned_model !== reviewModel) {
          groundingOutcome = "error";
          groundingReason =
            "The returned model does not match the required model.";

          coverageOutcome = "error";
          coverageReason =
            "The returned model does not match the required model.";
        } else {
          groundingOutcome =
            review.verdict === "supported"
              ? "pass"
              : review.verdict === "unsupported"
                ? "fail"
                : "review";

          groundingReason =
            review.reason ?? "Content grounding requires attention.";

          const coverageEvidenceIsComplete =
            Array.isArray(review.covered_observation_ids) &&
            Array.isArray(review.missing_observation_ids) &&
            Array.isArray(review.unknown_observation_ids) &&
            review.coverage_reason !== null;

          if (!coverageEvidenceIsComplete) {
            coverageOutcome = "error";
            coverageReason =
              "The completed content review has incomplete coverage evidence.";
          } else if (review.coverage_verdict === "complete") {
            coverageOutcome = "pass";
            coverageReason =
            review.coverage_reason ?? "Coverage review completed.";
          } else if (review.coverage_verdict === "incomplete") {
            coverageOutcome = "review";
            coverageReason =
            review.coverage_reason ?? "Coverage review completed.";
          } else {
            coverageOutcome = "error";
            coverageReason =
              "The completed content review has an invalid coverage verdict.";
          }
        }
      }

      evaluation.results.push({
        ruleId: "content_grounding",
        outcome: groundingOutcome,
        reason: groundingReason,
      });

      evaluation.results.push({
        ruleId: "content_coverage",
        outcome: coverageOutcome,
        reason: coverageReason,
      });

      evaluation.decision = decideEvaluation(evaluation.results);

      const runs = await client.query<{ id: string }>(
        `INSERT INTO evaluation_runs (
           draft_revision_id,
           evaluator_version,
           rules_snapshot,
           policy_version,
           content_review_id
         )
         VALUES ($1, $2, $3::jsonb, $4, $5)
         RETURNING id`,
        [
          revision.id,
          evaluatorVersion,
          JSON.stringify(rules),
          policy.version,
          review?.id ?? null,
        ]
      );

      const run = runs.rows[0];

      if (!run) {
        throw new Error("Evaluation run was not created");
      }


      for (const result of evaluation.results) {
        await client.query(
          `INSERT INTO evaluation_results (
             evaluation_run_id,
             rule_id,
             outcome,
             reason
           )
           VALUES ($1, $2, $3, $4)`,
          [run.id, result.ruleId, result.outcome, result.reason]
        );
      }

      const completed = await client.query(
        `UPDATE evaluation_runs
         SET status = 'completed',
             decision = $2,
             completed_at = now()
         WHERE id = $1
           AND status = 'running'`,
        [run.id, evaluation.decision]
      );

      if (completed.rowCount !== 1) {
        throw new Error("Evaluation run was not completed");
      }

      await client.query("COMMIT");

      return reply.code(201).send({
        evaluationId: run.id,
        revisionId: revision.id,
        contentReviewId: review?.id ?? null,
        evaluatorVersion,
        policyVersion: policy.version,
        ...evaluation,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
}