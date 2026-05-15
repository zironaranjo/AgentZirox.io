import { registerTool } from '../core/dispatcher';
import { getToolContext } from '../core/tool-context';
import { sendTelegramChatMessage } from '../integrations/telegram/send-message';
import { logger } from '../core/logger';

const KIE_BASE = (process.env.KIE_BASE_URL?.trim() || 'https://api.kie.ai').replace(/\/+$/, '');

function getKieKey(): string {
    const k = process.env.KIE_API_KEY?.trim();
    if (!k) throw new Error('Falta KIE_API_KEY (https://kie.ai/api-key).');
    return k;
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

async function kieGenerateVideoUrl(prompt: string): Promise<string> {
    const apiKey = getKieKey();

    // 1. Crear tarea Veo 3.1
    const createRes = await fetch(`${KIE_BASE}/api/v1/veo/generate`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            prompt: prompt.slice(0, 5000),
            model: 'veo3_fast',
            generationType: 'TEXT_2_VIDEO',
            aspect_ratio: '9:16',
            resolution: '1080p',
            enableTranslation: true,
        }),
    });

    const createRaw = await createRes.text();
    logger.info(`[KIE-VEO] generate status=${createRes.status} body=${createRaw.slice(0, 400)}`);

    let createJson: { code?: number; msg?: string; data?: { taskId?: string } };
    try {
        createJson = JSON.parse(createRaw) as typeof createJson;
    } catch {
        throw new Error(`KIE-VEO generate no JSON: ${createRaw.slice(0, 250)}`);
    }

    if (!createRes.ok || createJson.code !== 200 || !createJson.data?.taskId) {
        throw new Error(`KIE-VEO generate fallo (${createRes.status}): ${createJson.msg ?? createRaw.slice(0, 250)}`);
    }

    const taskId = createJson.data.taskId;

    // 2. Avisar que está en proceso
    const tctxEarly = getToolContext();
    if (tctxEarly?.chatId) {
        sendTelegramChatMessage(
            tctxEarly.chatId,
            '🎬 Generando video con Kie.ai Veo 3.1... puede tardar 2-5 minutos, te aviso cuando esté listo.'
        ).catch(() => {});
    }

    // 3. Polling: intentar /veo/task primero, fallback a /jobs/recordInfo
    // Máx 2 min (el agente no debe quedar bloqueado si Kie falla)
    const maxMs = 120_000;
    const intervalMs = 20_000;
    const start = Date.now();

    const POLL_URLS = [
        `${KIE_BASE}/api/v1/veo/task?taskId=${encodeURIComponent(taskId)}`,
        `${KIE_BASE}/api/v1/veo/record?taskId=${encodeURIComponent(taskId)}`,
        `${KIE_BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
    ];

    while (Date.now() - start < maxMs) {
        await sleep(intervalMs);

        for (const pollUrl of POLL_URLS) {
            const infoRes = await fetch(pollUrl, {
                headers: { Authorization: `Bearer ${apiKey}` },
            });
            const infoRaw = await infoRes.text();
            logger.info(`[KIE-VEO] poll ${pollUrl.split('/api')[1]} status=${infoRes.status} body=${infoRaw.slice(0, 400)}`);

            if (infoRes.status === 404) continue;

            let infoJson: {
                code?: number; msg?: string;
                data?: {
                    state?: string; failCode?: string; failMsg?: string;
                    resultJson?: string;
                    info?: { resultUrls?: string[] | string };
                };
            };
            try { infoJson = JSON.parse(infoRaw) as typeof infoJson; }
            catch { continue; }

            if (infoJson.code === 422 || !infoJson.data) continue;
            if (infoJson.code !== 200) continue;

            const { state, resultJson, failMsg, failCode, info } = infoJson.data;

            if (state === 'success' || state === 'Success') {
                let videoUrl: string | undefined;
                if (info?.resultUrls) {
                    const urls = Array.isArray(info.resultUrls)
                        ? info.resultUrls
                        : (JSON.parse(info.resultUrls as string) as string[]);
                    videoUrl = urls[0];
                } else if (resultJson) {
                    try {
                        const parsed = JSON.parse(resultJson);
                        videoUrl = Array.isArray(parsed)
                            ? (parsed[0] as string)
                            : (parsed as { resultUrls?: string[] }).resultUrls?.[0];
                    } catch { /* ignorar */ }
                }
                if (!videoUrl) throw new Error('KIE-VEO completó sin URL de video.');
                return videoUrl;
            }

            if (/falla|fail/i.test(state ?? '')) {
                throw new Error(`KIE-VEO generación fallida: ${failMsg || failCode || state}`);
            }

            // Estado en curso → salir del for, esperar el próximo ciclo
            break;
        }
    }

    return `KIE_PENDING:${taskId}`;
}

registerTool({
    name: 'generate_video',
    description:
        'Genera un video corto (8s, vertical 9:16, 1080p) desde una descripción de texto usando Kie.ai Veo 3.1. ' +
        'Ideal para crear contenido para TikTok. Requiere KIE_API_KEY. ' +
        'Devuelve la URL MP4 del video generado para usar en tiktok_propose_video.',
    parameters: {
        type: 'object',
        properties: {
            prompt: {
                type: 'string',
                description:
                    'Descripción detallada del video a generar: escena, estilo visual, movimiento de cámara, colores, ambiente. En español o inglés.',
            },
        },
        required: ['prompt'],
    },
    timeoutMs: 180_000,
    handler: async (args) => {
        const { prompt } = args as { prompt: string };

        const p = prompt.trim();
        if (!p) throw new Error('prompt vacío');

        const result = await kieGenerateVideoUrl(p);

        if (result.startsWith('KIE_PENDING:')) {
            const taskId = result.slice('KIE_PENDING:'.length);
            return [
                '⏳ El video está tardando más de 2 minutos en generarse en Kie.ai.',
                `TaskId: ${taskId}`,
                '',
                'Puedes revisar el resultado en https://kie.ai → Logs → Veo y luego pedirme que proponga ese video a TikTok con la URL que aparezca ahí.',
            ].join('\n');
        }

        return [
            '🎬 Video generado con Kie.ai Veo 3.1.',
            `🔗 ${result}`,
            '',
            'Puedes usar esta URL en tiktok_propose_video para proponer el video a TikTok.',
        ].join('\n');
    },
});
