/**
 * Unified SQLite store for sessions and A2A tasks.
 * Uses Node.js built-in `node:sqlite` (Node 22.5+).
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../.data");
const DB_PATH = resolve(DATA_DIR, "oracle.db");

// ─── A2A Task Types ──────────────────────────────────────

export type TaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "failed"
  | "canceled";

export interface TaskArtifact {
  name: string;
  parts: Array<{ type: string; text?: string }>;
  append?: boolean;
}

export interface Task {
  id: string;
  contextId: string;
  status: { state: TaskState; message?: string };
  artifacts: TaskArtifact[];
  createdAt: number;
  updatedAt: number;
}

// ─── Store ───────────────────────────────────────────────

export class Store {
  private db: DatabaseSync;

  // Prepared statements
  private stmts!: {
    sessionGet: ReturnType<DatabaseSync["prepare"]>;
    sessionSet: ReturnType<DatabaseSync["prepare"]>;
    taskInsert: ReturnType<DatabaseSync["prepare"]>;
    taskGet: ReturnType<DatabaseSync["prepare"]>;
    taskUpdateStatus: ReturnType<DatabaseSync["prepare"]>;
    taskSetArtifacts: ReturnType<DatabaseSync["prepare"]>;
    tasksByContext: ReturnType<DatabaseSync["prepare"]>;
    activeTaskByContext: ReturnType<DatabaseSync["prepare"]>;
  };

  constructor() {
    mkdirSync(DATA_DIR, { recursive: true });

    this.db = new DatabaseSync(DB_PATH);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");

    this.migrate();
    this.prepareStatements();
    this.prune();

    this.logStats();
  }

  // ─── Migrations ──────────────────────────────────────

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        context_id   TEXT PRIMARY KEY,
        response_id  TEXT NOT NULL,
        updated_at   INTEGER NOT NULL
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id           TEXT PRIMARY KEY,
        context_id   TEXT NOT NULL,
        state        TEXT NOT NULL DEFAULT 'submitted',
        message      TEXT,
        artifacts    TEXT NOT NULL DEFAULT '[]',
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_context ON tasks(context_id)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state)
    `);
  }

  // ─── Prepared Statements ─────────────────────────────

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

      taskInsert: this.db.prepare(`
        INSERT INTO tasks (id, context_id, state, message, artifacts, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `),
      taskGet: this.db.prepare("SELECT * FROM tasks WHERE id = ?"),
      taskUpdateStatus: this.db.prepare(`
        UPDATE tasks SET state = ?, message = ?, updated_at = ? WHERE id = ?
      `),
      taskSetArtifacts: this.db.prepare(`
        UPDATE tasks SET artifacts = ?, updated_at = ? WHERE id = ?
      `),
      tasksByContext: this.db.prepare(
        "SELECT * FROM tasks WHERE context_id = ? ORDER BY created_at DESC",
      ),
      activeTaskByContext: this.db.prepare(
        "SELECT * FROM tasks WHERE context_id = ? AND state = 'input-required' ORDER BY updated_at DESC LIMIT 1",
      ),
    };
  }

  // ─── Session Methods ─────────────────────────────────

  getSession(contextId: string): string | undefined {
    const row = this.stmts.sessionGet.get(contextId) as
      | { response_id: string }
      | undefined;
    return row?.response_id;
  }

  setSession(contextId: string, responseId: string): void {
    this.stmts.sessionSet.run(contextId, responseId, Date.now());
  }

  // ─── Task Methods ────────────────────────────────────

  createTask(id: string, contextId: string): Task {
    const now = Date.now();
    this.stmts.taskInsert.run(
      id,
      contextId,
      "submitted",
      null,
      "[]",
      now,
      now,
    );
    return {
      id,
      contextId,
      status: { state: "submitted" },
      artifacts: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  getTask(taskId: string): Task | undefined {
    const row = this.stmts.taskGet.get(taskId) as Record<string, any> | undefined;
    if (!row) return undefined;
    return this.rowToTask(row);
  }

  getTasksByContext(contextId: string): Task[] {
    const rows = this.stmts.tasksByContext.all(contextId) as Record<string, any>[];
    return rows.map((r) => this.rowToTask(r));
  }

  /**
   * Find a task in `input-required` state for this context.
   * Returns the most recently updated one, or undefined.
   */
  getActiveTask(contextId: string): Task | undefined {
    const row = this.stmts.activeTaskByContext.get(contextId) as
      | Record<string, any>
      | undefined;
    if (!row) return undefined;
    return this.rowToTask(row);
  }

  updateTaskStatus(
    taskId: string,
    state: TaskState,
    message?: string,
  ): void {
    this.stmts.taskUpdateStatus.run(state, message ?? null, Date.now(), taskId);
  }

  setTaskArtifacts(taskId: string, artifacts: TaskArtifact[]): void {
    this.stmts.taskSetArtifacts.run(
      JSON.stringify(artifacts),
      Date.now(),
      taskId,
    );
  }

  appendToTaskArtifact(taskId: string, text: string): void {
    const task = this.getTask(taskId);
    if (!task) return;

    if (task.artifacts.length === 0) {
      task.artifacts.push({
        name: "response",
        parts: [{ type: "text", text }],
      });
    } else {
      const last = task.artifacts[0];
      const textPart = last.parts.find((p) => p.type === "text");
      if (textPart) {
        textPart.text = (textPart.text ?? "") + text;
      } else {
        last.parts.push({ type: "text", text });
      }
    }

    this.stmts.taskSetArtifacts.run(
      JSON.stringify(task.artifacts),
      Date.now(),
      taskId,
    );
  }

  // ─── Helpers ─────────────────────────────────────────

  private rowToTask(row: Record<string, any>): Task {
    return {
      id: row.id as string,
      contextId: row.context_id as string,
      status: {
        state: row.state as TaskState,
        ...(row.message ? { message: row.message as string } : {}),
      },
      artifacts: JSON.parse(row.artifacts as string),
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  private prune(): void {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    this.db.exec(
      `DELETE FROM sessions WHERE updated_at < ${sevenDaysAgo}`,
    );
    this.db.exec(
      `DELETE FROM tasks WHERE updated_at < ${sevenDaysAgo}`,
    );
  }

  private logStats(): void {
    const sessions = (
      this.db.prepare("SELECT COUNT(*) as c FROM sessions").get() as {
        c: number;
      }
    ).c;
    const tasks = (
      this.db.prepare("SELECT COUNT(*) as c FROM tasks").get() as {
        c: number;
      }
    ).c;
    if (sessions > 0 || tasks > 0) {
      console.log(
        `[store] Restored ${sessions} session(s), ${tasks} task(s) from disk`,
      );
    }
  }

  close(): void {
    this.db.close();
  }
}
