import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TTL_MS = 24 * 60 * 60 * 1000; // 24 h — ventana para guardar el último TTS

interface CachedAudio {
    path: string;
    mimeType: string;
    voice: string;
    textPreview: string;
    timestamp: number;
}

const cache = new Map<string, CachedAudio>();

export async function cacheAudioFile(
    chatId: string,
    sourcePath: string,
    mimeType: string,
    voice: string,
    textPreview: string
): Promise<void> {
    const ext = mimeType.includes('mp4') ? 'mp4' : 'mp3';
    const cachePath = join(tmpdir(), `audio-cache-${chatId}-${Date.now()}.${ext}`);
    await fs.copyFile(sourcePath, cachePath);

    const prev = cache.get(chatId);
    if (prev) {
        await fs.unlink(prev.path).catch(() => {});
    }

    cache.set(chatId, {
        path: cachePath,
        mimeType,
        voice,
        textPreview: textPreview.slice(0, 200),
        timestamp: Date.now(),
    });
}

export function getCachedAudio(chatId: string): CachedAudio | null {
    const entry = cache.get(chatId);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > TTL_MS) {
        void fs.unlink(entry.path).catch(() => {});
        cache.delete(chatId);
        return null;
    }
    return entry;
}

export async function clearCachedAudio(chatId: string): Promise<void> {
    const entry = cache.get(chatId);
    if (entry) {
        await fs.unlink(entry.path).catch(() => {});
        cache.delete(chatId);
    }
}
