import Fastify from "fastify";
import { approvalRoutes } from "./approvals.js";
import { draftRoutes } from "./drafts.js";
import { evaluationRoutes } from "./evaluations.js";
import { publicationRoutes } from "./publications.js";
import { observationRoutes } from "./observations.js";
import { contentReviewRoutes } from "./content-reviews.js";
import type { ContentReviewer } from "./content-reviewer.js";
import {
  registerAuthentication,
  type Authenticator,
} from "./authentication.js";

type BuildAppOptions = {
  logger?: boolean;
  reviewer?: ContentReviewer;
  authenticator?: Authenticator;
};

export function buildApp(
  options: BuildAppOptions = {}
) {
  const app = Fastify({
    logger: options.logger ?? true,
  });

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

  app.register(observationRoutes);
  app.register(draftRoutes);
  app.register(evaluationRoutes);
  app.register(contentReviewRoutes, {
    reviewer: options.reviewer,
  });
  app.register(approvalRoutes);
  app.register(publicationRoutes);

  return app;
}