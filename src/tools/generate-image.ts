import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { registerTool } from '../core/dispatcher';
import { getToolContext } from '../core/tool-context';
import { resolveSafeWorkspacePath } from './workspace-utils';

/** URL temporal para que Telegram envíe la foto tras processMessage (mismo chat). */
const pendingTelegramImageUrl = new Map<string, string>();

export function consumePendingTelegramImageUrl(chatId: string): string | undefined {
    const u = pendingTelegramImageUrl.get(chatId);
    if (u) pendingTelegramImageUrl.delete(chatId);
    return u;
}

function getImageApiKey(): string {
    const k =
        process.env.OPENAI_API_KEY?.trim() ||
        process.env.IMAGE_GENERATION_API_KEY?.trim();
    if (!k) {
        throw new Error(
            'Falta OPENAI_API_KEY o IMAGE_GENERATION_API_KEY para generate_image (ver README).'
        );
    }
    return k;
}

async function openAiCreateImage(
    prompt: string,
    size: string
): Promise<{ url: string; revised_prompt?: string }> {
    const apiKey = getImageApiKey();
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

registerTool({
    name: 'generate_image',
    description:
        'Generar una imagen desde una descripcion (ilustracion, banner, concepto visual, meme, etc.). Usa la API de imagenes de OpenAI (DALL-E por defecto). Si el usuario pide crear/dibujar/generar una imagen, llama esta tool con prompt claro.',
    parameters: {
        type: 'object',
        properties: {
            prompt: {
                type: 'string',
                description: 'Que debe mostrar la imagen (estilo, colores, composicion). Puede estar en espanol u ingles.',
            },
            size: {
                type: 'string',
                enum: ['1024x1024', '1792x1024', '1024x1792'],
                description: 'Tamano para dall-e-3. Por defecto 1024x1024 si omites.',
            },
            save_relative_path: {
                type: 'string',
                description:
                    'Opcional: guardar PNG en el workspace, ej. imagenes/banner.png (relativo a WORKSPACE_BASE_DIR)',
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

        const { url, revised_prompt } = await openAiCreateImage(p, size);

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

        const parts = [
            '🖼️ Imagen generada.',
            `🔗 ${url}`,
            revised_prompt ? `\n📝 Prompt revisado: ${revised_prompt}` : '',
            savedLine,
        ];
        return parts.filter(Boolean).join('');
    },
});
