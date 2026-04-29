import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { registerTool } from '../core/dispatcher';
import { getToolContext } from '../core/tool-context';
import { resolveSafeWorkspacePath } from './workspace-utils';
import { sendTelegramChatMessage } from '../integrations/telegram/send-message';
import { logger } from '../core/logger';

const KIE_BASE = (process.env.KIE_BASE_URL?.trim() || 'https://api.kie.ai').replace(/\/+$/, '');

/** URL temporal para que Telegram envíe la foto tras processMessage (mismo chat). */
const pendingTelegramImageUrl = new Map<string, string>();

export function consumePendingTelegramImageUrl(chatId: string): string | undefined {
    const u = pendingTelegramImageUrl.get(chatId);
    if (u) pendingTelegramImageUrl.delete(chatId);
    return u;
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

type ImageProvider = 'openai' | 'kie';

function resolveImageProvider(): ImageProvider {
    const forced = process.env.IMAGE_GENERATION_PROVIDER?.trim().toLowerCase();
    if (forced === 'kie') return 'kie';
    if (forced === 'openai') return 'openai';

    if (process.env.KIE_API_KEY?.trim()) return 'kie';
    if (
        process.env.OPENAI_API_KEY?.trim() ||
        process.env.IMAGE_GENERATION_API_KEY?.trim()
    ) {
        return 'openai';
    }
    throw new Error(
        'generate_image: configura KIE_API_KEY (Kie.ai) o OPENAI_API_KEY / IMAGE_GENERATION_API_KEY. Ver README.'
    );
}

function getOpenAiKey(): string {
    const k =
        process.env.OPENAI_API_KEY?.trim() ||
        process.env.IMAGE_GENERATION_API_KEY?.trim();
    if (!k) throw new Error('Falta OPENAI_API_KEY o IMAGE_GENERATION_API_KEY.');
    return k;
}

function getKieKey(): string {
    const k = process.env.KIE_API_KEY?.trim();
    if (!k) throw new Error('Falta KIE_API_KEY (https://kie.ai/api-key).');
    return k;
}

/** Mapea tamaños DALL-E a aspect ratio de Kie 4o Image API. */
function openAiSizeToKieRatio(size: string): '1:1' | '3:2' | '2:3' {
    if (size === '1792x1024') return '3:2';
    if (size === '1024x1792') return '2:3';
    return '1:1';
}

async function openAiCreateImage(
    prompt: string,
    size: string
): Promise<{ url: string; revised_prompt?: string }> {
    const apiKey = getOpenAiKey();
    const model = (process.env.OPENAI_IMAGE_MODEL ?? 'dall-e-3').trim();

    const body: Record<string, unknown> = {
        model,
        prompt: prompt.slice(0, 4000),
        n: 1,
        size,
    };
    if (model === 'dall-e-3') {
        body.quality = (process.env.OPENAI_IMAGE_QUALITY ?? 'standard').trim();
    }

    const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    const raw = await res.text();
    if (!res.ok) {
        throw new Error(`OpenAI images ${res.status}: ${raw.slice(0, 800)}`);
    }

    let data: { data?: Array<{ url?: string; revised_prompt?: string }> };
    try {
        data = JSON.parse(raw) as { data?: Array<{ url?: string; revised_prompt?: string }> };
    } catch {
        throw new Error(`Respuesta images no JSON: ${raw.slice(0, 200)}`);
    }

    const url = data.data?.[0]?.url;
    if (!url) {
        throw new Error('OpenAI no devolvio URL de imagen (revisa modelo y permisos).');
    }
    return { url, revised_prompt: data.data?.[0]?.revised_prompt };
}

type KieTaskData = {
    taskId?: string;
    state?: string;
    resultJson?: string;
    failCode?: string;
    failMsg?: string;
};

async function kieGenerateImageUrl(prompt: string, kieSize: '1:1' | '3:2' | '2:3'): Promise<string> {
    const apiKey = getKieKey();
    // KIE_IMAGE_MODEL: modelo a usar (default: flux-2/pro-text-to-image)
    const kieModel = (process.env.KIE_IMAGE_MODEL?.trim() || 'flux-2/pro-text-to-image');

    // 1. Crear tarea
    const createRes = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: kieModel,
            input: {
                prompt: prompt.slice(0, 5000),
                aspect_ratio: kieSize,
                resolution: '1K',
                nsfw_checker: false,
            },
        }),
    });

    const createRaw = await createRes.text();
    logger.info(`[KIE] createTask status=${createRes.status} body=${createRaw.slice(0, 400)}`);

    let createJson: { code?: number; msg?: string; data?: { taskId?: string } };
    try {
        createJson = JSON.parse(createRaw) as typeof createJson;
    } catch {
        throw new Error(`KIE createTask no JSON: ${createRaw.slice(0, 250)}`);
    }

    if (!createRes.ok || createJson.code !== 200 || !createJson.data?.taskId) {
        throw new Error(`KIE createTask fallo (${createRes.status}): ${createJson.msg ?? createRaw.slice(0, 250)}`);
    }

    const taskId = createJson.data.taskId;

    // 2. Avisar al usuario que está en curso
    const tctxEarly = getToolContext();
    if (tctxEarly?.chatId) {
        sendTelegramChatMessage(
            tctxEarly.chatId,
            '🎨 Generando imagen con Kie.ai... puede tardar 1-2 minutos, ahora te la mando.'
        ).catch(() => {});
    }

    // 3. Polling hasta completar
    const maxMs = Math.min(600_000, Math.max(30_000, parseInt(process.env.KIE_IMAGE_POLL_MAX_MS ?? '180000', 10) || 180_000));
    const intervalMs = Math.min(15_000, Math.max(3000, parseInt(process.env.KIE_IMAGE_POLL_INTERVAL_MS ?? '5000', 10) || 5000));
    const start = Date.now();

    while (Date.now() - start < maxMs) {
        await sleep(intervalMs);

        const infoRes = await fetch(`${KIE_BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
        });
        const infoRaw = await infoRes.text();
        logger.info(`[KIE] recordInfo status=${infoRes.status} body=${infoRaw.slice(0, 600)}`);

        let infoJson: { code?: number; msg?: string; data?: KieTaskData };
        try {
            infoJson = JSON.parse(infoRaw) as typeof infoJson;
        } catch {
            throw new Error(`KIE recordInfo no JSON: ${infoRaw.slice(0, 400)}`);
        }

        if (!infoRes.ok || infoJson.code !== 200 || !infoJson.data) {
            throw new Error(`KIE recordInfo error: ${infoJson.msg ?? infoRes.status}`);
        }

        const { state, resultJson, failMsg, failCode } = infoJson.data;

        if (state === 'success') {
            let urls: string[] = [];
            try {
                urls = (JSON.parse(resultJson ?? '{}') as { resultUrls?: string[] }).resultUrls ?? [];
            } catch { /* ignorar parse error */ }
            const first = urls[0];
            if (!first) throw new Error('KIE completó pero sin resultUrls en resultJson.');
            return first;
        }

        if (state === 'Fallar' || state === 'fail' || state === 'failed') {
            logger.error(`[KIE] task failed: ${infoRaw.slice(0, 600)}`);
            throw new Error(`KIE generación fallida: ${failMsg || failCode || state}`);
        }

        // Estados en curso: Esperar, Cola, generatingGeneration → seguir polling
    }

    throw new Error(`KIE: tiempo de espera agotado (${maxMs}ms) para taskId ${taskId}.`);
}

function isKieTimeoutError(err: unknown): err is Error {
    return err instanceof Error && /Kie: tiempo de espera agotado/i.test(err.message);
}

registerTool({
    name: 'generate_image',
    description:
        'Generar una imagen desde una descripcion (ilustracion, banner, meme, etc.). Usa Kie.ai si hay KIE_API_KEY, si no OpenAI DALL-E. Cuando el usuario pida crear/dibujar/generar una imagen, llama esta tool.',
    parameters: {
        type: 'object',
        properties: {
            prompt: {
                type: 'string',
                description: 'Que debe mostrar la imagen (estilo, colores, composicion). Espanol u ingles.',
            },
            size: {
                type: 'string',
                enum: ['1024x1024', '1792x1024', '1024x1792'],
                description:
                    'Tamano: cuadrado, apaisado o vertical (OpenAI); en Kie se mapea a 1:1 / 3:2 / 2:3.',
            },
            save_relative_path: {
                type: 'string',
                description:
                    'Opcional: guardar imagen en el workspace, ej. imagenes/banner.png',
            },
        },
        required: ['prompt'],
    },
    handler: async (args) => {
        const { prompt, size: sizeRaw, save_relative_path } = args as {
            prompt: string;
            size?: string;
            save_relative_path?: string;
        };

        const p = prompt.trim();
        if (!p) throw new Error('prompt vacio');

        const allowed = ['1024x1024', '1792x1024', '1024x1792'] as const;
        const size =
            sizeRaw && (allowed as readonly string[]).includes(sizeRaw) ? sizeRaw : '1024x1024';

        const provider = resolveImageProvider();
        let url: string;
        let revised_prompt: string | undefined;

        if (provider === 'kie') {
            try {
                url = await kieGenerateImageUrl(p, openAiSizeToKieRatio(size));
            } catch (err) {
                if (isKieTimeoutError(err)) {
                    return [
                        '⚠️ La generacion de imagen esta tardando demasiado y se detuvo para no bloquear el chat.',
                        'Puedes seguir con el post de texto ahora y luego volver a pedir la imagen en un mensaje aparte.',
                        '',
                        `Detalle: ${err.message}`,
                    ].join('\n');
                }
                throw err;
            }
        } else {
            const r = await openAiCreateImage(p, size);
            url = r.url;
            revised_prompt = r.revised_prompt;
        }

        const tctx = getToolContext();
        if (tctx?.chatId) {
            pendingTelegramImageUrl.set(tctx.chatId, url);
        }

        let savedLine = '';
        if (save_relative_path?.trim()) {
            const imgRes = await fetch(url);
            if (!imgRes.ok) throw new Error('No se pudo descargar la imagen generada');
            const buf = Buffer.from(await imgRes.arrayBuffer());
            const target = resolveSafeWorkspacePath(save_relative_path.trim());
            await mkdir(path.dirname(target), { recursive: true });
            await writeFile(target, buf);
            savedLine = `\n📁 Guardado: ${save_relative_path.trim()}`;
        }

        const via = provider === 'kie' ? 'Kie.ai' : 'OpenAI';
        const parts = [
            `🖼️ Imagen generada (${via}).`,
            `🔗 ${url}`,
            revised_prompt ? `\n📝 Prompt revisado: ${revised_prompt}` : '',
            savedLine,
        ];
        return parts.filter(Boolean).join('');
    },
});
