import Fastify from "fastify";
import { z } from "zod";
import { pool } from "./db.js";
import { draftRoutes } from "./drafts.js";
import { evaluationRoutes } from "./evaluations.js";
import { contentReviewRoutes } from "./content-reviews.js";

const app = Fastify({
  logger: true,
});

app.register(draftRoutes);
app.register(evaluationRoutes);
app.register(contentReviewRoutes);

const observationSchema = z.strictObject({
    childId: z.string().trim().min(1),
    category: z.enum(["activity", "food", "sleep", "general"]),
    text: z.string().trim().min(1).max(1000),
  });

  const createObservationSchema = observationSchema.extend({
    observationDate: z.iso.date(),
  });

app.get("/health", async () => {
  return {
    status: "ok",
    service: "Daily Updates",
  };
});

app.post("/observations/validate", async (request, reply) => {
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
  });
  app.post("/observations", async (request, reply) => {
    const parsed = createObservationSchema.safeParse(request.body);
  
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid observation",
        issues: parsed.error.issues,
      });
    }
  
    const observation = parsed.data;
  
    try {
      const result = await pool.query(
        `INSERT INTO observations (
           child_id,
           observation_date,
           category,
           text
         )
         VALUES ($1, $2, $3, $4)
         RETURNING
           id,
           child_id,
           observation_date::text AS observation_date,
           category,
           text`,
        [
          observation.childId,
          observation.observationDate,
          observation.category,
          observation.text,
        ]
      );
  
      return reply.code(201).send({
        observation: result.rows[0],
      });
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "23503"
      ) {
        return reply.code(400).send({
          error: "The child does not exist",
        });
      }
  
      throw error;
    }
  });

try {
    const result = await pool.query(
        "SELECT current_database() AS database"
      );
    
      app.log.info(
        { database: result.rows[0].database },
        "Database connected"
      );

      app.get("/children/:childId/observations", async (request, reply) => {
        const paramsSchema = z.object({
          childId: z.string().trim().min(1),
        });
      
        const parsed = paramsSchema.safeParse(request.params);
      
        if (!parsed.success) {
          return reply.code(400).send({
            error: "Invalid child ID",
          });
        }
      
        const result = await pool.query(
          `SELECT
             id,
             child_id,
             observation_date::text AS observation_date,
             category,
             text
           FROM observations
           WHERE child_id = $1
           ORDER BY observation_date DESC, created_at DESC, id`,
          [parsed.data.childId]
        );
      
        return {
          observations: result.rows,
        };
      });
  await app.listen({
    port: 3001,
    host: "127.0.0.1",
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}