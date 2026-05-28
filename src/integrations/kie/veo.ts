import { logger } from '../../core/logger';

const KIE_BASE = (process.env.KIE_BASE_URL?.trim() || 'https://api.kie.ai').replace(/\/+$/, '');

function getKieKey(): string {
    const k = process.env.KIE_API_KEY?.trim();
    if (!k) throw new Error('Falta KIE_API_KEY (https://kie.ai/api-key).');
    return k;
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

function toRecord(v: unknown): Record<string, unknown> | undefined {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function parseMaybeObject(v: unknown): Record<string, unknown> | undefined {
    const rec = toRecord(v);
    if (rec) return rec;
    if (typeof v === 'string') {
        try {
            const parsed = JSON.parse(v) as unknown;
            return toRecord(parsed);
        } catch {
            return undefined;
        }
    }
    return undefined;
}

function pickFirstUrl(v: unknown): string | undefined {
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) return v;
    if (Array.isArray(v)) {
        for (const item of v) {
            if (typeof item === 'string' && /^https?:\/\//i.test(item)) return item;
            const rec = toRecord(item);
            const url = rec?.url ?? rec?.videoUrl ?? rec?.video_url;
            if (typeof url === 'string' && /^https?:\/\//i.test(url)) return url;
        }
    }
    return undefined;
}

function extractVeoUrl(data: Record<string, unknown>): string | undefined {
    // Variantes conocidas del API de Kie Veo
    const info = parseMaybeObject(data.info);
    const response = parseMaybeObject(data.response);
    const result = parseMaybeObject(data.result);
    const payload = parseMaybeObject(data.payload);

    const direct =
        pickFirstUrl(data.resultUrls) ??
        pickFirstUrl(data.result_urls) ??
        pickFirstUrl(data.videoUrl) ??
        pickFirstUrl(data.video_url) ??
        pickFirstUrl(data.url) ??
        pickFirstUrl(info?.resultUrls) ??
        pickFirstUrl(info?.result_urls) ??
        pickFirstUrl(info?.videoUrl) ??
        pickFirstUrl(info?.video_url) ??
        pickFirstUrl(response?.resultUrls) ??
        pickFirstUrl(response?.result_urls) ??
        pickFirstUrl(response?.videoUrl) ??
        pickFirstUrl(response?.video_url) ??
        pickFirstUrl(result?.resultUrls) ??
        pickFirstUrl(result?.result_urls) ??
        pickFirstUrl(payload?.resultUrls) ??
        pickFirstUrl(payload?.result_urls);
    if (direct) return direct;

    const resultJson = (data.resultJson ?? response?.resultJson ?? result?.resultJson) as string | undefined;
    if (resultJson) {
        try {
            const parsed = JSON.parse(resultJson) as Record<string, unknown>;
            return (
                pickFirstUrl(parsed.resultUrls) ??
                pickFirstUrl(parsed.result_urls) ??
                pickFirstUrl(parsed.videoUrl) ??
                pickFirstUrl(parsed.video_url) ??
                pickFirstUrl(parsed.url)
            );
        } catch { /* ignore */ }
    }

    return undefined;
}

function normalizeState(data: Record<string, unknown>): string {
    const raw = data.state ?? data.status ?? data.taskStatus ?? data.progressStatus;
    const text = String(raw ?? '').toLowerCase();
    if (!text) return '';
    if (['success', 'succeeded', 'completed', 'done', 'finish', 'finished', '1'].includes(text)) return 'success';
    if (['fail', 'failed', 'error', '2', '3'].includes(text)) return 'failed';
    if (['waiting', 'queued', 'queuing', 'generating', 'processing', 'in_progress', 'running', '0'].includes(text)) return 'running';
    return text;
}

function isSuccessFlag(v: unknown): boolean | null {
    if (v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true') return true;
    if (v === false || v === 2 || v === 3 || v === '2' || v === '3' || String(v).toLowerCase() === 'false') return false;
    return null;
}

async function tryGet1080pUrl(taskId: string, apiKey: string): Promise<string | undefined> {
    try {
        const res = await fetch(
            `${KIE_BASE}/api/v1/veo/get-1080p-video?taskId=${encodeURIComponent(taskId)}`,
            { headers: { Authorization: `Bearer ${apiKey}` } }
        );
        const raw = await res.text();
        if (!res.ok) return undefined;
        let json: { code?: number; data?: Record<string, unknown> };
        try { json = JSON.parse(raw) as typeof json; } catch { return undefined; }
        if (json.code !== 200 || !json.data) return undefined;
        return extractVeoUrl(json.data);
    } catch {
        return undefined;
    }
}

/**
 * Genera un clip de vídeo Veo (8s, 9:16, 1080p) de forma SÍNCRONA con polling.
 * Devuelve la URL del MP4. Pensado para el pipeline de create_short_video.
 */
export async function kieGenerateVeoClip(prompt: string): Promise<string> {
    const apiKey = getKieKey();
    const p = prompt.trim().slice(0, 5000);
    if (!p) throw new Error('kieGenerateVeoClip: prompt vacío');

    const genRes = await fetch(`${KIE_BASE}/api/v1/veo/generate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            prompt: p,
            model: (process.env.KIE_VEO_MODEL?.trim() || 'veo3_fast'),
            generationType: 'TEXT_2_VIDEO',
            aspect_ratio: '9:16',
            resolution: '1080p',
        }),
    });
    const genRaw = await genRes.text();
    logger.info(`[KIE-VEO] generate status=${genRes.status} body=${genRaw.slice(0, 300)}`);

    let genJson: { code?: number; msg?: string; data?: { taskId?: string } };
    try { genJson = JSON.parse(genRaw) as typeof genJson; }
    catch { throw new Error(`KIE-VEO generate no JSON: ${genRaw.slice(0, 200)}`); }

    if (!genRes.ok || genJson.code !== 200 || !genJson.data?.taskId) {
        throw new Error(`KIE-VEO generate falló (${genRes.status}): ${genJson.msg ?? genRaw.slice(0, 200)}`);
    }
    const taskId = genJson.data.taskId;

    const maxMs = Math.min(900_000, Math.max(60_000, parseInt(process.env.KIE_VEO_POLL_MAX_MS ?? '480000', 10) || 480_000));
    const intervalMs = Math.min(20_000, Math.max(5000, parseInt(process.env.KIE_VEO_POLL_INTERVAL_MS ?? '12000', 10) || 12_000));
    const start = Date.now();
    let lastState = 'running';
    let lastSummary = '';

    while (Date.now() - start < maxMs) {
        await sleep(intervalMs);
        const infoRes = await fetch(
            `${KIE_BASE}/api/v1/veo/record-info?taskId=${encodeURIComponent(taskId)}`,
            { headers: { Authorization: `Bearer ${apiKey}` } }
        );
        const infoRaw = await infoRes.text();
        logger.info(`[KIE-VEO] record-info status=${infoRes.status} body=${infoRaw.slice(0, 400)}`);

        let infoJson: { code?: number; msg?: string; data?: Record<string, unknown> };
        try { infoJson = JSON.parse(infoRaw) as typeof infoJson; }
        catch { throw new Error(`KIE-VEO record-info no JSON: ${infoRaw.slice(0, 200)}`); }

        if (!infoRes.ok || infoJson.code !== 200 || !infoJson.data) {
            throw new Error(`KIE-VEO record-info error: ${infoJson.msg ?? infoRes.status}`);
        }

        const data = infoJson.data;
        const state = normalizeState(data);
        const successFlag = isSuccessFlag(data.successFlag);
        const url = extractVeoUrl(data);
        const elapsed = Date.now() - start;
        lastState = state || (successFlag === true ? 'success' : successFlag === false ? 'failed' : 'running');
        lastSummary = `state=${lastState} successFlag=${String(data.successFlag ?? '')} elapsedMs=${elapsed}`;
        logger.info(`[KIE-VEO] poll taskId=${taskId} ${lastSummary} urlFound=${url ? 'yes' : 'no'}`);

        if (url) return url;
        if (lastState === 'success' || successFlag === true) {
            const fallback1080 = await tryGet1080pUrl(taskId, apiKey);
            if (fallback1080) return fallback1080;
            // Éxito sin URL: reintentar algunos ciclos por consistencia eventual
            continue;
        }
        if (lastState === 'failed' || successFlag === false) {
            throw new Error(`KIE-VEO generación fallida: ${String(data.failMsg ?? data.failCode ?? lastState)}`);
        }
        // waiting / queuing / generating → seguir
    }

    throw new Error(`KIE-VEO: tiempo de espera agotado para taskId ${taskId}. Último estado: ${lastSummary || lastState}.`);
}
