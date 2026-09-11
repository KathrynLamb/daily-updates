import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "./db.js";
import {
  evaluateDraft,
  evaluatorVersion,
  initialRules,
} from "./evaluator.js";

const paramsSchema = z.object({
  revisionId: z.uuid(),
});

export async function evaluationRoutes(app: FastifyInstance) {
  app.post("/revisions/:revisionId/evaluations", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);

    if (!params.success) {
      return reply.code(400).send({ error: "Invalid revision ID" });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const revisions = await client.query<{
        id: string;
        text: string;
        source_snapshot: unknown[];
      }>(
        `SELECT id, text, source_snapshot
         FROM draft_revisions
         WHERE id = $1`,
        [params.data.revisionId]
      );

      const revision = revisions.rows[0];

      if (!revision) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Revision not found" });
      }

      const evaluation = evaluateDraft(
        revision.text,
        revision.source_snapshot,
        initialRules
      );

      const runs = await client.query<{ id: string }>(
        `INSERT INTO evaluation_runs (
           draft_revision_id, evaluator_version, rules_snapshot,
           status, decision, completed_at
         )
         VALUES ($1, $2, $3::jsonb, 'completed', $4, now())
         RETURNING id`,
        [
          revision.id,
          evaluatorVersion,
          JSON.stringify(initialRules),
          evaluation.decision,
        ]
      );

      const runId = runs.rows[0].id;

      for (const result of evaluation.results) {
        await client.query(
          `INSERT INTO evaluation_results (
             evaluation_run_id, rule_id, outcome, reason
           )
           VALUES ($1, $2, $3, $4)`,
          [runId, result.ruleId, result.outcome, result.reason]
        );
      }

      await client.query("COMMIT");

      return reply.code(201).send({
        evaluationId: runId,
        revisionId: revision.id,
        evaluatorVersion,
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