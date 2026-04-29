import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { registerTool } from '../core/dispatcher';
import { getToolContext } from '../core/tool-context';
import { resolveSafeWorkspacePath } from './workspace-utils';
import { sendTelegramChatMessage } from '../integrations/telegram/send-message';

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

type KieRecordData = {
    successFlag: number;
    errorMessage?: string | null;
    response?: { result_urls?: string[] } | null;
    progress?: string | null;
};

async function kieGenerateImageUrl(prompt: string, kieSize: '1:1' | '3:2' | '2:3'): Promise<string> {
    const apiKey = getKieKey();
    const generatePaths = ['/api/v1/gpt-4o-image/generate', '/api/v1/gpt4o-image/generate'];
    const recordInfoPaths = ['/api/v1/gpt-4o-image/record-info', '/api/v1/gpt4o-image/record-info'];

    let taskId = '';
    let chosenRecordInfoPath = recordInfoPaths[0];
    let lastGenerateErr = '';
    for (let i = 0; i < generatePaths.length; i++) {
        const p = generatePaths[i];
        const genRes = await fetch(`${KIE_BASE}${p}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                prompt: prompt.slice(0, 4000),
                size: kieSize,
                nVariants: 1,
            }),
        });

        const genRaw = await genRes.text();
        let genJson: { code?: number; msg?: string; data?: { taskId?: string } };
        try {
            genJson = JSON.parse(genRaw) as typeof genJson;
        } catch {
            lastGenerateErr = `Kie generate no JSON en ${p}: ${genRaw.slice(0, 250)}`;
            continue;
        }
        if (genRes.ok && genJson.code === 200 && genJson.data?.taskId) {
            taskId = genJson.data.taskId;
            chosenRecordInfoPath = recordInfoPaths[i] ?? recordInfoPaths[0];
            break;
        }
        lastGenerateErr = `Kie generate fallo en ${p}: ${genJson.msg ?? genRes.status} ${genRaw.slice(0, 250)}`;
    }
    if (!taskId) {
        throw new Error(lastGenerateErr || 'Kie generate fallo en todas las rutas conocidas.');
    }

    // Avisar al usuario que la generación está en curso (KIE puede tardar 1-2 min)
    const tctxEarly = getToolContext();
    if (tctxEarly?.chatId) {
        sendTelegramChatMessage(
            tctxEarly.chatId,
            '🎨 Generando imagen con Kie.ai... puede tardar 1-2 minutos, ahora te la mando.'
        ).catch(() => {/* ignorar si falla el aviso */});
    }

    const maxMs = Math.min(
        600_000,
        Math.max(30_000, parseInt(process.env.KIE_IMAGE_POLL_MAX_MS ?? '180000', 10) || 180_000)
    );
    const intervalMs = Math.min(
        15_000,
        Math.max(2000, parseInt(process.env.KIE_IMAGE_POLL_INTERVAL_MS ?? '3000', 10) || 3000)
    );
    const start = Date.now();

    while (Date.now() - start < maxMs) {
        const infoUrl = `${KIE_BASE}${chosenRecordInfoPath}?taskId=${encodeURIComponent(taskId)}`;
        const infoRes = await fetch(infoUrl, {
            headers: { Authorization: `Bearer ${apiKey}` },
        });
        const infoRaw = await infoRes.text();
        let infoJson: { code?: number; msg?: string; data?: KieRecordData };
        try {
            infoJson = JSON.parse(infoRaw) as typeof infoJson;
        } catch {
            throw new Error(`Kie record-info no JSON: ${infoRaw.slice(0, 400)}`);
        }
        if (!infoRes.ok || infoJson.code !== 200 || !infoJson.data) {
            throw new Error(`Kie record-info: ${infoJson.msg ?? infoRes.status}`);
        }

        const d = infoJson.data;
        if (d.successFlag === 1) {
            const urls = d.response?.result_urls;
            const first = urls?.[0];
            if (!first) throw new Error('Kie termino pero sin result_urls.');
            return first;
        }
        if (d.successFlag === 2) {
            throw new Error(
                `Kie generacion fallida: ${d.errorMessage ?? 'sin detalle'}`
            );
        }
        await sleep(intervalMs);
    }

    throw new Error(
        `Kie: tiempo de espera agotado (${maxMs} ms) para taskId ${taskId}.`
    );
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
