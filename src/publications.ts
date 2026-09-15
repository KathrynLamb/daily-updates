import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "./db.js";
import {
  decideEvaluation,
  evaluatorVersion,
  type RuleResult,
} from "./evaluator.js";
import { sourcesAreCurrent } from "./source-freshness.js";
import {
  reviewModel,
  rubric,
  rubricVersion,
} from "./content-reviewer.js";

const publishParamsSchema = z.object({
  approvalId: z.uuid(),
});

const childParamsSchema = z.object({
  childId: z.string().trim().min(1),
});

type PublicationRow = {
  id: string;
  update_id: string;
  draft_revision_id: string;
  approval_id: string;
  child_id: string;
  observation_date: string;
  text_snapshot: string;
  published_at: string;
};

export async function publicationRoutes(app: FastifyInstance) {
  app.post(
    "/revision-approvals/:approvalId/publication",
    async (request, reply) => {
      const params = publishParamsSchema.safeParse(request.params);

      if (!params.success) {
        return reply.code(400).send({
          error: "Invalid approval ID",
        });
      }

      const client = await pool.connect();

      try {
        await client.query(
          "BEGIN ISOLATION LEVEL SERIALIZABLE"
        );

        const approvals = await client.query<{
          approval_id: string;
          draft_revision_id: string;
          evaluation_run_id: string;
          evaluation_status: string;
          evaluation_decision: string | null;
          evaluator_version: string;
          policy_version: number;
          content_review_id: string | null;
          update_id: string;
          text_snapshot: string;
          source_snapshot: unknown[];
          child_id: string;
          observation_date: string;
        }>(
          `SELECT
             ra.id AS approval_id,
             ra.draft_revision_id,
             ra.evaluation_run_id,
             er.status AS evaluation_status,
             er.decision AS evaluation_decision,
             er.evaluator_version,
             er.policy_version,
             er.content_review_id,
             r.update_id,
             r.text AS text_snapshot,
             r.source_snapshot,
             u.child_id,
             u.observation_date::text AS observation_date
           FROM revision_approvals ra
           JOIN evaluation_runs er
             ON er.id = ra.evaluation_run_id
           JOIN draft_revisions r
             ON r.id = ra.draft_revision_id
           JOIN updates u
             ON u.id = r.update_id
           WHERE ra.id = $1`,
          [params.data.approvalId]
        );

        const approval = approvals.rows[0];

        if (!approval) {
          await client.query("ROLLBACK");
          return reply.code(404).send({
            error: "Approval not found",
          });
        }

        // Draft creation and publication both lock the update.
        await client.query(
          `SELECT id
           FROM updates
           WHERE id = $1
           FOR UPDATE`,
          [approval.update_id]
        );

        // A completed publication is final. Retrying the same
        // publication returns it without revalidating mutable state.
        const existing = await client.query<PublicationRow>(
          `SELECT
             id,
             update_id,
             draft_revision_id,
             approval_id,
             child_id,
             observation_date::text AS observation_date,
             text_snapshot,
             published_at
           FROM published_updates
           WHERE update_id = $1`,
          [approval.update_id]
        );

        const existingPublication = existing.rows[0];

        if (existingPublication) {
          if (
            existingPublication.approval_id !==
            approval.approval_id
          ) {
            await client.query("ROLLBACK");
            return reply.code(409).send({
              error: "This update has already been published",
            });
          }

          await client.query("COMMIT");
          return reply.code(200).send({
            publication: existingPublication,
            created: false,
          });
        }

        const latestRevisions = await client.query<{
          id: string;
        }>(
          `SELECT id
           FROM draft_revisions
           WHERE update_id = $1
           ORDER BY revision_number DESC
           LIMIT 1`,
          [approval.update_id]
        );

        if (
          latestRevisions.rows[0]?.id !==
          approval.draft_revision_id
        ) {
          await client.query("ROLLBACK");
          return reply.code(409).send({
            error:
              "The approval is not for the latest draft revision",
          });
        }

        if (
          approval.evaluation_status !== "completed" ||
          approval.evaluation_decision !== "eligible"
        ) {
          await client.query("ROLLBACK");
          return reply.code(409).send({
            error:
              "The approval does not reference an eligible evaluation",
          });
        }

        if (approval.evaluator_version !== evaluatorVersion) {
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
          approval.policy_version
        ) {
          await client.query("ROLLBACK");
          return reply.code(409).send({
            error: "The evaluation policy has changed",
          });
        }

        if (!approval.content_review_id) {
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
            approval.content_review_id,
            approval.draft_revision_id,
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
          [approval.evaluation_run_id]
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
            approval.child_id,
            approval.observation_date,
          ]
        );

        if (
          !sourcesAreCurrent(
            approval.source_snapshot,
            currentSources.rows
          )
        ) {
          await client.query("ROLLBACK");
          return reply.code(409).send({
            error:
              "The source observations have changed since approval",
          });
        }

        const inserted = await client.query<PublicationRow>(
          `INSERT INTO published_updates (
             update_id,
             draft_revision_id,
             approval_id,
             child_id,
             observation_date,
             text_snapshot,
             source_snapshot
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
           RETURNING
             id,
             update_id,
             draft_revision_id,
             approval_id,
             child_id,
             observation_date::text AS observation_date,
             text_snapshot,
             published_at`,
          [
            approval.update_id,
            approval.draft_revision_id,
            approval.approval_id,
            approval.child_id,
            approval.observation_date,
            approval.text_snapshot,
            JSON.stringify(approval.source_snapshot),
          ]
        );

        const publication = inserted.rows[0];

        if (!publication) {
          throw new Error("Publication was not created");
        }

        await client.query("COMMIT");

        return reply.code(201).send({
          publication,
          created: true,
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
              "Publication state changed concurrently; retry the request",
          });
        }

        throw error;
      } finally {
        client.release();
      }
    }
  );

  // This projection exposes published text only. Authentication and
  // parent-child authorization will be added with the identity model.
  app.get(
    "/children/:childId/published-updates",
    async (request, reply) => {
      const params = childParamsSchema.safeParse(request.params);

      if (!params.success) {
        return reply.code(400).send({
          error: "Invalid child ID",
        });
      }

      const result = await pool.query<{
        id: string;
        child_id: string;
        observation_date: string;
        text: string;
        published_at: string;
      }>(
        `SELECT
           id,
           child_id,
           observation_date::text AS observation_date,
           text_snapshot AS text,
           published_at
         FROM published_updates
         WHERE child_id = $1
         ORDER BY observation_date DESC, published_at DESC`,
        [params.data.childId]
      );

      return {
        updates: result.rows,
      };
    }
  );
}