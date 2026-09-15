import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "./db.js";
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
  app.post("/revisions/:revisionId/content-reviews", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);

    if (!params.success) {
      return reply.code(400).send({ error: "Invalid revision ID" });
    }

    const revisions = await pool.query<{
      id: string;
      text: string;
      source_snapshot: unknown;
      child_name: string;
    }>(
      `SELECT r.id, r.text, r.source_snapshot,
              c.first_name AS child_name
       FROM draft_revisions r
       JOIN updates u ON u.id = r.update_id
       JOIN children c ON c.id = u.child_id
       WHERE r.id = $1`,
      [params.data.revisionId]
    );

    const revision = revisions.rows[0];

    if (!revision) {
      return reply.code(404).send({ error: "Revision not found" });
    }

    const input = {
      childName: revision.child_name,
      observations: sourcesSchema.parse(revision.source_snapshot),
      draft: revision.text,
    };

    // Durable attempt: record exactly what the judge will receive.
    const attempts = await pool.query<{ id: string }>(
      `INSERT INTO content_reviews (
         draft_revision_id, requested_model, rubric_version,
         rubric_text, input_snapshot
       )
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id`,
      [
        revision.id,
        reviewModel,
        rubricVersion,
        rubric,
        JSON.stringify(input),
      ]
    );

    const attempt = attempts.rows[0];

    if (!attempt) {
      throw new Error("Review attempt was not created");
    }

    try {
      // External model call: no database connection or transaction
      // is held while we wait for Claude.
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

      // A model judgement is evidence, not approval to publish.
      return reply.code(201).send({
        reviewId: attempt.id,
        revisionId: revision.id,
        ...review,
      });
    } catch (error) {
      // Fail closed: a failed call never becomes a passing verdict.
      // Store a bounded error category rather than raw provider output.
      const category =
        error instanceof Error ? error.name : "UnknownError";

      await pool.query(
        `UPDATE content_reviews
         SET status = 'error',
             verdict = NULL,
             coverage_verdict = NULL,
             error_message = $2,
             completed_at = now()
         WHERE id = $1`,
        [attempt.id, `Review failed (${category})`]
      );

      request.log.error(
        { reviewId: attempt.id, category },
        "Content review failed"
      );

      return reply.code(502).send({
        error: "Content review failed",
        reviewId: attempt.id,
      });
    }
  });
}