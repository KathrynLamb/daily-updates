import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "./db.js";
import { staffRolesFor } from "./authorization.js";

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

    const actor = request.actor;

    if (!actor) {
      throw new Error(
        "Protected route reached without an authenticated actor"
      );
    }

    const input = parsed.data;
    const permittedRoles = staffRolesFor("draft:create");
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Lock the access rows for the duration of the transaction.
      // Membership or user access cannot be revoked between this
      // check and creation of the draft.
      const access = await client.query(
        `SELECT c.id
         FROM children c
         JOIN setting_memberships sm
           ON sm.setting_id = c.setting_id
         JOIN app_users au
           ON au.id = sm.user_id
         WHERE c.id = $1
           AND sm.user_id = $2
           AND sm.role = ANY($3::text[])
           AND au.disabled_at IS NULL
         FOR SHARE OF c, sm, au`,
        [
          input.childId,
          actor.userId,
          permittedRoles,
        ]
      );

      if (access.rows.length === 0) {
        await client.query("ROLLBACK");

        return reply.code(403).send({
          error:
            "Not permitted to create drafts for this child",
        });
      }

      const sources = await client.query(
        `SELECT id, child_id,
                observation_date::text AS observation_date,
                category, text
         FROM observations
         WHERE child_id = $1
           AND observation_date = $2
         ORDER BY created_at, id`,
        [input.childId, input.observationDate]
      );

      if (sources.rows.length === 0) {
        await client.query("ROLLBACK");

        return reply.code(400).send({
          error:
            "No observations found for this child and date",
        });
      }

      const update = await client.query<{ id: string }>(
        `INSERT INTO updates (
           child_id,
           observation_date
         )
         VALUES ($1, $2)
         ON CONFLICT (
           child_id,
           observation_date
         ) DO NOTHING
         RETURNING id`,
        [input.childId, input.observationDate]
      );

      const createdUpdate = update.rows[0];

      if (!createdUpdate) {
        await client.query("ROLLBACK");

        return reply.code(409).send({
          error:
            "An update already exists for this child and date",
        });
      }

      const revision = await client.query(
        `INSERT INTO draft_revisions (
           update_id,
           revision_number,
           text,
           source_snapshot
         )
         VALUES ($1, 1, $2, $3::jsonb)
         RETURNING
           id,
           update_id,
           revision_number,
           text,
           source_snapshot`,
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

  app.post(
    "/updates/:updateId/revisions",
    async (request, reply) => {
      const params = updateParamsSchema.safeParse(
        request.params
      );

      const body = reviseDraftSchema.safeParse(
        request.body
      );

      if (!params.success || !body.success) {
        return reply.code(400).send({
          error: "Invalid update ID or revision input",
        });
      }

      const actor = request.actor;

      if (!actor) {
        throw new Error(
          "Protected route reached without an authenticated actor"
        );
      }

      const permittedRoles = staffRolesFor("draft:create");
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        // Preserve the existing update lock while also requiring
        // current setting membership for the authenticated user.
        const update = await client.query(
          `SELECT u.id
           FROM updates u
           JOIN children c
             ON c.id = u.child_id
           JOIN setting_memberships sm
             ON sm.setting_id = c.setting_id
           JOIN app_users au
             ON au.id = sm.user_id
           WHERE u.id = $1
             AND sm.user_id = $2
             AND sm.role = ANY($3::text[])
             AND au.disabled_at IS NULL
           FOR UPDATE OF u
           FOR SHARE OF c, sm, au`,
          [
            params.data.updateId,
            actor.userId,
            permittedRoles,
          ]
        );

        if (update.rows.length === 0) {
          await client.query("ROLLBACK");

          // The same response covers both a missing update and one
          // belonging to another setting, avoiding ID enumeration.
          return reply.code(403).send({
            error:
              "Not permitted to revise this update",
          });
        }

        const revisions = await client.query<{
          id: string;
          revision_number: number;
          source_snapshot: unknown[];
        }>(
          `SELECT
             id,
             revision_number,
             source_snapshot
           FROM draft_revisions
           WHERE update_id = $1
           ORDER BY revision_number DESC
           LIMIT 1`,
          [params.data.updateId]
        );

        const latest = revisions.rows[0];

        if (!latest) {
          throw new Error(
            "Update has no draft revision"
          );
        }

        if (
          latest.revision_number !==
          body.data.expectedRevision
        ) {
          await client.query("ROLLBACK");

          return reply.code(409).send({
            error:
              "This draft has changed. Load the latest revision.",
            currentRevision:
              latest.revision_number,
          });
        }

        let sources = latest.source_snapshot;

        if (body.data.refreshSources) {
          const currentSources = await client.query(
            `SELECT
               o.id,
               o.child_id,
               o.observation_date::text
                 AS observation_date,
               o.category,
               o.text
             FROM observations o
             JOIN updates u
               ON u.child_id = o.child_id
              AND u.observation_date =
                  o.observation_date
             WHERE u.id = $1
             ORDER BY o.created_at, o.id`,
            [params.data.updateId]
          );

          if (currentSources.rows.length === 0) {
            await client.query("ROLLBACK");

            return reply.code(400).send({
              error:
                "No current observations available",
            });
          }

          sources = currentSources.rows;
        }

        const result = await client.query(
          `INSERT INTO draft_revisions (
             update_id,
             revision_number,
             text,
             source_snapshot
           )
           VALUES ($1, $2, $3, $4::jsonb)
           RETURNING
             id,
             update_id,
             revision_number,
             text,
             source_snapshot`,
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
    }
  );
}