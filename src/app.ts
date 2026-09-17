// src/app.ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import { approvalRoutes } from "./approvals.js";
import { draftRoutes } from "./drafts.js";
import { evaluationRoutes } from "./evaluations.js";
import { publicationRoutes } from "./publications.js";
import { observationRoutes } from "./observations.js";
import { contentReviewRoutes } from "./content-reviews.js";
import { generationRoutes } from "./generations.js";
import { meRoutes } from "./me.js";
import { staffViewRoutes } from "./staff-views.js";
import type { ContentReviewer } from "./content-reviewer.js";
import type { DraftGenerator } from "./draft-generator.js";
import {
  registerAuthentication,
  type Authenticator,
} from "./authentication.js";

type BuildAppOptions = {
  logger?: boolean;
  reviewer?: ContentReviewer;
  generator?: DraftGenerator;
  authenticator?: Authenticator;
  // Browser addresses allowed to call this API, such as the web app.
  // Leave empty to allow none; requests from other tools are unaffected.
  corsOrigins?: string[];
};

export function buildApp(
  options: BuildAppOptions = {}
) {
  const app = Fastify({
    logger: options.logger ?? true,
  });

  // Registered before authentication so a browser's preflight check,
  // which never carries a login token, is answered first. Only listed
  // origins are allowed, and no cookies are used: the app sends its
  // token in the Authorization header.
  const corsOrigins = options.corsOrigins ?? [];

  if (corsOrigins.length > 0) {
    app.register(cors, {
      origin: corsOrigins,
      methods: ["GET", "POST"],
      allowedHeaders: ["authorization", "content-type"],
      credentials: false,
      maxAge: 600,
    });
  }

  registerAuthentication(
    app,
    options.authenticator
  );

  app.get(
    "/health",
    {
      config: {
        public: true,
      },
    },
    async () => {
      return {
        status: "ok",
        service: "Daily Updates",
      };
    }
  );

  app.register(meRoutes);
  app.register(staffViewRoutes);
  app.register(observationRoutes);
  app.register(draftRoutes);
  app.register(generationRoutes, {
    generator: options.generator,
  });
  app.register(evaluationRoutes);
  app.register(contentReviewRoutes, {
    reviewer: options.reviewer,
  });
  app.register(approvalRoutes);
  app.register(publicationRoutes);

  return app;
}
