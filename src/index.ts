// src/index.ts
//
// This is the production entry point.
//
// It validates the authentication configuration, builds the OIDC
// authenticator, creates the Fastify application, verifies the
// database connection, and starts accepting requests.

import { buildApp } from "./app.js";
import { pool } from "./db.js";
import {
  createOidcAuthenticator,
  oidcConfigFromEnvironment,
} from "./oidc-authenticator.js";

// Authentication configuration is validated before the server starts.
//
// If required settings are missing or invalid, startup fails instead
// of running a service whose protected routes cannot authenticate
// anyone.
const oidcConfig = oidcConfigFromEnvironment();

// The authenticator verifies signed access tokens and maps their
// external identities to active users in our own database.
const authenticator =
  createOidcAuthenticator(oidcConfig);

// Tests can still build the application with a controlled fake
// authenticator. This production entry point uses real OIDC.
// Browser origins allowed to call the API, comma-separated,
// for example: CORS_ORIGINS=https://app.example.com
const corsOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

const app = buildApp({
  authenticator,
  corsOrigins,
});

async function start() {
  try {
    // Confirm that PostgreSQL is reachable before advertising the
    // service as ready.
    const result = await pool.query<{
      database: string;
    }>(
      "SELECT current_database() AS database"
    );

    app.log.info(
      {
        database: result.rows[0]?.database,
        authenticationIssuer: oidcConfig.issuer,
        authenticationAudience: oidcConfig.audience,
      },
      "Database connected"
    );

    const port = Number(process.env.PORT ?? 3001);
    const host = process.env.HOST ?? "127.0.0.1";

    await app.listen({
      port,
      host,
    });
  } catch (error) {
    app.log.error(error);

    // Close database resources when startup fails rather than leaving
    // the process with open connections.
    await pool.end();
    process.exit(1);
  }
}

// Stop accepting requests and release database connections when the
// process manager, Docker, or the developer asks the service to stop.
async function shutdown(signal: string) {
  app.log.info(
    {
      signal,
    },
    "Shutting down"
  );

  try {
    await app.close();
    await pool.end();
    process.exit(0);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

await start();