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