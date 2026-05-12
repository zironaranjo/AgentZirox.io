import { logger } from './logger';
import { embeddingAvailable, generateEmbedding } from './embeddings';
import {
    initSqliteMemory,
    sqliteAddKnowledge,
    sqliteCancelScheduledTaskForChat,
    sqliteClaimNextDueScheduledTask,
    sqliteClearHistory,
    sqliteDbReady,
    sqliteDeleteKnowledge,
    sqliteGetHistory,
    sqliteGetLinkedInPendingPostForChat,
    sqliteGetMeta,
    sqliteGetRecentMessagesAllChats,
    sqliteInsertLinkedInPendingPost,
    sqliteInsertScheduledTask,
    sqliteListKnowledge,
    sqliteListLinkedInPendingPostsForChat,
    sqliteListPendingScheduledForChat,
    sqliteMarkScheduledTaskDone,
    sqliteMarkScheduledTaskFailed,
    sqliteReleaseStuckRunningTasks,
    sqliteSaveMessage,
    sqliteSearchKnowledge,
    sqliteSetLinkedInPendingFailed,
    sqliteSetLinkedInPendingPublished,
    sqliteSetLinkedInPendingRejected,
    sqliteSetMeta,
} from './memory-sqlite';
import {
    initSupabaseMemory,
    supabaseUpdateMessageEmbedding,
    supabaseSearchMessagesSemantic,
    supabaseAddKnowledge,
    supabaseCancelScheduledTaskForChat,
    supabaseClaimNextDueScheduledTask,
    supabaseClearHistory,
    supabaseDeleteKnowledge,
    supabaseGetHistory,
    supabaseGetLinkedInPendingPostForChat,
    supabaseGetMeta,
    supabaseGetRecentMessagesAllChats,
    supabaseInsertLinkedInPendingPost,
    supabaseInsertScheduledTask,
    supabaseListKnowledge,
    supabaseListLinkedInPendingPostsForChat,
    supabaseListPendingScheduledForChat,
    supabaseMarkScheduledTaskDone,
    supabaseMarkScheduledTaskFailed,
    supabaseReleaseStuckRunningTasks,
    supabaseSaveMessage,
    supabaseSearchKnowledge,
    supabaseSetLinkedInPendingFailed,
    supabaseSetLinkedInPendingPublished,
    supabaseSetLinkedInPendingRejected,
    supabaseSetMeta,
} from './memory-supabase';

import type { KnowledgeRow, LinkedInPendingRow, ScheduledTaskRow } from './memory-sqlite';

export type { KnowledgeRow, LinkedInPendingRow, ScheduledTaskRow } from './memory-sqlite';
export type MemoryType = 'episodic' | 'semantic' | 'procedural';

type Backend = 'sqlite' | 'supabase';

let backend: Backend | undefined;

function useSupabaseFromEnv(): boolean {
    return Boolean(
        process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    );
}

/**
 * Inicializa SQLite (por defecto) o Supabase si hay SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */
export async function initMemory(): Promise<void> {
    if (backend !== undefined) return;
    const hasUrl = Boolean(process.env.SUPABASE_URL?.trim());
    const hasKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
    logger.info(`[memory] SUPABASE_URL=${hasUrl ? 'SET' : 'MISSING'} SUPABASE_SERVICE_ROLE_KEY=${hasKey ? 'SET' : 'MISSING'}`);
    if (useSupabaseFromEnv()) {
        try {
            await initSupabaseMemory();
            backend = 'supabase';
            logger.info('[memory] backend: supabase (Postgres)');
        } catch (err) {
            logger.error('[memory] Supabase init falló, usando SQLite como fallback:', err instanceof Error ? err.message : String(err));
            await initSqliteMemory();
            backend = 'sqlite';
            logger.info('[memory] backend: sqlite (agent_memory.db) — FALLBACK');
        }
    } else {
        await initSqliteMemory();
        backend = 'sqlite';
        logger.info('[memory] backend: sqlite (agent_memory.db)');
    }
}

function b(): Backend {
    if (!backend) throw new Error('Memory not initialized. Call initMemory() first.');
    return backend;
}

export async function saveMessage(
    chatId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    memoryType: MemoryType = 'episodic'
): Promise<void> {
    if (b() === 'supabase') {
        const id = await supabaseSaveMessage(chatId, role, content, memoryType);
        // Fire-and-forget: generate and store embedding for meaningful messages
        if (embeddingAvailable() && content.length > 50 && role !== 'system') {
            generateEmbedding(content)
                .then((emb) => supabaseUpdateMessageEmbedding(id, emb))
                .catch(() => { /* embedding is optional — silent fail */ });
        }
        return;
    }
    sqliteSaveMessage(chatId, role, content);
}

export async function getHistory(chatId: string, limit = 20): Promise<Array<{ role: string; content: string }>> {
    if (b() === 'supabase') return supabaseGetHistory(chatId, limit);
    return sqliteGetHistory(chatId, limit);
}

export async function getRecentMessagesAllChats(
    limit: number
): Promise<Array<{ role: string; content: string; created_at: string }>> {
    if (b() === 'supabase') return supabaseGetRecentMessagesAllChats(limit);
    return sqliteGetRecentMessagesAllChats(limit);
}

export async function clearHistory(chatId: string) {
    if (b() === 'supabase') return supabaseClearHistory(chatId);
    sqliteClearHistory(chatId);
}

export async function setMeta(key: string, value: string) {
    if (key === META_USER_NAME || key === META_USER_PROFILE) {
        userProfileBlockCache = null;
    }
    if (b() === 'supabase') return supabaseSetMeta(key, value);
    sqliteSetMeta(key, value);
}

export async function getMeta(key: string): Promise<string | null> {
    if (b() === 'supabase') return supabaseGetMeta(key);
    return sqliteGetMeta(key);
}

const META_USER_NAME = 'user_display_name';
const META_USER_PROFILE = 'user_profile';
const USER_PROFILE_MAX_CHARS = 3500;
const USER_PROFILE_BLOCK_TTL_MS = 60_000;

let userProfileBlockCache: { expiresAtMs: number; value: string } | null = null;

function dbReady(): boolean {
    if (backend === 'supabase') return true;
    return sqliteDbReady();
}

/**
 * Texto para inyectar en el system prompt: nombre preferido + notas (env o metadata).
 */
export async function getUserProfileBlock(): Promise<string> {
    if (userProfileBlockCache && Date.now() < userProfileBlockCache.expiresAtMs) {
        return userProfileBlockCache.value;
    }

    let name = process.env.USER_DISPLAY_NAME?.trim() ?? '';
    let notes = process.env.USER_PROFILE?.trim() ?? '';

    if (dbReady()) {
        try {
            const n = await getMeta(META_USER_NAME);
            const p = await getMeta(META_USER_PROFILE);
            if (n?.trim()) name = n.trim();
            if (p?.trim()) notes = p.trim();
        } catch {
            /* ignore */
        }
    }

    if (!name && !notes) {
        userProfileBlockCache = {
            value: '',
            expiresAtMs: Date.now() + USER_PROFILE_BLOCK_TTL_MS,
        };
        return '';
    }

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

    const value = '\n\n---\n### Perfil persistente de esta persona\n' + parts.join('\n\n');
    userProfileBlockCache = {
        value,
        expiresAtMs: Date.now() + USER_PROFILE_BLOCK_TTL_MS,
    };
    return value;
}

export async function setUserDisplayName(name: string): Promise<void> {
    await setMeta(META_USER_NAME, name.trim());
}

export async function appendUserProfileNote(note: string): Promise<void> {
    const trimmed = note.trim();
    if (!trimmed) return;

    let cur = await getMeta(META_USER_PROFILE);
    if (cur == null || cur === '') {
        cur = process.env.USER_PROFILE?.trim() ?? '';
    }

    const sep = cur.length > 0 && !cur.endsWith('\n') ? '\n' : '';
    let next = `${cur}${sep}${trimmed}\n`;
    if (next.length > USER_PROFILE_MAX_CHARS) {
        next = next.slice(next.length - USER_PROFILE_MAX_CHARS);
    }
    await setMeta(META_USER_PROFILE, next);
}

export async function insertScheduledTask(chatId: string, instruction: string, runAtMs: number): Promise<number> {
    if (b() === 'supabase') return supabaseInsertScheduledTask(chatId, instruction, runAtMs);
    return sqliteInsertScheduledTask(chatId, instruction, runAtMs);
}

export async function listPendingScheduledForChat(chatId: string): Promise<ScheduledTaskRow[]> {
    if (b() === 'supabase') return supabaseListPendingScheduledForChat(chatId);
    return sqliteListPendingScheduledForChat(chatId);
}

export async function claimNextDueScheduledTask(nowMs: number): Promise<ScheduledTaskRow | null> {
    if (b() === 'supabase') return supabaseClaimNextDueScheduledTask(nowMs);
    return sqliteClaimNextDueScheduledTask(nowMs);
}

export async function markScheduledTaskDone(id: number): Promise<void> {
    if (b() === 'supabase') return supabaseMarkScheduledTaskDone(id);
    sqliteMarkScheduledTaskDone(id);
}

export async function markScheduledTaskFailed(id: number): Promise<void> {
    if (b() === 'supabase') return supabaseMarkScheduledTaskFailed(id);
    sqliteMarkScheduledTaskFailed(id);
}

export async function releaseStuckRunningTasks(nowMs: number, maxAgeMs: number): Promise<number> {
    if (b() === 'supabase') return supabaseReleaseStuckRunningTasks(nowMs, maxAgeMs);
    return sqliteReleaseStuckRunningTasks(nowMs, maxAgeMs);
}

export async function cancelScheduledTaskForChat(chatId: string, taskId: number): Promise<boolean> {
    if (b() === 'supabase') return supabaseCancelScheduledTaskForChat(chatId, taskId);
    return sqliteCancelScheduledTaskForChat(chatId, taskId);
}

export async function insertLinkedInPendingPost(
    chatId: string,
    body: string,
    visibility: 'PUBLIC' | 'CONNECTIONS',
    imageUrl?: string | null
): Promise<number> {
    if (b() === 'supabase') return supabaseInsertLinkedInPendingPost(chatId, body, visibility, imageUrl);
    return sqliteInsertLinkedInPendingPost(chatId, body, visibility, imageUrl);
}

export async function getLinkedInPendingPostForChat(
    id: number,
    chatId: string
): Promise<LinkedInPendingRow | null> {
    if (b() === 'supabase') return supabaseGetLinkedInPendingPostForChat(id, chatId);
    return sqliteGetLinkedInPendingPostForChat(id, chatId);
}

export async function listLinkedInPendingPostsForChat(chatId: string, limit = 15): Promise<LinkedInPendingRow[]> {
    if (b() === 'supabase') return supabaseListLinkedInPendingPostsForChat(chatId, limit);
    return sqliteListLinkedInPendingPostsForChat(chatId, limit);
}

export async function setLinkedInPendingPublished(id: number, response: string): Promise<void> {
    if (b() === 'supabase') return supabaseSetLinkedInPendingPublished(id, response);
    sqliteSetLinkedInPendingPublished(id, response);
}

export async function setLinkedInPendingFailed(id: number, error: string): Promise<void> {
    if (b() === 'supabase') return supabaseSetLinkedInPendingFailed(id, error);
    sqliteSetLinkedInPendingFailed(id, error);
}

export async function setLinkedInPendingRejected(id: number): Promise<void> {
    if (b() === 'supabase') return supabaseSetLinkedInPendingRejected(id);
    sqliteSetLinkedInPendingRejected(id);
}

// ── Knowledge base ────────────────────────────────────────────────────────────

export async function addKnowledge(
    title: string,
    content: string,
    tags: string[],
    embedding: number[] | null
): Promise<number> {
    if (b() === 'supabase') return supabaseAddKnowledge(title, content, tags, embedding);
    return sqliteAddKnowledge(title, content, tags);
}

export async function searchKnowledge(
    embedding: number[] | null,
    query: string,
    limit = 5
): Promise<KnowledgeRow[]> {
    if (b() === 'supabase') return supabaseSearchKnowledge(embedding, query, limit);
    return sqliteSearchKnowledge(query, limit);
}

export async function listKnowledge(): Promise<KnowledgeRow[]> {
    if (b() === 'supabase') return supabaseListKnowledge();
    return sqliteListKnowledge();
}

export async function deleteKnowledge(id: number): Promise<boolean> {
    if (b() === 'supabase') return supabaseDeleteKnowledge(id);
    return sqliteDeleteKnowledge(id);
}

// ── Semantic search in message history ────────────────────────────────────────

export async function searchMessagesSemantic(
    chatId: string,
    query: string,
    limit = 10
): Promise<Array<{ role: string; content: string; memory_type?: string; similarity?: number }>> {
    if (b() === 'supabase' && embeddingAvailable()) {
        const embedding = await generateEmbedding(query);
        return supabaseSearchMessagesSemantic(chatId, embedding, limit);
    }
    // Fallback: keyword filter on recent history
    const history = await getHistory(chatId, 100);
    const lq = query.toLowerCase();
    return history
        .filter((m) => m.content.toLowerCase().includes(lq))
        .slice(0, limit)
        .map((m) => ({ ...m, memory_type: 'episodic', similarity: 1 }));
}

// ── User context (project-graph) ──────────────────────────────────────────────

export interface UserContextProject {
    name: string;
    status: 'active' | 'paused' | 'done';
    description: string;
}

export interface UserContextDecision {
    date: string;
    decision: string;
    reason?: string;
}

export interface UserContext {
    projects: UserContextProject[];
    goals: string[];
    decisions: UserContextDecision[];
    current_focus: string;
}

const META_USER_CONTEXT = 'user_context';
const USER_CONTEXT_BLOCK_TTL_MS = 60_000;
let userContextBlockCache: { expiresAtMs: number; value: string } | null = null;

export async function getUserContext(): Promise<UserContext> {
    const raw = await getMeta(META_USER_CONTEXT);
    if (!raw) return { projects: [], goals: [], decisions: [], current_focus: '' };
    try { return JSON.parse(raw) as UserContext; } catch { return { projects: [], goals: [], decisions: [], current_focus: '' }; }
}

export async function saveUserContext(ctx: UserContext): Promise<void> {
    userContextBlockCache = null;
    await setMeta(META_USER_CONTEXT, JSON.stringify(ctx));
}

export async function getUserContextBlock(): Promise<string> {
    if (userContextBlockCache && Date.now() < userContextBlockCache.expiresAtMs) {
        return userContextBlockCache.value;
    }

    let ctx: UserContext;
    try { ctx = await getUserContext(); } catch { return ''; }

    const parts: string[] = [];
    const activeProjects = ctx.projects.filter((p) => p.status === 'active');
    if (activeProjects.length > 0) {
        parts.push('**Proyectos activos:** ' + activeProjects.map((p) => `${p.name} — ${p.description}`).join(' | '));
    }
    if (ctx.current_focus) parts.push(`**Foco actual:** ${ctx.current_focus}`);
    if (ctx.goals.length > 0) parts.push('**Objetivos:** ' + ctx.goals.join(', '));
    if (ctx.decisions.length > 0) {
        const recent = ctx.decisions.slice(-3);
        parts.push('**Decisiones recientes:** ' + recent.map((d) => `${d.decision}${d.reason ? ` (${d.reason})` : ''}`).join(' | '));
    }

    const value = parts.length > 0
        ? '\n\n---\n### Contexto del usuario\n' + parts.join('\n')
        : '';

    userContextBlockCache = { value, expiresAtMs: Date.now() + USER_CONTEXT_BLOCK_TTL_MS };
    return value;
}
