// src/app.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Authenticator } from "./authentication.js";

process.env.DATABASE_URL ??=
  "postgresql://test:test@127.0.0.1:5432/test";

process.env.ANTHROPIC_API_KEY ??= "test-only";

const { buildApp } = await import("./app.js");

const fakeAuthenticator: Authenticator = async () => ({
  userId: "00000000-0000-4000-8000-000000000001",
  issuer: "https://identity.example.test",
  subject: "test-user",
});

test("health endpoint remains public", async (t) => {
  const app = buildApp({
    logger: false,
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "GET",
    url: "/health",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    status: "ok",
    service: "Daily Updates",
  });
});

test(
  "protected endpoints reject unauthenticated requests",
  async (t) => {
    const app = buildApp({
      logger: false,
    });

    t.after(async () => {
      await app.close();
    });

    const response = await app.inject({
      method: "POST",
      url: "/observations/validate",
      payload: {
        childId: "demo-ava",
        category: "activity",
        text: "Painted with sponges.",
      },
    });

    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), {
      error: "Authentication required",
    });
  }
);

test(
  "authenticated requests reach protected validation",
  async (t) => {
    const app = buildApp({
      logger: false,
      authenticator: fakeAuthenticator,
    });

    t.after(async () => {
      await app.close();
    });

    const response = await app.inject({
      method: "POST",
      url: "/observations/validate",
      payload: {
        childId: "demo-ava",
        category: "activity",
        text: "   ",
      },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(
      response.json().error,
      "Invalid observation"
    );
  }
);

const webOrigin = "https://app.example.test";

test(
  "a listed web app origin passes the browser preflight without a token",
  async (t) => {
    const app = buildApp({
      logger: false,
      corsOrigins: [webOrigin],
    });

    t.after(async () => {
      await app.close();
    });

    const response = await app.inject({
      method: "OPTIONS",
      url: "/me",
      headers: {
        origin: webOrigin,
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });

    assert.equal(response.statusCode, 204);
    assert.equal(
      response.headers["access-control-allow-origin"],
      webOrigin
    );
    assert.match(
      String(response.headers["access-control-allow-headers"]),
      /authorization/i
    );
    assert.equal(
      response.headers["access-control-allow-credentials"],
      undefined
    );
  }
);

test(
  "the preflight does not let a browser skip authentication",
  async (t) => {
    const app = buildApp({
      logger: false,
      corsOrigins: [webOrigin],
    });

    t.after(async () => {
      await app.close();
    });

    const response = await app.inject({
      method: "GET",
      url: "/me",
      headers: {
        origin: webOrigin,
      },
    });

    assert.equal(response.statusCode, 401);
    assert.equal(
      response.headers["access-control-allow-origin"],
      webOrigin
    );
  }
);

test(
  "an unlisted origin is not granted browser access",
  async (t) => {
    const app = buildApp({
      logger: false,
      corsOrigins: [webOrigin],
    });

    t.after(async () => {
      await app.close();
    });

    const response = await app.inject({
      method: "OPTIONS",
      url: "/me",
      headers: {
        origin: "https://evil.example.test",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });

    assert.equal(
      response.headers["access-control-allow-origin"],
      undefined
    );
  }
);

test(
  "no origin is granted browser access unless configured",
  async (t) => {
    const app = buildApp({
      logger: false,
      authenticator: fakeAuthenticator,
    });

    t.after(async () => {
      await app.close();
    });

    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: {
        origin: webOrigin,
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(
      response.headers["access-control-allow-origin"],
      undefined
    );
  }
);
