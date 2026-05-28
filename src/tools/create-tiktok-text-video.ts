import { promises as fs } from 'node:fs';
import { registerTool } from '../core/dispatcher';
import { getToolContext } from '../core/tool-context';
import { uploadVideoToStorage } from '../core/storage';
import { sendTelegramChatMessage } from '../integrations/telegram/send-message';
import { renderRemotionVideo } from '../lib/remotion-render';
import { insertPending, type TikTokPrivacy } from '../integrations/tiktok/pending-posts';
import { isTikTokConfigured } from '../integrations/tiktok/tiktok-api';
import { logger } from '../core/logger';

const ACCENTS: Record<string, string> = {
    purple: '#8b5cf6',
    blue:   '#0ea5e9',
    green:  '#10b981',
    orange: '#f59e0b',
    pink:   '#ec4899',
    red:    '#ef4444',
    white:  '#f8fafc',
};

const PRIVACIES = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'];

registerTool({
    name: 'create_tiktok_text_video',
    description:
        'Crea un vídeo vertical (1080×1920, 9:16) de texto animado para TikTok usando Remotion. ' +
        'Ideal para tips, listas, reflexiones o contenido de valor sin necesitar IA generativa. ' +
        'Más rápido y barato que create_short_video (no usa Veo ni TTS). ' +
        'Usa para contenido tipo "texto en movimiento" / "lista de tips" / "fact rápido".',
    parameters: {
        type: 'object',
        properties: {
            hook: {
                type: 'string',
                description: 'Frase de gancho grande que aparece primero. Impactante, máx 8 palabras.',
            },
            lines: {
                type: 'array',
                items: { type: 'string' },
                description: 'Puntos del contenido que aparecen animados bajo el hook. Máx 5 líneas.',
            },
            cta: {
                type: 'string',
                description: 'Llamada a la acción al final (ej: "¡Sígueme para más! 👇"). Opcional.',
            },
            caption: {
                type: 'string',
                description: 'Texto del post TikTok (incluye hashtags). Máx 2200 caracteres.',
            },
            accent: {
                type: 'string',
                enum: ['purple', 'blue', 'green', 'orange', 'pink', 'red', 'white'],
                description: 'Color de acento. Default: purple.',
            },
            author: {
                type: 'string',
                description: 'Handle o nombre de marca al pie (ej: "@zirox.io"). Default: "@zirox.io".',
            },
            privacy: {
                type: 'string',
                enum: PRIVACIES,
                description: 'Visibilidad en TikTok. Default: PUBLIC_TO_EVERYONE.',
            },
        },
        required: ['hook', 'lines', 'caption'],
    },
    timeoutMs: 480_000,
    handler: async (args) => {
        const a = args as {
            hook: string;
            lines: string[];
            cta?: string;
            caption: string;
            accent?: string;
            author?: string;
            privacy?: string;
        };

        const hook    = String(a.hook ?? '').trim();
        const lines   = (Array.isArray(a.lines) ? a.lines : []).map(String).filter(Boolean).slice(0, 5);
        const cta     = String(a.cta ?? '¡Sígueme para más! 👇').trim();
        const caption = String(a.caption ?? '').trim().slice(0, 2200);
        const accent  = ACCENTS[a.accent ?? 'purple'] ?? ACCENTS.purple;
        const author  = String(a.author ?? '@zirox.io').trim();
        const privacy: TikTokPrivacy = PRIVACIES.includes(a.privacy ?? '')
            ? (a.privacy as TikTokPrivacy)
            : 'PUBLIC_TO_EVERYONE';

        if (!hook)    throw new Error('El hook es obligatorio.');
        if (lines.length === 0) throw new Error('Necesito al menos una línea de contenido.');
        if (!caption) throw new Error('El caption para TikTok es obligatorio.');

        const tctx   = getToolContext();
        const chatId = tctx?.chatId ?? '';

        if (chatId) {
            sendTelegramChatMessage(
                chatId,
                '🎬 Renderizando vídeo TikTok con Remotion... (~1-2 min)'
            ).catch(() => {});
        }

        let outputPath: string | null = null;
        try {
            const { outputPath: rendered, durationSec } = await renderRemotionVideo({
                compositionId: 'TikTokTextVideo',
                props: { hook, lines, cta, accent, author },
                outputName: 'tiktok-text',
                concurrency: 2,
            });
            outputPath = rendered;

            const { publicUrl } = await uploadVideoToStorage(
                await fs.readFile(rendered),
                chatId || 'tiktok',
                hook.slice(0, 40)
            );

            logger.info(`[create_tiktok_text_video] uploaded: ${publicUrl}`);

            let queued: string;
            if (isTikTokConfigured()) {
                const id = await insertPending(chatId, publicUrl, caption, privacy);
                queued = [
                    `📋 En cola para TikTok — id \`${id}\``,
                    `Publicar: \`/tt_approve ${id}\`  ·  Cancelar: \`/tt_reject ${id}\``,
                ].join('\n');
            } else {
                queued = '⚠️ TikTok no configurado. Autoriza en /api/tiktok/auth.';
            }

            return [
                `✅ Vídeo TikTok texto listo (~${durationSec.toFixed(0)}s, 1080×1920).`,
                `🔗 ${publicUrl}`,
                '',
                queued,
            ].join('\n');

        } finally {
            if (outputPath) await fs.rm(outputPath, { force: true }).catch(() => {});
        }
    },
});
