import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "./db.js";
import { staffRolesFor } from "./authorization.js";

const observationSchema = z.strictObject({
  childId: z.string().trim().min(1),
  category: z.enum([
    "activity",
    "food",
    "sleep",
    "general",
  ]),
  text: z.string().trim().min(1).max(1000),
});

const createObservationSchema = observationSchema.extend({
  observationDate: z.iso.date(),
});

const childParamsSchema = z.object({
  childId: z.string().trim().min(1),
});

type ObservationRow = {
  id: string;
  child_id: string;
  observation_date: string;
  category: string;
  text: string;
};

export async function observationRoutes(
  app: FastifyInstance
) {
  app.post(
    "/observations/validate",
    async (request, reply) => {
      const result = observationSchema.safeParse(request.body);

      if (!result.success) {
        return reply.code(400).send({
          error: "Invalid observation",
          issues: result.error.issues,
        });
      }

      return {
        valid: true,
        observation: result.data,
      };
    }
  );

  app.post("/observations", async (request, reply) => {
    const parsed = createObservationSchema.safeParse(
      request.body
    );

    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid observation",
        issues: parsed.error.issues,
      });
    }

    const actor = request.actor;

    if (!actor) {
      throw new Error(
        "Protected route reached without an authenticated actor"
      );
    }

    const observation = parsed.data;
    const permittedRoles = staffRolesFor(
      "observation:create"
    );

    const result = await pool.query<ObservationRow>(
      `INSERT INTO observations (
         child_id,
         observation_date,
         category,
         text
       )
       SELECT
         c.id,
         $3::date,
         $4,
         $5
       FROM children c
       JOIN setting_memberships sm
         ON sm.setting_id = c.setting_id
       JOIN app_users au
         ON au.id = sm.user_id
       WHERE c.id = $2
         AND sm.user_id = $1
         AND sm.role = ANY($6::text[])
         AND au.disabled_at IS NULL
       RETURNING
         id,
         child_id,
         observation_date::text AS observation_date,
         category,
         text`,
      [
        actor.userId,
        observation.childId,
        observation.observationDate,
        observation.category,
        observation.text,
        permittedRoles,
      ]
    );

    const created = result.rows[0];

    if (!created) {
      return reply.code(403).send({
        error:
          "Not permitted to create observations for this child",
      });
    }

    return reply.code(201).send({
      observation: created,
    });
  });

  app.get(
    "/children/:childId/observations",
    async (request, reply) => {
      const parsed = childParamsSchema.safeParse(
        request.params
      );

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

      const permittedRoles = staffRolesFor(
        "observation:read"
      );

      const result = await pool.query<{
        allowed: boolean;
        observations: ObservationRow[];
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
           COALESCE(
             jsonb_agg(
               jsonb_build_object(
                 'id', o.id,
                 'child_id', o.child_id,
                 'observation_date',
                   o.observation_date::text,
                 'category', o.category,
                 'text', o.text
               )
               ORDER BY
                 o.observation_date DESC,
                 o.created_at DESC,
                 o.id
             ) FILTER (WHERE o.id IS NOT NULL),
             '[]'::jsonb
           ) AS observations
         FROM access
         LEFT JOIN observations o
           ON access.allowed
          AND o.child_id = $2
         GROUP BY access.allowed`,
        [
          actor.userId,
          parsed.data.childId,
          permittedRoles,
        ]
      );

      const access = result.rows[0];

      if (!access?.allowed) {
        return reply.code(403).send({
          error:
            "Not permitted to read observations for this child",
        });
      }

      return {
        observations: access.observations,
      };
    }
  );
}