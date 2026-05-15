import { getMeta, setMeta } from '../../core/memory';

export const TIKTOK_PENDING_META_KEY = 'tiktok_pending_posts';

export type TikTokPrivacy = 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY';

export interface TikTokPendingRow {
    id: number;
    chat_id: string;
    video_url: string;
    caption: string;
    privacy: TikTokPrivacy;
    status: 'pending' | 'published' | 'failed' | 'rejected';
    created_at: number;
    publish_id?: string;
    error?: string;
}

export async function loadPending(): Promise<TikTokPendingRow[]> {
    const raw = await getMeta(TIKTOK_PENDING_META_KEY);
    if (!raw) return [];
    try { return JSON.parse(raw) as TikTokPendingRow[]; } catch { return []; }
}

export async function savePending(rows: TikTokPendingRow[]): Promise<void> {
    await setMeta(TIKTOK_PENDING_META_KEY, JSON.stringify(rows.slice(-100)));
}

export async function insertPending(chatId: string, videoUrl: string, caption: string, privacy: TikTokPrivacy): Promise<number> {
    const rows = await loadPending();
    const id = rows.length > 0 ? Math.max(...rows.map(r => r.id)) + 1 : 1;
    rows.push({ id, chat_id: chatId, video_url: videoUrl, caption, privacy, status: 'pending', created_at: Date.now() });
    await savePending(rows);
    return id;
}

export async function updatePending(id: number, update: Partial<TikTokPendingRow>): Promise<void> {
    const rows = await loadPending();
    const idx = rows.findIndex(r => r.id === id);
    if (idx !== -1) { rows[idx] = { ...rows[idx], ...update }; await savePending(rows); }
}

export async function getPendingById(id: number, chatId: string): Promise<TikTokPendingRow | undefined> {
    const rows = await loadPending();
    return rows.find(r => r.id === id && r.chat_id === chatId);
}

export async function listPendingForChat(chatId: string, limit = 10): Promise<TikTokPendingRow[]> {
    const rows = await loadPending();
    return rows.filter(r => r.chat_id === chatId && r.status === 'pending').slice(-limit);
}
