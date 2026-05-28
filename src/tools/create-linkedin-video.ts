import { promises as fs } from 'node:fs';
import { registerTool } from '../core/dispatcher';
import { getToolContext } from '../core/tool-context';
import { uploadVideoToStorage } from '../core/storage';
import { sendTelegramChatMessage } from '../integrations/telegram/send-message';
import { renderRemotionVideo } from '../lib/remotion-render';
import { setPendingTelegramImagePath } from './generate-image';
import { logger } from '../core/logger';

const ACCENTS: Record<string, string> = {
    purple: '#8b5cf6',
    blue:   '#0ea5e9',
    green:  '#10b981',
    orange: '#f59e0b',
    pink:   '#ec4899',
    white:  '#f8fafc',
};

registerTool({
    name: 'create_linkedin_video',
    description:
        'Crea un vídeo animado para LinkedIn (1080×1080, texto en movimiento) usando Remotion. ' +
        'Ideal para publicar contenido de valor, reflexiones o anuncios. ' +
        'El vídeo tiene título grande + puntos clave animados + autor. ' +
        'Devuelve la URL del MP4 listo para adjuntar al post de LinkedIn.',
    parameters: {
        type: 'object',
        properties: {
            title: {
                type: 'string',
                description: 'Título o frase de impacto principal del vídeo. Breve (máx 12 palabras).',
            },
            lines: {
                type: 'array',
                items: { type: 'string' },
                description: 'Puntos clave del contenido. Cada string es una línea que aparece animada. Máx 6 líneas.',
            },
            cta: {
                type: 'string',
                description: 'Llamada a la acción al final (ej: "Sígueme para más contenido"). Opcional.',
            },
            accent: {
                type: 'string',
                enum: ['purple', 'blue', 'green', 'orange', 'pink', 'white'],
                description: 'Color de acento del vídeo. Default: purple.',
            },
            author: {
                type: 'string',
                description: 'Nombre de marca/autor al pie (ej: "Ziro · zirox.io"). Default: "Ziro · zirox.io".',
            },
        },
        required: ['title', 'lines'],
    },
    timeoutMs: 480_000,
    handler: async (args) => {
        const a = args as {
            title: string;
            lines: string[];
            cta?: string;
            accent?: string;
            author?: string;
        };

        const title  = String(a.title ?? '').trim();
        const lines  = (Array.isArray(a.lines) ? a.lines : []).map(String).filter(Boolean).slice(0, 6);
        const cta    = String(a.cta ?? '').trim();
        const accent = ACCENTS[a.accent ?? 'purple'] ?? ACCENTS.purple;
        const author = String(a.author ?? 'Ziro · zirox.io').trim();

        if (!title) throw new Error('El título es obligatorio.');
        if (lines.length === 0) throw new Error('Necesito al menos una línea de contenido.');

        const tctx   = getToolContext();
        const chatId = tctx?.chatId ?? '';

        if (chatId) {
            sendTelegramChatMessage(
                chatId,
                '🎬 Renderizando vídeo LinkedIn con Remotion... (~1-3 min)'
            ).catch(() => {});
        }

        let outputPath: string | null = null;
        try {
            const { outputPath: rendered, durationSec } = await renderRemotionVideo({
                compositionId: 'LinkedInVideo',
                props: { title, lines, cta, accent, author },
                outputName: 'linkedin',
                concurrency: 2,
            });
            outputPath = rendered;

            const { publicUrl } = await uploadVideoToStorage(
                await fs.readFile(rendered),
                chatId || 'linkedin',
                title.slice(0, 40)
            );

            logger.info(`[create_linkedin_video] uploaded: ${publicUrl}`);

            return [
                `✅ Vídeo LinkedIn listo (~${durationSec.toFixed(0)}s, 1080×1080).`,
                `🔗 ${publicUrl}`,
                '',
                'Para publicarlo en LinkedIn adjunta esta URL al post con linkedin_propose_post.',
            ].join('\n');

        } finally {
            if (outputPath) await fs.rm(outputPath, { force: true }).catch(() => {});
        }
    },
});
