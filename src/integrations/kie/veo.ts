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

function extractVeoUrl(data: Record<string, unknown>): string | undefined {
    const tryArr = (v: unknown): string | undefined =>
        Array.isArray(v) && typeof v[0] === 'string' ? (v[0] as string) : undefined;

    // Variantes conocidas del API de Kie Veo
    const info = data.info as Record<string, unknown> | undefined;
    const response = data.response as Record<string, unknown> | undefined;
    const direct =
        tryArr(data.resultUrls) ??
        tryArr(info?.resultUrls) ??
        tryArr(info?.result_urls) ??
        tryArr(response?.resultUrls) ??
        tryArr(response?.result_urls);
    if (direct) return direct;

    const resultJson = (data.resultJson ?? response?.resultJson) as string | undefined;
    if (resultJson) {
        try {
            const parsed = JSON.parse(resultJson) as { resultUrls?: string[] };
            return tryArr(parsed.resultUrls);
        } catch { /* ignore */ }
    }
    return undefined;
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

    const maxMs = Math.min(600_000, Math.max(60_000, parseInt(process.env.KIE_VEO_POLL_MAX_MS ?? '300000', 10) || 300_000));
    const intervalMs = Math.min(20_000, Math.max(5000, parseInt(process.env.KIE_VEO_POLL_INTERVAL_MS ?? '12000', 10) || 12_000));
    const start = Date.now();

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
        const state = String(data.state ?? data.successFlag ?? '').toLowerCase();
        const url = extractVeoUrl(data);

        if (url) return url;
        if (state === 'success' || state === '1') {
            const u = extractVeoUrl(data);
            if (u) return u;
        }
        if (state === 'fail' || state === 'failed' || state === '2' || state === '3') {
            throw new Error(`KIE-VEO generación fallida: ${String(data.failMsg ?? data.failCode ?? state)}`);
        }
        // waiting / queuing / generating → seguir
    }

    throw new Error(`KIE-VEO: tiempo de espera agotado para taskId ${taskId}.`);
}
