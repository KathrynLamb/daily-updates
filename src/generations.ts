// src/generations.ts
//
// Routes that have Claude write a draft:
//
//   POST /drafts/generate                 first draft for a child and date
//   POST /updates/:updateId/generations   new revision from current sources
//
// Each request runs in three steps, so no database transaction is held
// open while waiting for the model:
//
//   1. Check access, gather the observations, and record the attempt.
//   2. Call the model and record the result or the failure.
//   3. Check access and currency again, then save the revision.
//
// If anything changed during the call (access revoked, a revision saved,
// an update created), the generation is kept as history but no revision
// is saved. The generated revision then goes through the same review,
// evaluation and approval as a hand-written one.

import type {
    FastifyBaseLogger,
    FastifyInstance,
  } from "fastify";
  import type { PoolClient } from "pg";
  import { z } from "zod";
  import { pool } from "./db.js";
  import { staffRolesFor } from "./authorization.js";
  import {
    generationModel,
    generationPrompt,
    generationPromptVersion,
    type GenerationInput,
    type GenerationResult,
  } from "./generation-schema.js";
  import {
    generateDraft,
    type DraftGenerator,
  } from "./draft-generator.js";
  
  const generateDraftSchema = z.strictObject({
    childId: z.string().trim().min(1),
    observationDate: z.iso.date(),
  });
  
  const updateParamsSchema = z.object({
    updateId: z.uuid(),
  });
  
  const regenerateSchema = z.strictObject({
    expectedRevision: z.number().int().min(1),
  });
  
  type SourceRow = {
    id: string;
    child_id: string;
    observation_date: string;
    category: string;
    text: string;
  };
  
  type GenerationRoutesOptions = {
    generator?: DraftGenerator;
  };
  
  const revisionColumns = `
    id,
    update_id,
    revision_number,
    text,
    source_snapshot,
    created_by,
    generation_id`;
  
  // The same columns, in the same shape, as draft_revisions.source_snapshot.
  async function currentSources(
    client: PoolClient,
    childId: string,
    observationDate: string
  ): Promise<SourceRow[]> {
    const sources = await client.query<SourceRow>(
      `SELECT
         id,
         child_id,
         observation_date::text AS observation_date,
         category,
         text
       FROM observations
       WHERE child_id = $1
         AND observation_date = $2
       ORDER BY created_at, id`,
      [childId, observationDate]
    );
  
    return sources.rows;
  }
  
  function generationInput(
    childName: string,
    observationDate: string,
    sources: SourceRow[]
  ): GenerationInput {
    return {
      childName,
      observationDate,
      observations: sources.map((source) => ({
        id: source.id,
        category: source.category,
        text: source.text,
      })),
    };
  }
  
  // Locks the child and the caller's membership until the transaction
  // ends, so access cannot be revoked part-way through.
  async function childAccess(
    client: PoolClient,
    childId: string,
    userId: string,
    roles: string[]
  ): Promise<{ first_name: string } | undefined> {
    const access = await client.query<{ first_name: string }>(
      `SELECT c.first_name
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
      [childId, userId, roles]
    );
  
    return access.rows[0];
  }
  
  // As childAccess, starting from an update. The update row itself is
  // locked for update when a revision is about to be saved, matching the
  // lock taken by manual revisions and approvals.
  async function updateAccess(
    client: PoolClient,
    updateId: string,
    userId: string,
    roles: string[],
    lockUpdate: boolean
  ): Promise<
    | {
        child_id: string;
        observation_date: string;
        first_name: string;
      }
    | undefined
  > {
    const lock = lockUpdate
      ? "FOR UPDATE OF u FOR SHARE OF c, sm, au"
      : "FOR SHARE OF c, sm, au";
  
    const access = await client.query<{
      child_id: string;
      observation_date: string;
      first_name: string;
    }>(
      `SELECT
         u.child_id,
         u.observation_date::text AS observation_date,
         c.first_name
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
       ${lock}`,
      [updateId, userId, roles]
    );
  
    return access.rows[0];
  }
  
  async function latestRevisionNumber(
    client: PoolClient,
    updateId: string
  ): Promise<number | undefined> {
    const latest = await client.query<{ revision_number: number }>(
      `SELECT revision_number
       FROM draft_revisions
       WHERE update_id = $1
       ORDER BY revision_number DESC
       LIMIT 1`,
      [updateId]
    );
  
    return latest.rows[0]?.revision_number;
  }
  
  async function recordAttempt(
    client: PoolClient,
    attempt: {
      childId: string;
      observationDate: string;
      updateId: string | null;
      requestedBy: string;
      input: GenerationInput;
      sources: SourceRow[];
    }
  ): Promise<string> {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO draft_generations (
         child_id,
         observation_date,
         update_id,
         requested_by,
         requested_model,
         prompt_version,
         prompt_text,
         input_snapshot,
         source_snapshot
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
       RETURNING id`,
      [
        attempt.childId,
        attempt.observationDate,
        attempt.updateId,
        attempt.requestedBy,
        generationModel,
        generationPromptVersion,
        generationPrompt,
        JSON.stringify(attempt.input),
        JSON.stringify(attempt.sources),
      ]
    );
  
    const id = inserted.rows[0]?.id;
  
    if (!id) {
      throw new Error("Draft generation was not recorded");
    }
  
    return id;
  }
  
  // Calls the model with no database connection held, then records the
  // outcome. Returns null if generation failed; the failure is recorded.
  async function runGeneration(
    generator: DraftGenerator,
    generationId: string,
    input: GenerationInput,
    log: FastifyBaseLogger
  ): Promise<GenerationResult | null> {
    try {
      const result = await generator(input);
  
      await pool.query(
        `UPDATE draft_generations
         SET status = 'completed',
             output_text = $2,
             returned_model = $3,
             usage = $4::jsonb,
             completed_at = now()
         WHERE id = $1`,
        [
          generationId,
          result.text,
          result.model,
          JSON.stringify(result.usage ?? null),
        ]
      );
  
      return result;
    } catch (error) {
      const category =
        error instanceof Error ? error.name : "UnknownError";
  
      await pool.query(
        `UPDATE draft_generations
         SET status = 'error',
             error_message = $2,
             completed_at = now()
         WHERE id = $1`,
        [generationId, `Generation failed (${category})`]
      );
  
      log.error(
        {
          generationId,
          category,
        },
        "Draft generation failed"
      );
  
      return null;
    }
  }
  
  // Saves the generated text and sources exactly as recorded, so the
  // revision cannot drift from the generation. The database checks this
  // again (migration 019).
  async function insertGeneratedRevision(
    client: PoolClient,
    updateId: string,
    revisionNumber: number,
    generationId: string
  ) {
    const revision = await client.query(
      `INSERT INTO draft_revisions (
         update_id,
         revision_number,
         text,
         source_snapshot,
         created_by,
         generation_id
       )
       SELECT
         $1,
         $2,
         g.output_text,
         g.source_snapshot,
         g.requested_by,
         g.id
       FROM draft_generations g
       WHERE g.id = $3
       RETURNING ${revisionColumns}`,
      [updateId, revisionNumber, generationId]
    );
  
    const saved = revision.rows[0];
  
    if (!saved) {
      throw new Error("Generated revision was not saved");
    }
  
    return saved;
  }
  
  async function inTransaction<T>(
    work: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await pool.connect();
  
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  
  // Thrown inside a transaction to roll it back and send a response.
  class Refusal {
    constructor(
      readonly statusCode: number,
      readonly body: Record<string, unknown>
    ) {}
  }
  
  export async function generationRoutes(
    app: FastifyInstance,
    options: GenerationRoutesOptions
  ) {
    const generator = options.generator ?? generateDraft;
  
    const permittedRoles = staffRolesFor("draft:create");
  
    app.post("/drafts/generate", async (request, reply) => {
      const parsed = generateDraftSchema.safeParse(request.body);
  
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Invalid draft generation request",
          issues: parsed.error.issues,
        });
      }
  
      const actor = request.actor;
  
      if (!actor) {
        throw new Error(
          "Protected route reached without an authenticated actor"
        );
      }
  
      const { childId, observationDate } = parsed.data;
  
      let prepared: {
        generationId: string;
        input: GenerationInput;
      };
  
      try {
        prepared = await inTransaction(async (client) => {
          const child = await childAccess(
            client,
            childId,
            actor.userId,
            permittedRoles
          );
  
          if (!child) {
            throw new Refusal(403, {
              error: "Not permitted to create drafts for this child",
            });
          }
  
          const existing = await client.query(
            `SELECT id
             FROM updates
             WHERE child_id = $1
               AND observation_date = $2`,
            [childId, observationDate]
          );
  
          if (existing.rows.length > 0) {
            throw new Refusal(409, {
              error: "An update already exists for this child and date",
            });
          }
  
          const sources = await currentSources(
            client,
            childId,
            observationDate
          );
  
          if (sources.length === 0) {
            throw new Refusal(400, {
              error: "No observations found for this child and date",
            });
          }
  
          const input = generationInput(
            child.first_name,
            observationDate,
            sources
          );
  
          const generationId = await recordAttempt(client, {
            childId,
            observationDate,
            updateId: null,
            requestedBy: actor.userId,
            input,
            sources,
          });
  
          return { generationId, input };
        });
      } catch (error) {
        if (error instanceof Refusal) {
          return reply.code(error.statusCode).send(error.body);
        }
  
        throw error;
      }
  
      const { generationId, input } = prepared;
  
      const result = await runGeneration(
        generator,
        generationId,
        input,
        request.log
      );
  
      if (!result) {
        return reply.code(502).send({
          error: "Draft generation failed",
          generationId,
        });
      }
  
      try {
        const draft = await inTransaction(async (client) => {
          const child = await childAccess(
            client,
            childId,
            actor.userId,
            permittedRoles
          );
  
          if (!child) {
            throw new Refusal(403, {
              error: "Draft access changed; the draft was not saved",
              generationId,
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
            [childId, observationDate]
          );
  
          const updateId = update.rows[0]?.id;
  
          if (!updateId) {
            throw new Refusal(409, {
              error:
                "An update was created for this child and date " +
                "while the draft was being written",
              generationId,
            });
          }
  
          return insertGeneratedRevision(
            client,
            updateId,
            1,
            generationId
          );
        });
  
        return reply.code(201).send({
          generationId,
          draft,
        });
      } catch (error) {
        if (error instanceof Refusal) {
          return reply.code(error.statusCode).send(error.body);
        }
  
        throw error;
      }
    });
  
    app.post(
      "/updates/:updateId/generations",
      async (request, reply) => {
        const params = updateParamsSchema.safeParse(request.params);
        const body = regenerateSchema.safeParse(request.body);
  
        if (!params.success || !body.success) {
          return reply.code(400).send({
            error: "Invalid update ID or generation input",
          });
        }
  
        const actor = request.actor;
  
        if (!actor) {
          throw new Error(
            "Protected route reached without an authenticated actor"
          );
        }
  
        const { updateId } = params.data;
        const { expectedRevision } = body.data;
  
        const staleRevision = (
          currentRevision: number | undefined,
          generationId?: string
        ) =>
          new Refusal(409, {
            error: "This draft has changed. Load the latest revision.",
            currentRevision,
            ...(generationId ? { generationId } : {}),
          });
  
        let prepared: {
          generationId: string;
          input: GenerationInput;
        };
  
        try {
          prepared = await inTransaction(async (client) => {
            const update = await updateAccess(
              client,
              updateId,
              actor.userId,
              permittedRoles,
              false
            );
  
            // The same response covers a missing update and one in
            // another setting, avoiding ID enumeration.
            if (!update) {
              throw new Refusal(403, {
                error: "Not permitted to revise this update",
              });
            }
  
            // Checked before the model is called, so a stale request
            // costs nothing.
            const latest = await latestRevisionNumber(client, updateId);
  
            if (latest !== expectedRevision) {
              throw staleRevision(latest);
            }
  
            const sources = await currentSources(
              client,
              update.child_id,
              update.observation_date
            );
  
            if (sources.length === 0) {
              throw new Refusal(400, {
                error: "No current observations available",
              });
            }
  
            const input = generationInput(
              update.first_name,
              update.observation_date,
              sources
            );
  
            const generationId = await recordAttempt(client, {
              childId: update.child_id,
              observationDate: update.observation_date,
              updateId,
              requestedBy: actor.userId,
              input,
              sources,
            });
  
            return { generationId, input };
          });
        } catch (error) {
          if (error instanceof Refusal) {
            return reply.code(error.statusCode).send(error.body);
          }
  
          throw error;
        }
  
        const { generationId, input } = prepared;
  
        const result = await runGeneration(
          generator,
          generationId,
          input,
          request.log
        );
  
        if (!result) {
          return reply.code(502).send({
            error: "Draft generation failed",
            generationId,
          });
        }
  
        try {
          const draft = await inTransaction(async (client) => {
            const update = await updateAccess(
              client,
              updateId,
              actor.userId,
              permittedRoles,
              true
            );
  
            if (!update) {
              throw new Refusal(403, {
                error: "Draft access changed; the draft was not saved",
                generationId,
              });
            }
  
            // Someone may have saved a revision while the model was
            // writing. Their work is not overwritten.
            const latest = await latestRevisionNumber(client, updateId);
  
            if (latest !== expectedRevision) {
              throw staleRevision(latest, generationId);
            }
  
            return insertGeneratedRevision(
              client,
              updateId,
              expectedRevision + 1,
              generationId
            );
          });
  
          return reply.code(201).send({
            generationId,
            draft,
          });
        } catch (error) {
          if (error instanceof Refusal) {
            return reply.code(error.statusCode).send(error.body);
          }
  
          throw error;
        }
      }
    );
  }