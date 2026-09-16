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
import {
  createOidcAuthenticator,
  oidcConfigFromEnvironment,
  type OidcConfig,
} from "./oidc-authenticator.js";

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