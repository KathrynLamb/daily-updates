// src/authentication.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import Fastify, { type FastifyRequest } from "fastify";
import {
  createBearerAuthenticator,
  extractBearerToken,
  registerAuthentication,
  type AuthenticatedActor,
} from "./authentication.js";

const actor: AuthenticatedActor = {
  userId: "00000000-0000-4000-8000-000000000001",
  issuer: "https://identity.example.test",
  subject: "test-user",
};

function requestWithAuthorization(
  authorization?: string
): FastifyRequest {
  return {
    headers: {
      authorization,
    },
  } as FastifyRequest;
}

test("extracts a bearer token", () => {
  assert.equal(
    extractBearerToken("Bearer test-token"),
    "test-token"
  );
});

test("the bearer scheme is case insensitive", () => {
  assert.equal(
    extractBearerToken("bearer test-token"),
    "test-token"
  );
});

test("surrounding header whitespace is harmless", () => {
  assert.equal(
    extractBearerToken("  Bearer test-token  "),
    "test-token"
  );
});

test("rejects missing and malformed authorization", () => {
  assert.equal(extractBearerToken(undefined), null);
  assert.equal(extractBearerToken(""), null);
  assert.equal(extractBearerToken("Basic credentials"), null);
  assert.equal(extractBearerToken("Bearer"), null);
  assert.equal(
    extractBearerToken("Bearer token extra"),
    null
  );
});

test("passes a valid token to the verifier", async () => {
  let receivedToken: string | null = null;

  const authenticate = createBearerAuthenticator(
    async (token) => {
      receivedToken = token;
      return actor;
    }
  );

  const result = await authenticate(
    requestWithAuthorization("Bearer test-token")
  );

  assert.equal(receivedToken, "test-token");
  assert.deepEqual(result, actor);
});

test("does not call the verifier without a bearer token", async () => {
  let verifierWasCalled = false;

  const authenticate = createBearerAuthenticator(async () => {
    verifierWasCalled = true;
    return actor;
  });

  const result = await authenticate(
    requestWithAuthorization()
  );

  assert.equal(verifierWasCalled, false);
  assert.equal(result, null);
});

test("rejects a token rejected by the verifier", async () => {
  const authenticate = createBearerAuthenticator(
    async () => null
  );

  const result = await authenticate(
    requestWithAuthorization("Bearer rejected-token")
  );

  assert.equal(result, null);
});

test(
  "an authentication outage returns 503 and logs the cause",
  async () => {
    const logLines: string[] = [];

    const app = Fastify({
      logger: {
        level: "error",
        stream: new Writable({
          write(chunk, _encoding, done) {
            logLines.push(chunk.toString());
            done();
          },
        }),
      },
    });

    registerAuthentication(app, async () => {
      throw new Error("Key set download timed out");
    });

    app.get("/protected", async () => ({ ok: true }));

    const response = await app.inject({
      method: "GET",
      url: "/protected",
    });

    await app.close();

    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), {
      error: "Authentication unavailable",
    });

    // The cause must reach the logs, but never the response.
    const logged = logLines.join("");

    assert.match(logged, /Authentication service failed/);
    assert.match(logged, /Key set download timed out/);
    assert.doesNotMatch(response.body, /Key set download/);
  }
);