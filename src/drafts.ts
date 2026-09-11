import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "./db.js";

const createDraftSchema = z.strictObject({
  childId: z.string().trim().min(1),
  observationDate: z.iso.date(),
  text: z.string().trim().min(1).max(5000),
});

const updateParamsSchema = z.object({
    updateId: z.uuid(),
  });
  
  const reviseDraftSchema = z.strictObject({
    expectedRevision: z.number().int().min(1),
    text: z.string().trim().min(1).max(5000),
    refreshSources: z.boolean().default(false),
  });

export async function draftRoutes(app: FastifyInstance) {
  app.post("/drafts", async (request, reply) => {
    const parsed = createDraftSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid draft",
        issues: parsed.error.issues,
      });
    }

    const input = parsed.data;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const sources = await client.query(
        `SELECT id, child_id,
                observation_date::text AS observation_date,
                category, text
         FROM observations
         WHERE child_id = $1 AND observation_date = $2
         ORDER BY created_at, id`,
        [input.childId, input.observationDate]
      );

      if (sources.rows.length === 0) {
        await client.query("ROLLBACK");
        return reply.code(400).send({
          error: "No observations found for this child and date",
        });
      }

      const update = await client.query<{ id: string }>(
        `INSERT INTO updates (child_id, observation_date)
         VALUES ($1, $2)
         ON CONFLICT (child_id, observation_date) DO NOTHING
         RETURNING id`,
        [input.childId, input.observationDate]
      );

      const createdUpdate = update.rows[0];

      if (!createdUpdate) {
        await client.query("ROLLBACK");
        return reply.code(409).send({
          error: "An update already exists for this child and date",
        });
      }

      const revision = await client.query(
        `INSERT INTO draft_revisions (
           update_id, revision_number, text, source_snapshot
         )
         VALUES ($1, 1, $2, $3::jsonb)
         RETURNING id, update_id, revision_number,
                   text, source_snapshot`,
        [
          createdUpdate.id,
          input.text,
          JSON.stringify(sources.rows),
        ]
      );

      await client.query("COMMIT");

      return reply.code(201).send({
        draft: revision.rows[0],
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/updates/:updateId/revisions", async (request, reply) => {
    const params = updateParamsSchema.safeParse(request.params);
    const body = reviseDraftSchema.safeParse(request.body);

    if (!params.success || !body.success) {
      return reply.code(400).send({
        error: "Invalid update ID or revision input",
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const update = await client.query(
        "SELECT id FROM updates WHERE id = $1 FOR UPDATE",
        [params.data.updateId]
      );

      if (update.rows.length === 0) {
        await client.query("ROLLBACK");
        return reply.code(404).send({
          error: "Update not found",
        });
      }

      const revisions = await client.query<{
        id: string;
        revision_number: number;
        source_snapshot: unknown[];
      }>(
        `SELECT id, revision_number, source_snapshot
         FROM draft_revisions
         WHERE update_id = $1
         ORDER BY revision_number DESC
         LIMIT 1`,
        [params.data.updateId]
      );

      const latest = revisions.rows[0];

      if (!latest) {
        throw new Error("Update has no draft revision");
      }

      if (latest.revision_number !== body.data.expectedRevision) {
        await client.query("ROLLBACK");
        return reply.code(409).send({
          error: "This draft has changed. Load the latest revision.",
          currentRevision: latest.revision_number,
        });
      }

      let sources = latest.source_snapshot;

      if (body.data.refreshSources) {
        const currentSources = await client.query(
          `SELECT o.id, o.child_id,
                  o.observation_date::text AS observation_date,
                  o.category, o.text
           FROM observations o
           JOIN updates u
             ON u.child_id = o.child_id
            AND u.observation_date = o.observation_date
           WHERE u.id = $1
           ORDER BY o.created_at, o.id`,
          [params.data.updateId]
        );

        if (currentSources.rows.length === 0) {
          await client.query("ROLLBACK");
          return reply.code(400).send({
            error: "No current observations available",
          });
        }

        sources = currentSources.rows;
      }

      const result = await client.query(
        `INSERT INTO draft_revisions (
           update_id, revision_number, text, source_snapshot
         )
         VALUES ($1, $2, $3, $4::jsonb)
         RETURNING id, update_id, revision_number,
                   text, source_snapshot`,
        [
          params.data.updateId,
          latest.revision_number + 1,
          body.data.text,
          JSON.stringify(sources),
        ]
      );

      await client.query("COMMIT");

      return reply.code(201).send({
        draft: result.rows[0],
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
}