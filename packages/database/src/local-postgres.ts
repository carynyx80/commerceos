// Starts a local PostgreSQL for development and tests (no Docker needed). Not for production.
import EmbeddedPostgres from "embedded-postgres";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve(process.env.PGDATA_DIR ?? "../../.pgdata");
const port = Number(process.env.PGPORT ?? 54330);
mkdirSync(dir, { recursive: true });
const pg = new EmbeddedPostgres({ databaseDir: dir, user: "commerce", password: "commerce", port, persistent: true });

if (!existsSync(resolve(dir, "PG_VERSION"))) await pg.initialise();
await pg.start();
for (const db of ["commerce_os", "commerce_os_test"]) {
  try {
    await pg.createDatabase(db);
  } catch {
    // already exists
  }
  // Prisma stores DateTime as UTC "timestamp without time zone"; the session must be UTC too.
  const c = pg.getPgClient(db);
  await c.connect();
  await c.query(`ALTER DATABASE ${db} SET timezone TO 'UTC'`);
  await c.end();
}
console.log(`postgres ready: postgresql://commerce:commerce@127.0.0.1:${port}/commerce_os`);
const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
