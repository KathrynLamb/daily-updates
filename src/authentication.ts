// src/authentication.ts

import type {
  FastifyInstance,
  FastifyRequest,
} from "fastify";

export type AuthenticatedActor = {
  userId: string;
  issuer: string;
  subject: string;
};

export type BearerTokenVerifier = (
  token: string
) => Promise<AuthenticatedActor | null>;

export type Authenticator = (
  request: FastifyRequest
) => Promise<AuthenticatedActor | null>;

declare module "fastify" {
  interface FastifyRequest {
    actor: AuthenticatedActor | null;
  }

  interface FastifyContextConfig {
    public?: boolean;
  }
}

export function extractBearerToken(
  authorizationHeader: string | string[] | undefined
): string | null {
  if (typeof authorizationHeader !== "string") {
    return null;
  }

  const match = /^Bearer ([^\s]+)$/i.exec(
    authorizationHeader.trim()
  );

  return match?.[1] ?? null;
}

export function createBearerAuthenticator(
  verifyToken: BearerTokenVerifier
): Authenticator {
  return async (request) => {
    const token = extractBearerToken(
      request.headers.authorization
    );

    if (!token) {
      return null;
    }

    return verifyToken(token);
  };
}

const denyAllAuthenticator: Authenticator = async () =>
  null;

export function registerAuthentication(
  app: FastifyInstance,
  authenticate: Authenticator = denyAllAuthenticator
) {
  app.decorateRequest("actor", null);

  app.addHook("preHandler", async (request, reply) => {
    if (request.routeOptions.config.public === true) {
      return;
    }

    let actor: AuthenticatedActor | null;

    try {
      actor = await authenticate(request);
    } catch (error) {
      // Fastify's logger only includes an error's message and stack
      // when it is passed under the "err" key.
      request.log.error(
        { err: error },
        "Authentication service failed"
      );

      return reply.code(503).send({
        error: "Authentication unavailable",
      });
    }

    if (!actor) {
      return reply.code(401).send({
        error: "Authentication required",
      });
    }

    request.actor = actor;
  });
}