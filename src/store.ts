/**
 * SQLite store for session tracking (previousResponseId for multi-turn conversations).
 * Uses Node.js built-in `node:sqlite` (Node 22.5+).
 *
 * Task management is now handled by @a2a-js/sdk InMemoryTaskStore.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../.data");
const DB_PATH = resolve(DATA_DIR, "oracle.db");

export class Store {
  private db: DatabaseSync;

  private stmts!: {
    sessionGet: ReturnType<DatabaseSync["prepare"]>;
    sessionSet: ReturnType<DatabaseSync["prepare"]>;
  };

  constructor() {
    mkdirSync(DATA_DIR, { recursive: true });

    this.db = new DatabaseSync(DB_PATH);
    this.db.exec("PRAGMA journal_mode = WAL");

    this.migrate();
    this.prepareStatements();
    this.prune();

    this.logStats();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        context_id   TEXT PRIMARY KEY,
        response_id  TEXT NOT NULL,
        updated_at   INTEGER NOT NULL
      )
    `);
  }

  private prepareStatements(): void {
    this.stmts = {
      sessionGet: this.db.prepare(
        "SELECT response_id FROM sessions WHERE context_id = ?",
      ),
      sessionSet: this.db.prepare(`
        INSERT INTO sessions (context_id, response_id, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(context_id) DO UPDATE SET
          response_id = excluded.response_id,
          updated_at  = excluded.updated_at
      `),
    };
  }

  getSession(contextId: string): string | undefined {
    const row = this.stmts.sessionGet.get(contextId) as
      | { response_id: string }
      | undefined;
    return row?.response_id;
  }

  setSession(contextId: string, responseId: string): void {
    this.stmts.sessionSet.run(contextId, responseId, Date.now());
  }

  private prune(): void {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    this.db.exec(
      `DELETE FROM sessions WHERE updated_at < ${sevenDaysAgo}`,
    );
  }

  private logStats(): void {
    const sessions = (
      this.db.prepare("SELECT COUNT(*) as c FROM sessions").get() as {
        c: number;
      }
    ).c;
    if (sessions > 0) {
      console.log(
        `[store] Restored ${sessions} session(s) from disk`,
      );
    }
  }

  close(): void {
    this.db.close();
  }
}
