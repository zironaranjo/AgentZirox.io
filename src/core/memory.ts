import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../../agent_memory.db');

let db: Database.Database;

export async function initMemory(): Promise<void> {
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
