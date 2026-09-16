import {
    createRemoteJWKSet,
    errors,
    jwtVerify,
    type JWTVerifyGetKey,
  } from "jose";
  import { z } from "zod";
  import {
    createBearerAuthenticator,
    type Authenticator,
  } from "./authentication.js";
  import { pool } from "./db.js";

  const oidcEnvironmentSchema = z.object({
    AUTH_ISSUER: z.url(),
    AUTH_AUDIENCE: z.string().trim().min(1),
    AUTH_JWKS_URL: z.url(),
    AUTH_ALGORITHMS: z
      .string()
      .trim()
      .min(1)
      .default("RS256"),
  });

  export type OidcConfig = {
    issuer: string;
    audience: string;
    jwksUrl: string;
    algorithms: string[];
  };

  type ActiveUser = {
    id: string;
  };

  type ActiveUserLookup = (
    issuer: string,
    subject: string
  ) => Promise<ActiveUser | null>;

  type OidcAuthenticatorOptions = {
    getKey?: JWTVerifyGetKey;
    findActiveUser?: ActiveUserLookup;
  };

  const rejectedCredentialCodes = new Set([
    "ERR_JOSE_ALG_NOT_ALLOWED",
    "ERR_JWS_INVALID",
    "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
    "ERR_JWT_CLAIM_VALIDATION_FAILED",
    "ERR_JWT_EXPIRED",
    "ERR_JWT_INVALID",
    "ERR_JWKS_NO_MATCHING_KEY",
  ]);

  export function oidcConfigFromEnvironment(
    environment: NodeJS.ProcessEnv = process.env
  ): OidcConfig {
    const parsed = oidcEnvironmentSchema.parse(environment);

    const algorithms = parsed.AUTH_ALGORITHMS
      .split(",")
      .map((algorithm) => algorithm.trim())
      .filter((algorithm) => algorithm.length > 0);

    if (algorithms.length === 0) {
      throw new Error(
        "AUTH_ALGORITHMS must contain at least one algorithm"
      );
    }

    return {
      issuer: parsed.AUTH_ISSUER,
      audience: parsed.AUTH_AUDIENCE,
      jwksUrl: parsed.AUTH_JWKS_URL,
      algorithms,
    };
  }

  async function findActiveDatabaseUser(
    issuer: string,
    subject: string
  ): Promise<ActiveUser | null> {
    const users = await pool.query<ActiveUser>(
      `SELECT id
       FROM app_users
       WHERE identity_issuer = $1
         AND identity_subject = $2
         AND disabled_at IS NULL`,
      [issuer, subject]
    );

    return users.rows[0] ?? null;
  }

  function isRejectedCredential(error: unknown): boolean {
    return (
      error instanceof errors.JOSEError &&
      rejectedCredentialCodes.has(error.code)
    );
  }

  export function createOidcAuthenticator(
    config: OidcConfig,
    options: OidcAuthenticatorOptions = {}
  ): Authenticator {
    const getKey =
      options.getKey ??
      createRemoteJWKSet(new URL(config.jwksUrl));

    const findActiveUser =
      options.findActiveUser ?? findActiveDatabaseUser;

    return createBearerAuthenticator(async (token) => {
      let issuer: string;
      let subject: string;

      try {
        const { payload } = await jwtVerify(
          token,
          getKey,
          {
            issuer: config.issuer,
            audience: config.audience,
            algorithms: config.algorithms,
          }
        );

        if (
          typeof payload.iss !== "string" ||
          typeof payload.sub !== "string"
        ) {
          return null;
        }

        issuer = payload.iss;
        subject = payload.sub;
      } catch (error) {
        if (isRejectedCredential(error)) {
          return null;
        }

        // Network, JWKS service, and other infrastructure
        // failures are deliberately allowed to propagate. The
        // authentication hook converts them into a 503 response.
        throw error;
      }

      const user = await findActiveUser(issuer, subject);

      if (!user) {
        return null;
      }

      return {
        userId: user.id,
        issuer,
        subject,
      };
    });
  }