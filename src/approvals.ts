// src/approvals.ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "./db.js";
import {
  decideEvaluation,
  evaluatorVersion,
  type RuleResult,
} from "./evaluator.js";
import { sourcesAreCurrent } from "./source-freshness.js";
import { staffRolesFor } from "./authorization.js";
import {
  reviewModel,
  rubric,
  rubricVersion,
} from "./content-reviewer.js";

const paramsSchema = z.object({
  evaluationRunId: z.uuid(),
});

type ApprovalRow = {
  id: string;
  draft_revision_id: string;
  evaluation_run_id: string;
  approved_by: string | null;
  approved_at: string;
};

export async function approvalRoutes(app: FastifyInstance) {
  app.post(
    "/evaluation-runs/:evaluationRunId/approval",
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);

      if (!params.success) {
        return reply.code(400).send({
          error: "Invalid evaluation run ID",
        });
      }

      const actor = request.actor;

      if (!actor) {
        throw new Error(
          "Protected route reached without an authenticated actor"
        );
      }

      const permittedRoles = staffRolesFor("approval:create");
      const client = await pool.connect();

      try {
        await client.query(
          "BEGIN ISOLATION LEVEL SERIALIZABLE"
        );

        const evaluations = await client.query<{
          id: string;
          draft_revision_id: string;
          status: string;
          decision: string | null;
          evaluator_version: string;
          policy_version: number;
          content_review_id: string | null;
          update_id: string;
          source_snapshot: unknown[];
          child_id: string;
          observation_date: string;
        }>(
          `SELECT
             er.id,
             er.draft_revision_id,
             er.status,
             er.decision,
             er.evaluator_version,
             er.policy_version,
             er.content_review_id,
             r.update_id,
             r.source_snapshot,
             u.child_id,
             u.observation_date::text AS observation_date
           FROM evaluation_runs er
           JOIN draft_revisions r
             ON r.id = er.draft_revision_id
           JOIN updates u
             ON u.id = r.update_id
           JOIN children c
             ON c.id = u.child_id
           JOIN setting_memberships sm
             ON sm.setting_id = c.setting_id
           JOIN app_users au
             ON au.id = sm.user_id
           WHERE er.id = $1
             AND sm.user_id = $2
             AND sm.role = ANY($3::text[])
             AND au.disabled_at IS NULL
           FOR SHARE OF c, sm, au`,
          [
            params.data.evaluationRunId,
            actor.userId,
            permittedRoles,
          ]
        );

        const evaluation = evaluations.rows[0];

        // Access is checked before any evidence is read, and the
        // access rows stay locked until commit, so the approver's
        // role cannot be revoked part-way through. A missing run
        // and another setting's run get the same response.
        // A practitioner in the right setting is also refused:
        // approval is a separate capability from drafting.
        if (!evaluation) {
          await client.query("ROLLBACK");
          return reply.code(403).send({
            error: "Not permitted to approve this evaluation",
          });
        }

        // Draft creation locks this same update row. Once acquired,
        // no newer revision can appear during this transaction.
        await client.query(
          `SELECT id
           FROM updates
           WHERE id = $1
           FOR UPDATE`,
          [evaluation.update_id]
        );

        const latestRevisions = await client.query<{
          id: string;
        }>(
          `SELECT id
           FROM draft_revisions
           WHERE update_id = $1
           ORDER BY revision_number DESC
           LIMIT 1`,
          [evaluation.update_id]
        );

        if (
          latestRevisions.rows[0]?.id !==
          evaluation.draft_revision_id
        ) {
          await client.query("ROLLBACK");
          return reply.code(409).send({
            error:
              "The evaluation is not for the latest draft revision",
          });
        }

        if (
          evaluation.status !== "completed" ||
          evaluation.decision !== "eligible"
        ) {
          await client.query("ROLLBACK");
          return reply.code(409).send({
            error:
              "Only a completed eligible evaluation can be approved",
          });
        }

        if (evaluation.evaluator_version !== evaluatorVersion) {
          await client.query("ROLLBACK");
          return reply.code(409).send({
            error: "The evaluator version has changed",
          });
        }

        const activePolicies = await client.query<{
          policy_version: number;
        }>(
          `SELECT policy_version
           FROM active_evaluation_policy
           WHERE id = 1
           FOR SHARE`
        );

        if (
          activePolicies.rows[0]?.policy_version !==
          evaluation.policy_version
        ) {
          await client.query("ROLLBACK");
          return reply.code(409).send({
            error: "The evaluation policy has changed",
          });
        }

        if (!evaluation.content_review_id) {
          await client.query("ROLLBACK");
          return reply.code(409).send({
            error: "The evaluation has no content review",
          });
        }

        const reviews = await client.query<{
          status: string;
          requested_model: string;
          returned_model: string | null;
          rubric_version: string;
          rubric_text: string;
        }>(
          `SELECT
             status,
             requested_model,
             returned_model,
             rubric_version,
             rubric_text
           FROM content_reviews
           WHERE id = $1
             AND draft_revision_id = $2`,
          [
            evaluation.content_review_id,
            evaluation.draft_revision_id,
          ]
        );

        const review = reviews.rows[0];

        if (
          !review ||
          review.status !== "completed" ||
          review.requested_model !== reviewModel ||
          review.returned_model !== reviewModel ||
          review.rubric_version !== rubricVersion ||
          review.rubric_text !== rubric
        ) {
          await client.query("ROLLBACK");
          return reply.code(409).send({
            error: "The content review is no longer current",
          });
        }

        const results = await client.query<RuleResult>(
          `SELECT
             rule_id AS "ruleId",
             outcome,
             reason
           FROM evaluation_results
           WHERE evaluation_run_id = $1
           ORDER BY rule_id`,
          [evaluation.id]
        );

        if (decideEvaluation(results.rows) !== "eligible") {
          await client.query("ROLLBACK");
          return reply.code(409).send({
            error:
              "The stored evaluation evidence is not eligible",
          });
        }

        const currentSources = await client.query(
          `SELECT
             id,
             child_id,
             observation_date::text AS observation_date,
             category,
             text
           FROM observations
           WHERE child_id = $1
             AND observation_date = $2`,
          [
            evaluation.child_id,
            evaluation.observation_date,
          ]
        );

        if (
          !sourcesAreCurrent(
            evaluation.source_snapshot,
            currentSources.rows
          )
        ) {
          await client.query("ROLLBACK");
          return reply.code(409).send({
            error:
              "The source observations have changed since evaluation",
          });
        }

        // Idempotency applies only after the approval evidence has
        // been shown to remain current.
        const existing = await client.query<ApprovalRow>(
          `SELECT
             id,
             draft_revision_id,
             evaluation_run_id,
             approved_by,
             approved_at
           FROM revision_approvals
           WHERE evaluation_run_id = $1`,
          [evaluation.id]
        );

        if (existing.rows[0]) {
          await client.query("COMMIT");
          return reply.code(200).send({
            approval: existing.rows[0],
            created: false,
          });
        }

        const inserted = await client.query<ApprovalRow>(
          `INSERT INTO revision_approvals (
             draft_revision_id,
             evaluation_run_id,
             approved_by
           )
           VALUES ($1, $2, $3)
           ON CONFLICT (evaluation_run_id) DO NOTHING
           RETURNING
             id,
             draft_revision_id,
             evaluation_run_id,
             approved_by,
             approved_at`,
          [
            evaluation.draft_revision_id,
            evaluation.id,
            actor.userId,
          ]
        );

        let approval = inserted.rows[0];
        let created = true;

        if (!approval) {
          const concurrent = await client.query<ApprovalRow>(
            `SELECT
               id,
               draft_revision_id,
               evaluation_run_id,
               approved_by,
               approved_at
             FROM revision_approvals
             WHERE evaluation_run_id = $1`,
            [evaluation.id]
          );

          approval = concurrent.rows[0];
          created = false;
        }

        if (!approval) {
          throw new Error("Approval was not created");
        }

        await client.query("COMMIT");

        return reply.code(created ? 201 : 200).send({
          approval,
          created,
        });
      } catch (error) {
        await client.query("ROLLBACK");

        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "40001"
        ) {
          return reply.code(409).send({
            error:
              "Approval state changed concurrently; retry the request",
          });
        }

        throw error;
      } finally {
        client.release();
      }
    }
  );
}