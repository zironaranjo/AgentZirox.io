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
