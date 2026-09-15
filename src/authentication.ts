import type { FastifyRequest } from "fastify";

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