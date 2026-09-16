// src/auth-link.ts
//
// Gives a logged-in demo account its role in the local database, using
// the identity from its saved login token. Safe to run more than once.
//
// Run: npm run auth:link -- practitioner
//
// Only for the local database. Real deployments will need a proper way
// to invite and manage users.

import "dotenv/config";
import {
  demoAccountFromArguments,
  demoAccounts,
  loadToken,
} from "./demo-accounts.js";

const account = demoAccountFromArguments();
const token = await loadToken(account);

if (!token) {
  console.error(
    `No current login for ${account}. ` +
      `Run: npm run auth:login -- ${account}`
  );
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;

if (
  !databaseUrl ||
  !["127.0.0.1", "localhost", "::1"].includes(
    new URL(databaseUrl).hostname
  )
) {
  console.error("auth:link only changes a database on this computer.");
  process.exit(1);
}

const { pool } = await import("./db.js");

let client;

try {
  client = await pool.connect();
} catch {
  console.error(
    "Could not reach the local database. Is Docker running, and has " +
      "it been created with npm run local:db?"
  );
  await pool.end();
  process.exit(1);
}

try {
  await client.query("BEGIN");

  const users = await client.query<{ id: string }>(
    `INSERT INTO app_users (identity_issuer, identity_subject)
     VALUES ($1, $2)
     ON CONFLICT (identity_issuer, identity_subject)
     DO UPDATE SET identity_subject = EXCLUDED.identity_subject
     RETURNING id`,
    [token.issuer, token.subject]
  );

  const userId = users.rows[0]?.id;

  if (!userId) {
    throw new Error("The user was not saved");
  }

  const access = demoAccounts[account].access;

  if ("child" in access) {
    await client.query(
      `INSERT INTO parent_child_access (user_id, child_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [userId, access.child]
    );
  } else {
    await client.query(
      `INSERT INTO setting_memberships (user_id, setting_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, setting_id)
       DO UPDATE SET role = EXCLUDED.role`,
      [userId, access.setting, access.role]
    );
  }

  await client.query("COMMIT");

  console.log(
    `Linked ${token.subject} as the demo ${account} ` +
      `(${demoAccounts[account].description}).`
  );
} catch (error) {
  await client.query("ROLLBACK");

  console.error(
    "Could not link the account. Has the local database been " +
      "created with npm run local:db?"
  );
  console.error(error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}