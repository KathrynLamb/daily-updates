// src/oidc-authenticator.test.ts
//
// These tests prove that the production OIDC authenticator accepts
// only correctly signed tokens issued for this API.
//
// The tests generate their own temporary signing keys. They therefore
// do not contact a real identity provider, download remote keys, or
// depend on any developer credentials.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyRequest } from "fastify";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";
import type {
  OidcConfig,
} from "./oidc-authenticator.js";

// Importing the production authenticator also loads the database
// module. Unit tests inject their own user lookup and never connect
// to PostgreSQL, but the database module still requires a connection
// string while it is being initialized.
//
// Supply a non-secret placeholder before the runtime import so these
// tests behave the same on a clean CI machine and on a developer
// computer with a local .env file.
process.env.DATABASE_URL ??=
  "postgresql://test:test@127.0.0.1:5432/test";

// A dynamic import runs only after the test environment above has
// been established. The type-only import is removed by TypeScript
// and therefore does not initialize the database module.
const {
  createOidcAuthenticator,
  oidcConfigFromEnvironment,
} = await import("./oidc-authenticator.js");

// This represents the identity provider configuration trusted by the
// API during these tests.
const config: OidcConfig = {
  issuer: "https://identity.example.test/",
  audience: "daily-updates-api",
  jwksUrl:
    "https://identity.example.test/.well-known/jwks.json",
  algorithms: ["RS256"],
};

// Generate a temporary RSA key pair.
//
// The private key plays the role of the identity provider: it signs
// test tokens.
//
// The public key plays the role of the API: it verifies that tokens
// were genuinely signed by the trusted provider.
const trustedKeys = await generateKeyPair("RS256");

const trustedPublicJwk = {
  ...(await exportJWK(trustedKeys.publicKey)),
  kid: "trusted-test-key",
  alg: "RS256",
  use: "sig",
};

// A local key set exercises the same signature verification used in
// production without making an internet request.
const trustedKeySet = createLocalJWKSet({
  keys: [trustedPublicJwk],
});

// Build the minimum Fastify request shape needed by the existing
// bearer authenticator.
//
// The production request contains many more fields, but authentication
// reads only the Authorization header.
function requestWithToken(token: string): FastifyRequest {
  return {
    headers: {
      authorization: `Bearer ${token}`,
    },
  } as unknown as FastifyRequest;
}

type TokenOptions = {
  issuer?: string;
  audience?: string;
  subject?: string;
  expiresAt?: number | string;
  signingKey?: CryptoKey;
  keyId?: string;
};

// Create a signed access token while allowing each test to alter one
// security property at a time.
async function createToken(
  options: TokenOptions = {}
): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({
      alg: "RS256",
      kid: options.keyId ?? "trusted-test-key",
    })
    .setIssuer(options.issuer ?? config.issuer)
    .setAudience(options.audience ?? config.audience)
    .setSubject(options.subject ?? "external-user-123")
    .setIssuedAt()
    .setExpirationTime(options.expiresAt ?? "5m")
    .sign(options.signingKey ?? trustedKeys.privateKey);
}

test(
  "reads and validates OIDC configuration from the environment",
  () => {
    const result = oidcConfigFromEnvironment({
      AUTH_ISSUER: "https://identity.example.test/",
      AUTH_AUDIENCE: "daily-updates-api",
      AUTH_JWKS_URL:
        "https://identity.example.test/.well-known/jwks.json",
      AUTH_ALGORITHMS: "RS256, ES256",
    });

    assert.deepEqual(result, {
      issuer: "https://identity.example.test/",
      audience: "daily-updates-api",
      jwksUrl:
        "https://identity.example.test/.well-known/jwks.json",
      algorithms: ["RS256", "ES256"],
    });
  }
);

test(
  "uses RS256 when no algorithm list is supplied",
  () => {
    const result = oidcConfigFromEnvironment({
      AUTH_ISSUER: "https://identity.example.test/",
      AUTH_AUDIENCE: "daily-updates-api",
      AUTH_JWKS_URL:
        "https://identity.example.test/.well-known/jwks.json",
    });

    assert.deepEqual(result.algorithms, ["RS256"]);
  }
);

test(
  "accepts a valid token for an active application user",
  async () => {
    const token = await createToken();

    const authenticator = createOidcAuthenticator(
      config,
      {
        getKey: trustedKeySet,
        findActiveUser: async (issuer, subject) => {
          // The database lookup must receive identity claims that
          // came from the verified token.
          assert.equal(issuer, config.issuer);
          assert.equal(subject, "external-user-123");

          return {
            id: "internal-user-456",
          };
        },
      }
    );

    const actor = await authenticator(
      requestWithToken(token)
    );

    assert.deepEqual(actor, {
      userId: "internal-user-456",
      issuer: config.issuer,
      subject: "external-user-123",
    });
  }
);

test(
  "rejects a genuine identity that has no active app user",
  async () => {
    const token = await createToken();

    const authenticator = createOidcAuthenticator(
      config,
      {
        getKey: trustedKeySet,
        findActiveUser: async () => null,
      }
    );

    const actor = await authenticator(
      requestWithToken(token)
    );

    assert.equal(actor, null);
  }
);

test(
  "rejects a token issued by another authority",
  async () => {
    const token = await createToken({
      issuer: "https://untrusted.example.test/",
    });

    let lookupWasCalled = false;

    const authenticator = createOidcAuthenticator(
      config,
      {
        getKey: trustedKeySet,
        findActiveUser: async () => {
          lookupWasCalled = true;
          return {
            id: "internal-user-456",
          };
        },
      }
    );

    const actor = await authenticator(
      requestWithToken(token)
    );

    assert.equal(actor, null);
    assert.equal(lookupWasCalled, false);
  }
);

test(
  "rejects a token intended for another application",
  async () => {
    const token = await createToken({
      audience: "another-api",
    });

    const authenticator = createOidcAuthenticator(
      config,
      {
        getKey: trustedKeySet,
        findActiveUser: async () => ({
          id: "internal-user-456",
        }),
      }
    );

    const actor = await authenticator(
      requestWithToken(token)
    );

    assert.equal(actor, null);
  }
);

test("rejects an expired token", async () => {
  const oneMinuteAgo =
    Math.floor(Date.now() / 1000) - 60;

  const token = await createToken({
    expiresAt: oneMinuteAgo,
  });

  const authenticator = createOidcAuthenticator(
    config,
    {
      getKey: trustedKeySet,
      findActiveUser: async () => ({
        id: "internal-user-456",
      }),
    }
  );

  const actor = await authenticator(
    requestWithToken(token)
  );

  assert.equal(actor, null);
});

test(
  "rejects a token signed with an untrusted private key",
  async () => {
    // The token contains the expected issuer, audience, and subject,
    // but its signature was created by a different key.
    const untrustedKeys =
      await generateKeyPair("RS256");

    const token = await createToken({
      signingKey: untrustedKeys.privateKey,
    });

    const authenticator = createOidcAuthenticator(
      config,
      {
        getKey: trustedKeySet,
        findActiveUser: async () => ({
          id: "internal-user-456",
        }),
      }
    );

    const actor = await authenticator(
      requestWithToken(token)
    );

    assert.equal(actor, null);
  }
);

test(
  "propagates database failures as service failures",
  async () => {
    const token = await createToken();

    const authenticator = createOidcAuthenticator(
      config,
      {
        getKey: trustedKeySet,
        findActiveUser: async () => {
          throw new Error("Database unavailable");
        },
      }
    );

    // The error must not be converted into a rejected credential.
    // The Fastify authentication hook will turn this operational
    // failure into a 503 Authentication unavailable response.
    await assert.rejects(
      () =>
        authenticator(requestWithToken(token)),
      /Database unavailable/
    );
  }
);

// Anyone can send these tokens without holding a signing key, so
// they must be treated as bad credentials (401), never as an
// authentication outage (503).

function unsignedToken(header: object): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");

  return [
    encode(header),
    encode({
      iss: config.issuer,
      aud: config.audience,
      sub: "external-user-123",
    }),
    Buffer.from("not-a-signature").toString("base64url"),
  ].join(".");
}

test(
  "rejects a token with an unrecognised critical header",
  async () => {
    const token = unsignedToken({
      alg: "RS256",
      kid: "trusted-test-key",
      crit: ["unrecognised-extension"],
      "unrecognised-extension": true,
    });

    const authenticator = createOidcAuthenticator(
      config,
      {
        getKey: trustedKeySet,
        findActiveUser: async () => ({
          id: "internal-user-456",
        }),
      }
    );

    const actor = await authenticator(
      requestWithToken(token)
    );

    assert.equal(actor, null);
  }
);

test(
  "rejects a token without a key ID when several keys are published",
  async () => {
    // Identity providers publish more than one key while rotating
    // them, so a missing key ID cannot select a single key.
    const rotatedKeys = await generateKeyPair("RS256");

    const keySetDuringRotation = createLocalJWKSet({
      keys: [
        trustedPublicJwk,
        {
          ...(await exportJWK(rotatedKeys.publicKey)),
          kid: "rotated-test-key",
          alg: "RS256",
          use: "sig",
        },
      ],
    });

    const token = await new SignJWT({})
      .setProtectedHeader({
        alg: "RS256",
      })
      .setIssuer(config.issuer)
      .setAudience(config.audience)
      .setSubject("external-user-123")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(trustedKeys.privateKey);

    const authenticator = createOidcAuthenticator(
      config,
      {
        getKey: keySetDuringRotation,
        findActiveUser: async () => ({
          id: "internal-user-456",
        }),
      }
    );

    const actor = await authenticator(
      requestWithToken(token)
    );

    assert.equal(actor, null);
  }
);

test(
  "propagates key set download failures as service failures",
  async () => {
    const token = await createToken();

    const authenticator = createOidcAuthenticator(
      config,
      {
        getKey: async () => {
          throw new Error("Key set unavailable");
        },
        findActiveUser: async () => ({
          id: "internal-user-456",
        }),
      }
    );

    await assert.rejects(
      () =>
        authenticator(requestWithToken(token)),
      /Key set unavailable/
    );
  }
);