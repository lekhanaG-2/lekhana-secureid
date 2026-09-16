import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import pg from "pg";

const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

// Both stores expose the same parameterized SQL API. Production never falls back
// to in-memory or ephemeral filesystem storage.
export async function createStore({
  databaseUrl,
  filename = "data/secureid.sqlite",
} = {}) {
  if (databaseUrl) {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
    await pool.query(schema);
    return {
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          // Serialize the small assignment's auth mutations across serverless instances.
          // This guarantees atomic attempt counters, OTP consumption and session creation.
          await client.query("SELECT pg_advisory_xact_lock(702619311)");
          const db = {
            all: async (sql, args = []) => (await client.query(sql, args)).rows,
          };
          db.get = async (sql, args) => (await db.all(sql, args))[0];
          db.run = async (sql, args = []) => client.query(sql, args);
          const result = await fn(db);
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  }
  const { DatabaseSync } = await import("node:sqlite");
  if (filename !== ":memory:")
    mkdirSync(dirname(resolve(filename)), { recursive: true });
  const sqlite = new DatabaseSync(filename);
  sqlite.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
  );
  sqlite.exec(schema);
  const prepare = (sql, args = []) => {
    const ordered = [];
    const query = sql.replace(/\$(\d+)/g, (_, n) => {
      ordered.push(args[Number(n) - 1]);
      return "?";
    });
    return [sqlite.prepare(query), ordered];
  };
  const db = {
    async all(sql, args) {
      const [stmt, values] = prepare(sql, args);
      return stmt.all(...values);
    },
    async get(sql, args) {
      const [stmt, values] = prepare(sql, args);
      return stmt.get(...values);
    },
    async run(sql, args) {
      const [stmt, values] = prepare(sql, args);
      return stmt.run(...values);
    },
  };
  let queue = Promise.resolve();
  return {
    transaction(fn) {
      const result = queue.then(async () => {
        sqlite.exec("BEGIN IMMEDIATE");
        try {
          const value = await fn(db);
          sqlite.exec("COMMIT");
          return value;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      });
      queue = result.catch(() => {});
      return result;
    },
    async close() {
      await queue;
      sqlite.close();
    },
  };
}
