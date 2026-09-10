import Fastify from "fastify";
import { z } from "zod";

const app = Fastify({
  logger: true,
});

const observationSchema = z.strictObject({
    childId: z.string().trim().min(1),
    category: z.enum(["activity", "food", "sleep", "general"]),
    text: z.string().trim().min(1).max(1000),
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

try {
  await app.listen({
    port: 3001,
    host: "127.0.0.1",
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}