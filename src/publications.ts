// src/publications.ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "./db.js";
import { staffRolesFor } from "./authorization.js";
import {
  findEvidenceProblem,
  type EvidenceProblem,
} from "./approval-evidence.js";

const publishParamsSchema = z.object({
  approvalId: z.uuid(),
});

const childParamsSchema = z.object({
  childId: z.string().trim().min(1),
});

// Wording for each stale-evidence check, from the publication route's
// point of view. Record<> makes a missing message a type error.
const publicationProblemMessages: Record<EvidenceProblem, string> = {
  not_latest_revision:
    "The approval is not for the latest draft revision",
  evaluation_not_eligible:
    "The approval does not reference an eligible evaluation",
  evaluator_changed:
    "The evaluator version has changed",
  policy_changed:
    "The evaluation policy has changed",
  missing_content_review:
    "The evaluation has no content review",
  content_review_not_current:
    "The content review is no longer current",
  stored_results_not_eligible:
    "The stored evaluation evidence is not eligible",
  sources_changed:
    "The source observations have changed since approval",
};

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

        const problem = await findEvidenceProblem(client, {
          updateId: approval.update_id,
          draftRevisionId: approval.draft_revision_id,
          evaluationRunId: approval.evaluation_run_id,
          evaluationStatus: approval.evaluation_status,
          evaluationDecision: approval.evaluation_decision,
          evaluatorVersion: approval.evaluator_version,
          policyVersion: approval.policy_version,
          contentReviewId: approval.content_review_id,
          sourceSnapshot: approval.source_snapshot,
          childId: approval.child_id,
          observationDate: approval.observation_date,
        });

        if (problem) {
          await client.query("ROLLBACK");
          return reply.code(409).send({
            error: publicationProblemMessages[problem],
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