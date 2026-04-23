import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../../agent_memory.db');

let db: Database.Database | undefined;

export async function initMemory(): Promise<void> {
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_li_pending_chat ON linkedin_pending_posts(chat_id, status);
  `);
}

export function getDb(): Database.Database {
    if (!db) throw new Error('Memory not initialized. Call initMemory() first.');
    return db;
}

/**
 * Save a message to the persistent conversation history for a chat
 */
export function saveMessage(chatId: string, role: 'user' | 'assistant' | 'system', content: string) {
    const stmt = getDb().prepare(
        'INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)'
    );
    stmt.run(chatId, role, content);
}

/**
 * Get the recent N messages for a chat (for context window)
 */
export function getHistory(chatId: string, limit = 20): Array<{ role: string; content: string }> {
    const rows = getDb()
        .prepare(
            'SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?'
        )
        .all(chatId, limit) as Array<{ role: string; content: string }>;
    return rows.reverse();
}

/** Mensajes recientes de todos los chats (para resúmenes / auto-mejora). Más recientes al final. */
export function getRecentMessagesAllChats(limit: number): Array<{ role: string; content: string; created_at: string }> {
    const rows = getDb()
        .prepare(
            `SELECT role, content, created_at FROM messages ORDER BY created_at DESC LIMIT ?`
        )
        .all(limit) as Array<{ role: string; content: string; created_at: string }>;
    return rows.reverse();
}

/**
 * Clear conversation history for a chat
 */
export function clearHistory(chatId: string) {
    getDb().prepare('DELETE FROM messages WHERE chat_id = ?').run(chatId);
}

/**
 * Store arbitrary key-value metadata
 */
export function setMeta(key: string, value: string) {
    getDb()
        .prepare('INSERT OR REPLACE INTO metadata (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
        .run(key, value);
}

export function getMeta(key: string): string | null {
    const row = getDb().prepare('SELECT value FROM metadata WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
}

const META_USER_NAME = 'user_display_name';
const META_USER_PROFILE = 'user_profile';
/** Límite aproximado de caracteres del perfil acumulado en SQLite (notas del usuario). */
const USER_PROFILE_MAX_CHARS = 3500;

function dbReady(): boolean {
    try {
        return Boolean(db);
    } catch {
        return false;
    }
}

/**
 * Texto para inyectar en el system prompt: nombre preferido + notas (env o metadata).
 * Si la base de datos no está inicializada, solo usa variables de entorno.
 */
export function getUserProfileBlock(): string {
    let name = process.env.USER_DISPLAY_NAME?.trim() ?? '';
    let notes = process.env.USER_PROFILE?.trim() ?? '';

    if (dbReady()) {
        try {
            const n = getMeta(META_USER_NAME);
            const p = getMeta(META_USER_PROFILE);
            if (n?.trim()) name = n.trim();
            if (p?.trim()) notes = p.trim();
        } catch {
            /* ignore */
        }
    }

    if (!name && !notes) return '';

    const parts: string[] = [];
    if (name) {
        parts.push(
            `Nombre o forma de dirigirte al usuario: **${name}**. Úsalo de forma natural (no en cada frase).`
        );
    }
    if (notes) {
        parts.push('Gustos, preferencias y datos que debes recordar:\n' + notes);
    }
    parts.push(
        'Mantén tono cercano y respetuoso. Cuando uses herramientas, confirma el resultado y resume brevemente lo hecho.'
    );

    return '\n\n---\n### Perfil persistente de esta persona\n' + parts.join('\n\n');
}

export function setUserDisplayName(name: string): void {
    setMeta(META_USER_NAME, name.trim());
}

/** Añade una línea al perfil en metadata; respeta USER_PROFILE del .env como base si aún no hay notas guardadas. */
export function appendUserProfileNote(note: string): void {
    const trimmed = note.trim();
    if (!trimmed) return;

    let cur = getMeta(META_USER_PROFILE);
    if (cur == null || cur === '') {
        cur = process.env.USER_PROFILE?.trim() ?? '';
    }

    const sep = cur.length > 0 && !cur.endsWith('\n') ? '\n' : '';
    let next = `${cur}${sep}${trimmed}\n`;
    if (next.length > USER_PROFILE_MAX_CHARS) {
        next = next.slice(next.length - USER_PROFILE_MAX_CHARS);
    }
    setMeta(META_USER_PROFILE, next);
}

export type ScheduledTaskRow = {
    id: number;
    chat_id: string;
    instruction: string;
    run_at_ms: number;
    status: string;
    created_at: string;
};

export function insertScheduledTask(chatId: string, instruction: string, runAtMs: number): number {
    const r = getDb()
        .prepare(
            `INSERT INTO scheduled_tasks (chat_id, instruction, run_at_ms, status) VALUES (?, ?, ?, 'pending')`
        )
        .run(chatId, instruction, runAtMs);
    return Number(r.lastInsertRowid);
}

export function listPendingScheduledForChat(chatId: string): ScheduledTaskRow[] {
    return getDb()
        .prepare(
            `SELECT id, chat_id, instruction, run_at_ms, status, created_at FROM scheduled_tasks
             WHERE chat_id = ? AND status = 'pending' ORDER BY run_at_ms ASC`
        )
        .all(chatId) as ScheduledTaskRow[];
}

/** Atomically toma la siguiente tarea vencida o null. */
export function claimNextDueScheduledTask(nowMs: number): ScheduledTaskRow | null {
    const database = getDb();
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

export function markScheduledTaskDone(id: number): void {
    getDb().prepare(`UPDATE scheduled_tasks SET status = 'done' WHERE id = ?`).run(id);
}

export function markScheduledTaskFailed(id: number): void {
    getDb().prepare(`UPDATE scheduled_tasks SET status = 'failed' WHERE id = ?`).run(id);
}

/** Devuelve a pending tareas "running" cuya hora de ejecución era hace más de maxAgeMs (tareas colgadas). */
export function releaseStuckRunningTasks(nowMs: number, maxAgeMs: number): number {
    const cutoff = nowMs - maxAgeMs;
    const r = getDb()
        .prepare(
            `UPDATE scheduled_tasks SET status = 'pending' WHERE status = 'running' AND run_at_ms < ?`
        )
        .run(cutoff);
    return r.changes;
}

export function cancelScheduledTaskForChat(chatId: string, taskId: number): boolean {
    const r = getDb()
        .prepare(
            `DELETE FROM scheduled_tasks WHERE id = ? AND chat_id = ? AND status = 'pending'`
        )
        .run(taskId, chatId);
    return r.changes === 1;
}

// ── LinkedIn: publicaciones pendientes de aprobación (Telegram) ─────────────

export type LinkedInPendingRow = {
    id: number;
    chat_id: string;
    body: string;
    visibility: string;
    status: string;
    linkedin_response: string | null;
    error: string | null;
    created_at: string;
};

export function insertLinkedInPendingPost(
    chatId: string,
    body: string,
    visibility: 'PUBLIC' | 'CONNECTIONS'
): number {
    const r = getDb()
        .prepare(
            `INSERT INTO linkedin_pending_posts (chat_id, body, visibility, status) VALUES (?, ?, ?, 'pending')`
        )
        .run(chatId, body, visibility);
    return Number(r.lastInsertRowid);
}

export function getLinkedInPendingPostForChat(id: number, chatId: string): LinkedInPendingRow | null {
    const row = getDb()
        .prepare(
            `SELECT id, chat_id, body, visibility, status, linkedin_response, error, created_at
             FROM linkedin_pending_posts WHERE id = ? AND chat_id = ?`
        )
        .get(id, chatId) as LinkedInPendingRow | undefined;
    return row ?? null;
}

export function listLinkedInPendingPostsForChat(chatId: string, limit = 15): LinkedInPendingRow[] {
    return getDb()
        .prepare(
            `SELECT id, chat_id, body, visibility, status, linkedin_response, error, created_at
             FROM linkedin_pending_posts
             WHERE chat_id = ? AND status = 'pending' ORDER BY id DESC LIMIT ?`
        )
        .all(chatId, limit) as LinkedInPendingRow[];
}

export function setLinkedInPendingPublished(id: number, response: string): void {
    getDb()
        .prepare(
            `UPDATE linkedin_pending_posts SET status = 'published', linkedin_response = ?, error = NULL,
             updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        )
        .run(response, id);
}

export function setLinkedInPendingFailed(id: number, error: string): void {
    getDb()
        .prepare(
            `UPDATE linkedin_pending_posts SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        )
        .run(error, id);
}

export function setLinkedInPendingRejected(id: number): void {
    getDb()
        .prepare(
            `UPDATE linkedin_pending_posts SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        )
        .run(id);
}
