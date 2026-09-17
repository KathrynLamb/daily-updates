// src/local-server.ts
//
// Runs the API on your own computer for trying it by hand.
//
// By default there are no real logins: each request says who it is
// acting as with an "x-local-user" header naming one of the demo users in
// db/seed.sql: practitioner, approver, parent or outsider.
//
// With LOCAL_AUTH=oidc, requests must instead carry a real access token
// from the identity provider configured in .env, checked exactly as in
// production. See "Real login" in the README.
//
// This file is never used by the production entry point (src/index.ts).
// It also refuses to start unless both the server and the database are on
// this computer, so it cannot be pointed at real data by mistake.
//
// Run with: npm run local:server
// Add LOCAL_AI=fake to use built-in fake AI instead of calling Claude.
// Add LOCAL_AUTH=oidc to require real login tokens.

import "dotenv/config";
import type { Authenticator } from "./authentication.js";
import type { ContentReviewer } from "./content-reviewer.js";
import type { DraftGenerator } from "./draft-generator.js";

const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);

function refuse(reason: string): never {
  console.error(`Local server not started: ${reason}`);
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  refuse("NODE_ENV is production.");
}

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3001);

if (!loopbackHosts.has(host)) {
  refuse(`HOST must be this computer, not ${host}.`);
}

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  refuse("DATABASE_URL is missing.");
}

if (!loopbackHosts.has(new URL(databaseUrl).hostname)) {
  refuse("DATABASE_URL must point to a database on this computer.");
}

const fakeAi = process.env.LOCAL_AI === "fake";
const realLogin = process.env.LOCAL_AUTH === "oidc";

if (!fakeAi && !process.env.ANTHROPIC_API_KEY) {
  refuse(
    "ANTHROPIC_API_KEY is missing. Add it to .env, " +
      "or run with LOCAL_AI=fake."
  );
}

// Fake AI is only for trying the flow without an API key. It is not
// used to judge quality.
if (fakeAi) {
  // The Claude client module requires a key when loaded, even though
  // the fakes below never call it.
  if (!process.env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = "local-fake-ai";
  }
}

// Loaded after the checks above, because these modules connect to the
// database and read settings as soon as they are imported.
const { buildApp } = await import("./app.js");
const { pool } = await import("./db.js");

const localUsers: Record<string, string> = {
  practitioner: "10000000-0000-4000-8000-000000000001",
  approver: "10000000-0000-4000-8000-000000000002",
  parent: "10000000-0000-4000-8000-000000000003",
  outsider: "10000000-0000-4000-8000-000000000004",
};

const localAuthenticator: Authenticator = async (request) => {
  const name = request.headers["x-local-user"];

  if (typeof name !== "string") {
    return null;
  }

  const userId = localUsers[name];

  if (!userId) {
    return null;
  }

  return {
    userId,
    issuer: "local",
    subject: name,
  };
};

const fakeGenerator: DraftGenerator = async (input) => ({
  text: `${input.childName}'s day: ${input.observations
    .map((observation) => observation.text)
    .join(" ")}`,
  model: "local-fake-generator",
  promptVersion: "local-fake",
  usage: null,
});

const fakeReviewer: ContentReviewer = async (input) => {
  const { reviewModel, rubricVersion } = await import(
    "./review-schema.js"
  );

  const draft = input.draft.toLowerCase();

  const covered = input.observations
    .filter((observation) =>
      draft.includes(observation.text.toLowerCase().replace(/\.$/, ""))
    )
    .map((observation) => observation.id);

  const missing = input.observations
    .map((observation) => observation.id)
    .filter((id) => !covered.includes(id));

  return {
    verdict: "supported",
    reason: "Fake review: every observation appears word for word.",
    coverage: {
      verdict: missing.length === 0 ? "complete" : "incomplete",
      covered,
      missing,
      unknown: [],
      reason: "Fake review: matched observation text.",
    },
    model: reviewModel,
    rubricVersion,
    usage: null,
  };
};

let authenticator = localAuthenticator;

if (realLogin) {
  const { createOidcAuthenticator, oidcConfigFromEnvironment } =
    await import("./oidc-authenticator.js");

  let config;

  try {
    config = oidcConfigFromEnvironment();
  } catch {
    refuse(
      "LOCAL_AUTH=oidc needs AUTH_ISSUER, AUTH_AUDIENCE and " +
        "AUTH_JWKS_URL in .env."
    );
  }

  authenticator = createOidcAuthenticator(config);
}

// The Expo web app's development address. Override with APP_ORIGIN.
const appOrigin = process.env.APP_ORIGIN ?? "http://localhost:8081";

const app = buildApp({
  authenticator,
  corsOrigins: [appOrigin],
  ...(fakeAi
    ? {
        generator: fakeGenerator,
        reviewer: fakeReviewer,
      }
    : {}),
});

async function shutdown() {
  await app.close();
  await pool.end();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

try {
  await pool.query("SELECT 1");
  await app.listen({ host, port });

  console.log(
    `\nLocal server on http://${host}:${port}` +
      `\nWeb app allowed from: ${appOrigin}` +
      `\nAI: ${fakeAi ? "fake (no API calls)" : "real Claude"}` +
      (realLogin
        ? `\nLogin: real tokens from ${process.env.AUTH_ISSUER}` +
          `\nNext, in another terminal: npm run auth:walkthrough\n`
        : `\nLogin: x-local-user header (` +
          `${Object.keys(localUsers).join(", ")})` +
          `\nNext, in another terminal: npm run local:walkthrough\n`)
  );
} catch (error) {
  console.error(error);
  await pool.end();
  process.exit(1);
}