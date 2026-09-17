// src/me.ts
//
// GET /me tells the app who is logged in and what they can do:
// each setting they work in, their role and capabilities there, the
// children in that setting, and any children they can read as a parent.
//
// The app uses this to decide which screens to show. The API still
// checks access on every request; this is only a description of it.

import type { FastifyInstance } from "fastify";
import { pool } from "./db.js";
import {
  staffCapabilities,
  staffCan,
  isStaffRole,
} from "./authorization.js";

type ChildSummary = {
  id: string;
  firstName: string;
};

type MembershipRow = {
  setting_id: string;
  setting_name: string;
  role: string;
  children: ChildSummary[];
};

export async function meRoutes(app: FastifyInstance) {
  app.get("/me", async (request, reply) => {
    const actor = request.actor;

    if (!actor) {
      throw new Error(
        "Protected route reached without an authenticated actor"
      );
    }

    const user = await pool.query(
      `SELECT id
       FROM app_users
       WHERE id = $1
         AND disabled_at IS NULL`,
      [actor.userId]
    );

    if (user.rows.length === 0) {
      return reply.code(403).send({
        error: "This account is not active",
      });
    }

    const memberships = await pool.query<MembershipRow>(
      `SELECT
         s.id AS setting_id,
         s.name AS setting_name,
         sm.role,
         COALESCE(
           (
             SELECT jsonb_agg(
               jsonb_build_object(
                 'id', c.id,
                 'firstName', c.first_name
               )
               ORDER BY c.first_name, c.id
             )
             FROM children c
             WHERE c.setting_id = s.id
           ),
           '[]'::jsonb
         ) AS children
       FROM setting_memberships sm
       JOIN settings s
         ON s.id = sm.setting_id
       WHERE sm.user_id = $1
       ORDER BY s.name, s.id`,
      [actor.userId]
    );

    const parentChildren = await pool.query<ChildSummary>(
      `SELECT
         c.id,
         c.first_name AS "firstName"
       FROM parent_child_access pca
       JOIN children c
         ON c.id = pca.child_id
       WHERE pca.user_id = $1
       ORDER BY c.first_name, c.id`,
      [actor.userId]
    );

    return {
      user: {
        id: actor.userId,
      },
      staff: memberships.rows
        .filter((membership) => isStaffRole(membership.role))
        .map((membership) => ({
          settingId: membership.setting_id,
          settingName: membership.setting_name,
          role: membership.role,
          capabilities: staffCapabilities.filter((capability) =>
            isStaffRole(membership.role)
              ? staffCan(membership.role, capability)
              : false
          ),
          children: membership.children,
        })),
      parentOf: parentChildren.rows,
    };
  });
}
