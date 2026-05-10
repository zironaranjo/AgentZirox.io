const TTL_MS = 10 * 60 * 1000; // 10 minutos

interface CachedImage {
    base64: string;
    mimeType: string;
    caption: string;
    senderName: string;
    senderNumber: string;
    timestamp: number;
}

const cache = new Map<string, CachedImage>();

export function cacheImage(chatId: string, data: Omit<CachedImage, 'timestamp'>): void {
    cache.set(chatId, { ...data, timestamp: Date.now() });
}

export function getCachedImage(chatId: string): CachedImage | null {
    const entry = cache.get(chatId);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > TTL_MS) {
        cache.delete(chatId);
        return null;
    }
    return entry;
}

export function clearCachedImage(chatId: string): void {
    cache.delete(chatId);
}
