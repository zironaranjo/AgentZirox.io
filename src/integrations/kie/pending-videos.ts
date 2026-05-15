import { getMeta, setMeta } from '../../core/memory';

const META_KEY = 'kie_pending_videos';

export interface KiePendingVideo {
    chatId: string;
    caption: string;
    privacy: string;
    createdAt: number;
}

async function load(): Promise<Record<string, KiePendingVideo>> {
    const raw = await getMeta(META_KEY);
    if (!raw) return {};
    try { return JSON.parse(raw) as Record<string, KiePendingVideo>; } catch { return {}; }
}

async function save(data: Record<string, KiePendingVideo>): Promise<void> {
    await setMeta(META_KEY, JSON.stringify(data));
}

export async function storePendingVideo(taskId: string, data: KiePendingVideo): Promise<void> {
    const store = await load();
    store[taskId] = data;
    // Limpiar entradas de más de 3 horas
    const cutoff = Date.now() - 10_800_000;
    for (const key of Object.keys(store)) {
        if (store[key].createdAt < cutoff) delete store[key];
    }
    await save(store);
}

export async function consumePendingVideo(taskId: string): Promise<KiePendingVideo | undefined> {
    const store = await load();
    const val = store[taskId];
    if (val) {
        delete store[taskId];
        await save(store);
    }
    return val;
}
