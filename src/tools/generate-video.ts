import { registerTool } from '../core/dispatcher';
import { getToolContext } from '../core/tool-context';
import { sendTelegramChatMessage } from '../integrations/telegram/send-message';
import { storePendingVideo } from '../integrations/kie/pending-videos';
import { logger } from '../core/logger';

const KIE_BASE = (process.env.KIE_BASE_URL?.trim() || 'https://api.kie.ai').replace(/\/+$/, '');
const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL?.trim() || 'https://ziro.zirox.io').replace(/\/+$/, '');

function getKieKey(): string {
    const k = process.env.KIE_API_KEY?.trim();
    if (!k) throw new Error('Falta KIE_API_KEY (https://kie.ai/api-key).');
    return k;
}

registerTool({
    name: 'generate_video',
    description:
        'Genera UN ÚNICO clip cinematográfico de 8s (vertical 9:16, 1080p) desde texto con Kie.ai Veo 3.1, SIN voz en off propia ni subtítulos quemados ni guion multi-frase. ' +
        'Úsala SOLO para un clip suelto. ⚠️ Si el usuario pide un vídeo CON VOZ en off, con SUBTÍTULOS, con GUION de varias frases, o "modo veo/kenburns con voz", NO uses esta tool: usa create_short_video (que genera los clips, los une y añade voz+subtítulos en un solo vídeo). ' +
        'Requiere KIE_API_KEY. Kie avisará por Telegram cuando el video esté listo (~2-5 min) y lo propondrá para TikTok.',
    parameters: {
        type: 'object',
        properties: {
            prompt: {
                type: 'string',
                description:
                    'Descripción detallada del video: escena, estilo visual, movimiento de cámara, colores, ambiente.',
            },
            caption: {
                type: 'string',
                description: 'Texto/descripción para el post de TikTok (incluye hashtags). Si no se especifica, usa el prompt.',
            },
        },
        required: ['prompt'],
    },
    timeoutMs: 30_000,
    handler: async (args) => {
        const { prompt, caption: captionArg } = args as { prompt: string; caption?: string };

        const p = prompt.trim();
        if (!p) throw new Error('prompt vacío');

        const apiKey = getKieKey();
        const tctx = getToolContext();
        const chatId = tctx?.chatId ?? '';

        const callbackUrl = `${BASE_URL}/api/kie/callback`;

        const res = await fetch(`${KIE_BASE}/api/v1/veo/generate`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                prompt: p.slice(0, 5000),
                model: 'veo3_fast',
                generationType: 'TEXT_2_VIDEO',
                aspect_ratio: '9:16',
                resolution: '1080p',
                callbackUrl,
            }),
        });

        const raw = await res.text();
        logger.info(`[KIE-VEO] generate status=${res.status} body=${raw.slice(0, 400)}`);

        let json: { code?: number; msg?: string; data?: { taskId?: string } };
        try { json = JSON.parse(raw) as typeof json; }
        catch { throw new Error(`KIE-VEO respuesta no JSON: ${raw.slice(0, 200)}`); }

        if (!res.ok || json.code !== 200 || !json.data?.taskId) {
            throw new Error(`KIE-VEO generate falló (${res.status}): ${json.msg ?? raw.slice(0, 200)}`);
        }

        const taskId = json.data.taskId;
        const caption = (captionArg ?? p).slice(0, 2200);

        // Guardar en Supabase para que el webhook lo recupere
        await storePendingVideo(taskId, {
            chatId,
            caption,
            privacy: 'PUBLIC_TO_EVERYONE',
            createdAt: Date.now(),
        });

        // Notificar al usuario
        if (chatId) {
            sendTelegramChatMessage(
                chatId,
                '🎬 Video en generación con Kie.ai Veo 3.1... te aviso por aquí cuando esté listo (~2-5 min) y te lo propongo para TikTok.'
            ).catch(() => {});
        }

        return '🎬 Video en generación. Te avisaré por Telegram cuando Kie lo haya terminado y lo propondré automáticamente para TikTok.';
    },
});
