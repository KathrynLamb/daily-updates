// src/content-reviews.ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "./db.js";
import { staffRolesFor } from "./authorization.js";
import {
  reviewContent,
  reviewModel,
  rubricVersion,
  rubric,
  type ContentReviewer,
} from "./content-reviewer.js";

const paramsSchema = z.object({
  revisionId: z.uuid(),
});

const sourcesSchema = z.array(
  z.object({
    id: z.string(),
    text: z.string(),
  })
).min(1);

type ContentReviewRoutesOptions = {
  reviewer?: ContentReviewer;
};

export async function contentReviewRoutes(
  app: FastifyInstance,
  options: ContentReviewRoutesOptions
) {
  const reviewer = options.reviewer ?? reviewContent;

  app.post(
    "/revisions/:revisionId/content-reviews",
    async (request, reply) => {
      const params = paramsSchema.safeParse(
        request.params
      );

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

      const permittedRoles = staffRolesFor(
        "content-review:create"
      );

      const revisions = await pool.query<{
        id: string;
        text: string;
        source_snapshot: unknown;
        child_name: string;
      }>(
        `SELECT
           r.id,
           r.text,
           r.source_snapshot,
           c.first_name AS child_name
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
           AND au.disabled_at IS NULL`,
        [
          params.data.revisionId,
          actor.userId,
          permittedRoles,
        ]
      );

      const revision = revisions.rows[0];

      if (!revision) {
        return reply.code(403).send({
          error:
            "Not permitted to review this revision",
        });
      }

      const input = {
        childName: revision.child_name,
        observations: sourcesSchema.parse(
          revision.source_snapshot
        ),
        draft: revision.text,
      };

      // One review per draft version (migration 020). Checked here for a
      // clear message; the database enforces it for simultaneous requests.
      const earlier = await pool.query<{ status: string }>(
        `SELECT status
         FROM content_reviews
         WHERE draft_revision_id = $1
           AND requested_model = $2
           AND rubric_version = $3
           AND rubric_text = $4
           AND status IN ('running', 'completed')
         ORDER BY created_at DESC
         LIMIT 1`,
        [revision.id, reviewModel, rubricVersion, rubric]
      );

      const alreadyReviewed = (status?: string) =>
        reply.code(409).send({
          error:
            status === "running"
              ? "This version is already being checked."
              : "This version has already been checked. " +
                "Change the draft to check it again.",
        });

      if (earlier.rows[0]) {
        return alreadyReviewed(earlier.rows[0].status);
      }

      // Recheck access atomically while recording the attempt.
      // If access was revoked after the initial read, no durable
      // attempt is created and the model is never called.
      let attempts;

      try {
        attempts = await pool.query<{ id: string }>(
          `INSERT INTO content_reviews (
             draft_revision_id,
             requested_model,
             rubric_version,
             rubric_text,
             input_snapshot,
             requested_by
           )
           SELECT
             r.id,
             $4,
             $5,
             $6,
             $7::jsonb,
             -- The member whose access this row just proved.
             sm.user_id
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
           RETURNING id`,
          [
            revision.id,
            actor.userId,
            permittedRoles,
            reviewModel,
            rubricVersion,
            rubric,
            JSON.stringify(input),
          ]
        );
      } catch (error) {
        if (
          (error as { constraint?: string }).constraint ===
          "content_reviews_one_per_revision"
        ) {
          return alreadyReviewed("running");
        }

        throw error;
      }

      const attempt = attempts.rows[0];

      if (!attempt) {
        return reply.code(403).send({
          error:
            "Content review access changed; retry the request",
        });
      }

      try {
        // No database connection or transaction is held while
        // waiting for the external model.
        const review = await reviewer(input);

        await pool.query(
          `UPDATE content_reviews
           SET status = 'completed',
               verdict = $2,
               reason = $3,
               returned_model = $4,
               usage = $5::jsonb,
               coverage_verdict = $6,
               coverage_reason = $7,
               covered_observation_ids = $8,
               missing_observation_ids = $9,
               unknown_observation_ids = $10,
               completed_at = now()
           WHERE id = $1`,
          [
            attempt.id,
            review.verdict,
            review.reason,
            review.model,
            JSON.stringify(review.usage),
            review.coverage.verdict,
            review.coverage.reason,
            review.coverage.covered,
            review.coverage.missing,
            review.coverage.unknown,
          ]
        );

        return reply.code(201).send({
          reviewId: attempt.id,
          revisionId: revision.id,
          ...review,
        });
      } catch (error) {
        const category =
          error instanceof Error
            ? error.name
            : "UnknownError";

        await pool.query(
          `UPDATE content_reviews
           SET status = 'error',
               verdict = NULL,
               coverage_verdict = NULL,
               error_message = $2,
               completed_at = now()
           WHERE id = $1`,
          [
            attempt.id,
            `Review failed (${category})`,
          ]
        );

        request.log.error(
          {
            reviewId: attempt.id,
            category,
          },
          "Content review failed"
        );

        return reply.code(502).send({
          error: "Content review failed",
          reviewId: attempt.id,
        });
      }
    }
  );
}