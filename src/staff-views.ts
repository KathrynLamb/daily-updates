// src/staff-views.ts
//
// Read-only routes the staff screens need:
//
//   GET /children/:childId/updates   each day's latest draft for a child,
//                                    with its review, evaluation,
//                                    approval and publication
//   GET /approval-queue              eligible drafts waiting for the
//                                    logged-in approver, with the notes
//                                    each was written from
//
// Everything returned here is staff-only evidence. Parents only ever
// see the published text, through /children/:childId/published-updates.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "./db.js";
import { staffRolesFor } from "./authorization.js";
import { evaluatorVersion } from "./evaluator.js";

const childParamsSchema = z.object({
  childId: z.string().trim().min(1),
});

type RuleResultView = {
  ruleId: string;
  outcome: string;
  reason: string;
};

type UpdateRow = {
  id: string;
  observationDate: string;
  revision: {
    id: string;
    number: number;
    text: string;
    generated: boolean;
    createdAt: string;
  };
  review: {
    id: string;
    status: string;
    verdict: string | null;
    reason: string | null;
    coverageVerdict: string | null;
    coverageReason: string | null;
    missingObservationIds: string[] | null;
    unknownObservationIds: string[] | null;
  } | null;
  evaluation: {
    id: string;
    status: string;
    decision: string | null;
    results: RuleResultView[];
  } | null;
  approval: {
    id: string;
    approvedAt: string;
  } | null;
  publication: {
    id: string;
    revisionId: string;
    publishedAt: string;
  } | null;
};

export type UpdateStatus =
  | "published"
  | "approved"
  | "ready_for_approval"
  | "needs_review"
  | "blocked"
  | "evaluating"
  | "evaluation_failed"
  | "reviewed"
  | "draft";

// One plain-language state per update, for the app to show and act on.
export function updateStatus(update: UpdateRow): UpdateStatus {
  if (update.publication?.revisionId === update.revision.id) {
    return "published";
  }

  if (update.approval) {
    return "approved";
  }

  const evaluation = update.evaluation;

  if (evaluation) {
    if (evaluation.status === "running") {
      return "evaluating";
    }

    if (evaluation.status === "error") {
      return "evaluation_failed";
    }

    if (evaluation.decision === "eligible") {
      return "ready_for_approval";
    }

    if (evaluation.decision === "blocked") {
      return "blocked";
    }

    return "needs_review";
  }

  if (update.review?.status === "completed") {
    return "reviewed";
  }

  return "draft";
}

export async function staffViewRoutes(app: FastifyInstance) {
  app.get(
    "/children/:childId/updates",
    async (request, reply) => {
      const parsed = childParamsSchema.safeParse(request.params);

      if (!parsed.success) {
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

      // Access and rows come from one statement, so they are read from
      // the same snapshot. A child that does not exist gets the same
      // response as one the user cannot read.
      const result = await pool.query<{
        allowed: boolean;
        first_name: string | null;
        updates: UpdateRow[];
      }>(
        `WITH access AS (
           SELECT EXISTS (
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
           ) AS allowed
         )
         SELECT
           access.allowed,
           (
             SELECT first_name
             FROM children
             WHERE id = $2
               AND access.allowed
           ) AS first_name,
           COALESCE(
             (
               SELECT jsonb_agg(
                 jsonb_build_object(
                   'id', u.id,
                   'observationDate', u.observation_date::text,
                   'revision', jsonb_build_object(
                     'id', r.id,
                     'number', r.revision_number,
                     'text', r.text,
                     'generated', r.generation_id IS NOT NULL,
                     'createdAt', r.created_at
                   ),
                   'review', CASE WHEN cr.id IS NULL THEN NULL ELSE
                     jsonb_build_object(
                       'id', cr.id,
                       'status', cr.status,
                       'verdict', cr.verdict,
                       'reason', cr.reason,
                       'coverageVerdict', cr.coverage_verdict,
                       'coverageReason', cr.coverage_reason,
                       'missingObservationIds',
                         cr.missing_observation_ids,
                       'unknownObservationIds',
                         cr.unknown_observation_ids
                     )
                   END,
                   'evaluation', CASE WHEN er.id IS NULL THEN NULL ELSE
                     jsonb_build_object(
                       'id', er.id,
                       'status', er.status,
                       'decision', er.decision,
                       'results', COALESCE(results.items, '[]'::jsonb)
                     )
                   END,
                   'approval', CASE WHEN ra.id IS NULL THEN NULL ELSE
                     jsonb_build_object(
                       'id', ra.id,
                       'approvedAt', ra.approved_at
                     )
                   END,
                   'publication', CASE WHEN pu.id IS NULL THEN NULL ELSE
                     jsonb_build_object(
                       'id', pu.id,
                       'revisionId', pu.draft_revision_id,
                       'publishedAt', pu.published_at
                     )
                   END
                 )
                 ORDER BY u.observation_date DESC, u.id
               )
               FROM updates u
               JOIN LATERAL (
                 SELECT *
                 FROM draft_revisions
                 WHERE update_id = u.id
                 ORDER BY revision_number DESC
                 LIMIT 1
               ) r ON true
               LEFT JOIN LATERAL (
                 SELECT *
                 FROM content_reviews
                 WHERE draft_revision_id = r.id
                 ORDER BY created_at DESC, id DESC
                 LIMIT 1
               ) cr ON true
               LEFT JOIN LATERAL (
                 SELECT *
                 FROM evaluation_runs
                 WHERE draft_revision_id = r.id
                 ORDER BY created_at DESC, id DESC
                 LIMIT 1
               ) er ON true
               LEFT JOIN LATERAL (
                 SELECT jsonb_agg(
                   jsonb_build_object(
                     'ruleId', rule_id,
                     'outcome', outcome,
                     'reason', reason
                   )
                   ORDER BY rule_id
                 ) AS items
                 FROM evaluation_results
                 WHERE evaluation_run_id = er.id
               ) results ON true
               LEFT JOIN revision_approvals ra
                 ON ra.evaluation_run_id = er.id
               LEFT JOIN LATERAL (
                 SELECT *
                 FROM published_updates
                 WHERE update_id = u.id
                 ORDER BY published_at DESC, id DESC
                 LIMIT 1
               ) pu ON true
               WHERE access.allowed
                 AND u.child_id = $2
             ),
             '[]'::jsonb
           ) AS updates
         FROM access`,
        [
          actor.userId,
          parsed.data.childId,
          staffRolesFor("observation:read"),
        ]
      );

      const row = result.rows[0];

      if (!row?.allowed) {
        return reply.code(403).send({
          error: "Not permitted to read updates for this child",
        });
      }

      return {
        child: {
          id: parsed.data.childId,
          firstName: row.first_name,
        },
        updates: row.updates.map((update) => ({
          ...update,
          status: updateStatus(update),
        })),
      };
    }
  );

  app.get("/approval-queue", async (request) => {
    const actor = request.actor;

    if (!actor) {
      throw new Error(
        "Protected route reached without an authenticated actor"
      );
    }

    // Only settings where the user can approve. Evaluations from an
    // older evaluator version are left out, because approval would
    // refuse them anyway. Approval re-checks everything else.
    const queue = await pool.query(
      `SELECT
         u.id AS "updateId",
         u.observation_date::text AS "observationDate",
         c.id AS "childId",
         c.first_name AS "childFirstName",
         s.id AS "settingId",
         s.name AS "settingName",
         jsonb_build_object(
           'id', r.id,
           'number', r.revision_number,
           'text', r.text,
           'generated', r.generation_id IS NOT NULL
         ) AS revision,
         -- The notes this version was written from, so the approver can
         -- compare the two before approving.
         COALESCE(
           (
             SELECT jsonb_agg(
               jsonb_build_object(
                 'category', note->>'category',
                 'text', note->>'text'
               )
               ORDER BY position
             )
             FROM jsonb_array_elements(r.source_snapshot)
               WITH ORDINALITY AS notes(note, position)
           ),
           '[]'::jsonb
         ) AS notes,
         jsonb_build_object(
           'id', er.id,
           'decision', er.decision,
           'results', COALESCE(results.items, '[]'::jsonb)
         ) AS evaluation,
         CASE WHEN cr.id IS NULL THEN NULL ELSE
           jsonb_build_object(
             'verdict', cr.verdict,
             'reason', cr.reason,
             'coverageReason', cr.coverage_reason
           )
         END AS review,
         CASE WHEN ra.id IS NULL THEN NULL ELSE
           jsonb_build_object(
             'id', ra.id,
             'approvedAt', ra.approved_at
           )
         END AS approval
       FROM setting_memberships sm
       JOIN app_users au
         ON au.id = sm.user_id
        AND au.disabled_at IS NULL
       JOIN settings s
         ON s.id = sm.setting_id
       JOIN children c
         ON c.setting_id = sm.setting_id
       JOIN updates u
         ON u.child_id = c.id
       JOIN LATERAL (
         SELECT *
         FROM draft_revisions
         WHERE update_id = u.id
         ORDER BY revision_number DESC
         LIMIT 1
       ) r ON true
       JOIN LATERAL (
         SELECT *
         FROM evaluation_runs
         WHERE draft_revision_id = r.id
         ORDER BY created_at DESC, id DESC
         LIMIT 1
       ) er ON true
       LEFT JOIN content_reviews cr
         ON cr.id = er.content_review_id
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(
           jsonb_build_object(
             'ruleId', rule_id,
             'outcome', outcome,
             'reason', reason
           )
           ORDER BY rule_id
         ) AS items
         FROM evaluation_results
         WHERE evaluation_run_id = er.id
       ) results ON true
       LEFT JOIN revision_approvals ra
         ON ra.evaluation_run_id = er.id
       WHERE sm.user_id = $1
         AND sm.role = ANY($2::text[])
         AND er.status = 'completed'
         AND er.decision = 'eligible'
         AND er.evaluator_version = $3
         AND NOT EXISTS (
           SELECT 1
           FROM published_updates p
           WHERE p.draft_revision_id = r.id
         )
       ORDER BY u.observation_date, c.first_name, u.id`,
      [
        actor.userId,
        staffRolesFor("approval:create"),
        evaluatorVersion,
      ]
    );

    return {
      items: queue.rows,
    };
  });
}
