// src/publications.ts
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
  published_by: string | null;
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

      const actor = request.actor;

      if (!actor) {
        throw new Error(
          "Protected route reached without an authenticated actor"
        );
      }

      const permittedRoles = staffRolesFor("publication:create");
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
           JOIN children c
             ON c.id = u.child_id
           JOIN setting_memberships sm
             ON sm.setting_id = c.setting_id
           JOIN app_users au
             ON au.id = sm.user_id
           WHERE ra.id = $1
             AND sm.user_id = $2
             AND sm.role = ANY($3::text[])
             AND au.disabled_at IS NULL
           FOR SHARE OF c, sm, au`,
          [
            params.data.approvalId,
            actor.userId,
            permittedRoles,
          ]
        );

        const approval = approvals.rows[0];

        // Access is checked before anything else, including the
        // idempotent retry below, so a user who has lost access
        // cannot read back an existing publication either. A missing
        // approval and another setting's approval get the same
        // response, and so does a same-setting practitioner.
        if (!approval) {
          await client.query("ROLLBACK");
          return reply.code(403).send({
            error: "Not permitted to publish this approval",
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
             published_by,
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
             source_snapshot,
             published_by
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
           RETURNING
             id,
             update_id,
             draft_revision_id,
             approval_id,
             child_id,
             observation_date::text AS observation_date,
             text_snapshot,
             published_by,
             published_at`,
          [
            approval.update_id,
            approval.draft_revision_id,
            approval.approval_id,
            approval.child_id,
            approval.observation_date,
            approval.text_snapshot,
            JSON.stringify(approval.source_snapshot),
            actor.userId,
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

  // This projection exposes published text only: never drafts,
  // sources, reviews or who approved and published.
  //
  // Readers are the child's linked parents and staff in the child's
  // setting. Access and rows come from one statement, so they are
  // read from the same snapshot. A child that does not exist gets
  // the same response as one the user cannot read.
  app.get(
    "/children/:childId/published-updates",
    async (request, reply) => {
      const params = childParamsSchema.safeParse(request.params);

      if (!params.success) {
        return reply.code(400).send({
          error: "Invalid child ID",
        });
      }

      const actor = request.actor;

      if (!actor) {
        throw new Error(
          "Protected route reached without an authenticated actor"
        );
      }

      const permittedRoles = staffRolesFor(
        "published-update:read"
      );

      const result = await pool.query<{
        allowed: boolean;
        updates: {
          id: string;
          child_id: string;
          observation_date: string;
          text: string;
          published_at: string;
        }[];
      }>(
        `WITH access AS (
           SELECT (
             EXISTS (
               SELECT 1
               FROM children c
               JOIN setting_memberships sm
                 ON sm.setting_id = c.setting_id
               JOIN app_users au
                 ON au.id = sm.user_id
               WHERE c.id = $2
                 AND sm.user_id = $1
                 AND sm.role = ANY($3::text[])
                 AND au.disabled_at IS NULL
             )
             OR EXISTS (
               SELECT 1
               FROM parent_child_access pca
               JOIN app_users au
                 ON au.id = pca.user_id
               WHERE pca.child_id = $2
                 AND pca.user_id = $1
                 AND au.disabled_at IS NULL
             )
           ) AS allowed
         )
         SELECT
           access.allowed,
           COALESCE(
             jsonb_agg(
               jsonb_build_object(
                 'id', p.id,
                 'child_id', p.child_id,
                 'observation_date',
                   p.observation_date::text,
                 'text', p.text_snapshot,
                 'published_at', p.published_at
               )
               ORDER BY
                 p.observation_date DESC,
                 p.published_at DESC,
                 p.id
             ) FILTER (WHERE p.id IS NOT NULL),
             '[]'::jsonb
           ) AS updates
         FROM access
         LEFT JOIN published_updates p
           ON access.allowed
          AND p.child_id = $2
         GROUP BY access.allowed`,
        [
          actor.userId,
          params.data.childId,
          permittedRoles,
        ]
      );

      const access = result.rows[0];

      if (!access?.allowed) {
        return reply.code(403).send({
          error:
            "Not permitted to read updates for this child",
        });
      }

      return {
        updates: access.updates,
      };
    }
  );
}