import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../../agent_memory.db');

let db: Database.Database | undefined;

export async function initSqliteMemory(): Promise<void> {
    if (db) return;
    db = new Database(DB_PATH);
    db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      instruction TEXT NOT NULL,
      run_at_ms INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'done', 'failed')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_sched_due ON scheduled_tasks(status, run_at_ms);

    CREATE TABLE IF NOT EXISTS linkedin_pending_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      body TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'PUBLIC' CHECK(visibility IN ('PUBLIC', 'CONNECTIONS')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'rejected', 'published', 'failed')),
      linkedin_response TEXT,
      error TEXT,
      image_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_li_pending_chat ON linkedin_pending_posts(chat_id, status);
  `);
    try {
        db.exec(`ALTER TABLE linkedin_pending_posts ADD COLUMN image_url TEXT`);
    } catch {
        /* columna ya existe */
    }
}

export function sqliteGetDb(): Database.Database {
    if (!db) throw new Error('SQLite memory not initialized. Call initSqliteMemory() first.');
    return db;
}

export function sqliteSaveMessage(chatId: string, role: 'user' | 'assistant' | 'system', content: string): void {
    sqliteGetDb()
        .prepare('INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)')
        .run(chatId, role, content);
}

export function sqliteGetHistory(chatId: string, limit = 20): Array<{ role: string; content: string }> {
    const rows = sqliteGetDb()
        .prepare(
            'SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?'
        )
        .all(chatId, limit) as Array<{ role: string; content: string }>;
    return rows.reverse();
}

export function sqliteGetRecentMessagesAllChats(
    limit: number
): Array<{ role: string; content: string; created_at: string }> {
    const rows = sqliteGetDb()
        .prepare(`SELECT role, content, created_at FROM messages ORDER BY created_at DESC LIMIT ?`)
        .all(limit) as Array<{ role: string; content: string; created_at: string }>;
    return rows.reverse();
}

export function sqliteClearHistory(chatId: string): void {
    sqliteGetDb().prepare('DELETE FROM messages WHERE chat_id = ?').run(chatId);
}

export function sqliteSetMeta(key: string, value: string): void {
    sqliteGetDb()
        .prepare('INSERT OR REPLACE INTO metadata (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
        .run(key, value);
}

export function sqliteGetMeta(key: string): string | null {
    const row = sqliteGetDb().prepare('SELECT value FROM metadata WHERE key = ?').get(key) as
        | { value: string }
        | undefined;
    return row?.value ?? null;
}

export type ScheduledTaskRow = {
    id: number;
    chat_id: string;
    instruction: string;
    run_at_ms: number;
    status: string;
    created_at: string;
};

export function sqliteInsertScheduledTask(chatId: string, instruction: string, runAtMs: number): number {
    const r = sqliteGetDb()
        .prepare(
            `INSERT INTO scheduled_tasks (chat_id, instruction, run_at_ms, status) VALUES (?, ?, ?, 'pending')`
        )
        .run(chatId, instruction, runAtMs);
    return Number(r.lastInsertRowid);
}

export function sqliteListPendingScheduledForChat(chatId: string): ScheduledTaskRow[] {
    return sqliteGetDb()
        .prepare(
            `SELECT id, chat_id, instruction, run_at_ms, status, created_at FROM scheduled_tasks
             WHERE chat_id = ? AND status = 'pending' ORDER BY run_at_ms ASC`
        )
        .all(chatId) as ScheduledTaskRow[];
}

export function sqliteClaimNextDueScheduledTask(nowMs: number): ScheduledTaskRow | null {
    const database = sqliteGetDb();
    const txn = database.transaction(() => {
        const row = database
            .prepare(
                `SELECT id, chat_id, instruction, run_at_ms, status, created_at FROM scheduled_tasks
                 WHERE status = 'pending' AND run_at_ms <= ? ORDER BY run_at_ms ASC LIMIT 1`
            )
            .get(nowMs) as ScheduledTaskRow | undefined;
        if (!row) return null;
        const upd = database
            .prepare(`UPDATE scheduled_tasks SET status = 'running' WHERE id = ? AND status = 'pending'`)
            .run(row.id);
        if (upd.changes !== 1) return null;
        return row;
    });
    return txn();
}

export function sqliteMarkScheduledTaskDone(id: number): void {
    sqliteGetDb().prepare(`UPDATE scheduled_tasks SET status = 'done' WHERE id = ?`).run(id);
}

export function sqliteMarkScheduledTaskFailed(id: number): void {
    sqliteGetDb().prepare(`UPDATE scheduled_tasks SET status = 'failed' WHERE id = ?`).run(id);
}

export function sqliteReleaseStuckRunningTasks(nowMs: number, maxAgeMs: number): number {
    const cutoff = nowMs - maxAgeMs;
    const r = sqliteGetDb()
        .prepare(
            `UPDATE scheduled_tasks SET status = 'pending' WHERE status = 'running' AND run_at_ms < ?`
        )
        .run(cutoff);
    return r.changes;
}

export function sqliteCancelScheduledTaskForChat(chatId: string, taskId: number): boolean {
    const r = sqliteGetDb()
        .prepare(`DELETE FROM scheduled_tasks WHERE id = ? AND chat_id = ? AND status = 'pending'`)
        .run(taskId, chatId);
    return r.changes === 1;
}

export type LinkedInPendingRow = {
    id: number;
    chat_id: string;
    body: string;
    visibility: string;
    status: string;
    linkedin_response: string | null;
    error: string | null;
    image_url: string | null;
    created_at: string;
};

export function sqliteInsertLinkedInPendingPost(
    chatId: string,
    body: string,
    visibility: 'PUBLIC' | 'CONNECTIONS',
    imageUrl?: string | null
): number {
    const r = sqliteGetDb()
        .prepare(
            `INSERT INTO linkedin_pending_posts (chat_id, body, visibility, image_url, status) VALUES (?, ?, ?, ?, 'pending')`
        )
        .run(chatId, body, visibility, imageUrl?.trim() || null);
    return Number(r.lastInsertRowid);
}

export function sqliteGetLinkedInPendingPostForChat(id: number, chatId: string): LinkedInPendingRow | null {
    const row = sqliteGetDb()
        .prepare(
            `SELECT id, chat_id, body, visibility, status, linkedin_response, error, image_url, created_at
             FROM linkedin_pending_posts WHERE id = ? AND chat_id = ?`
        )
        .get(id, chatId) as LinkedInPendingRow | undefined;
    return row ?? null;
}

export function sqliteListLinkedInPendingPostsForChat(chatId: string, limit = 15): LinkedInPendingRow[] {
    return sqliteGetDb()
        .prepare(
            `SELECT id, chat_id, body, visibility, status, linkedin_response, error, image_url, created_at
             FROM linkedin_pending_posts
             WHERE chat_id = ? AND status = 'pending' ORDER BY id DESC LIMIT ?`
        )
        .all(chatId, limit) as LinkedInPendingRow[];
}

export function sqliteSetLinkedInPendingPublished(id: number, response: string): void {
    sqliteGetDb()
        .prepare(
            `UPDATE linkedin_pending_posts SET status = 'published', linkedin_response = ?, error = NULL,
             updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        )
        .run(response, id);
}

export function sqliteSetLinkedInPendingFailed(id: number, error: string): void {
    sqliteGetDb()
        .prepare(
            `UPDATE linkedin_pending_posts SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        )
        .run(error, id);
}

export function sqliteSetLinkedInPendingRejected(id: number): void {
    sqliteGetDb()
        .prepare(
            `UPDATE linkedin_pending_posts SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        )
        .run(id);
}

export function sqliteDbReady(): boolean {
    try {
        return Boolean(db);
    } catch {
        return false;
    }
}
