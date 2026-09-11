import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "./db.js";
import {
  evaluateDraft,
  evaluatorVersion,
} from "./evaluator.js";

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
        return reply.code(404).send({
          error: "Revision not found",
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

      const runs = await client.query<{ id: string }>(
        `INSERT INTO evaluation_runs (
           draft_revision_id,
           evaluator_version,
           rules_snapshot,
           policy_version,
           status,
           decision,
           completed_at
         )
         VALUES ($1, $2, $3::jsonb, $4, 'completed', $5, now())
         RETURNING id`,
        [
          revision.id,
          evaluatorVersion,
          JSON.stringify(rules),
          policy.version,
          evaluation.decision,
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

      await client.query("COMMIT");

      return reply.code(201).send({
        evaluationId: run.id,
        revisionId: revision.id,
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