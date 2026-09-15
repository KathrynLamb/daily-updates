import { buildApp } from "./app.js";
import { pool } from "./db.js";

const app = buildApp();

async function start() {
  try {
    const result = await pool.query<{
      database: string;
    }>(
      "SELECT current_database() AS database"
    );

    app.log.info(
      { database: result.rows[0]?.database },
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
    await pool.end();
    process.exit(1);
  }
}

async function shutdown(signal: string) {
  app.log.info({ signal }, "Shutting down");

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