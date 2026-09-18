import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is missing");
}

if (process.env.ALLOW_DEMO_SEED !== "yes") {
  throw new Error("Refusing to load demo data unless ALLOW_DEMO_SEED=yes");
}

const sql = await readFile(path.resolve("db/seed.sql"), "utf8");
const client = new pg.Client({ connectionString });
await client.connect();

try {
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}

console.log("Demo data loaded.");
