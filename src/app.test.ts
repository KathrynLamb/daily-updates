import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./app.js";

test("health endpoint identifies the service", async (t) => {
  const app = buildApp({ logger: false });

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
  "observation validation rejects whitespace-only text",
  async (t) => {
    const app = buildApp({ logger: false });

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