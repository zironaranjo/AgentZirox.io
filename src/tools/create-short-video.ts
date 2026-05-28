import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registerTool } from '../core/dispatcher';
import { getToolContext } from '../core/tool-context';
import { sendTelegramChatMessage } from '../integrations/telegram/send-message';
import { generateImageUrl } from './generate-image';
import { buildShortVideo } from '../lib/short-video';
import { uploadVideoToStorage } from '../core/storage';
import { insertPending, type TikTokPrivacy } from '../integrations/tiktok/pending-posts';
import { isTikTokConfigured } from '../integrations/tiktok/tiktok-api';
import { logger } from '../core/logger';

const PRIVACIES = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'];

function splitScript(script: string): string[] {
    return script
        .split(/\n+|(?<=[.!?…])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

registerTool({
    name: 'create_short_video',
    description:
        'Crea un vídeo vertical (9:16) tipo TikTok/Reel/Short a partir de un GUION: genera voz en off en español (Edge TTS), un fondo con IA, quema subtítulos grandes sincronizados y monta el MP4 con FFmpeg. Luego lo sube y lo deja pendiente de aprobación para TikTok. Úsala cuando el usuario quiera un vídeo con voz y texto en pantalla (imitando formatos de "valor"/"motivacional"), NO para clips cinematográficos de 8s (eso es generate_video). Pasa el guion ya dividido en frases cortas en "segments".',
    parameters: {
        type: 'object',
        properties: {
            segments: {
                type: 'array',
                items: { type: 'string' },
                description: 'Frases del guion EN ORDEN. Cada frase = un subtítulo + un trozo de voz. Mantenlas cortas (1 idea por frase).',
            },
            script: {
                type: 'string',
                description: 'Alternativa a segments: guion completo en texto; se dividirá automáticamente en frases.',
            },
            caption: {
                type: 'string',
                description: 'Texto del post para TikTok (incluye hashtags). Máx 2200 caracteres.',
            },
            image_prompt: {
                type: 'string',
                description: 'Descripción del fondo visual a generar con IA. Si se omite, se deriva del primer segmento/caption.',
            },
            voice: {
                type: 'string',
                description: 'Voz en off: jorge (MX masc, default), alvaro (ES masc), elvira (ES fem), dalia (MX fem).',
            },
            privacy: {
                type: 'string',
                enum: PRIVACIES,
                description: 'Visibilidad en TikTok (default PUBLIC_TO_EVERYONE).',
            },
        },
        required: ['caption'],
    },
    timeoutMs: 290_000,
    handler: async (args) => {
        const a = args as {
            segments?: string[];
            script?: string;
            caption?: string;
            image_prompt?: string;
            voice?: string;
            privacy?: string;
        };

        const tctx = getToolContext();
        const chatId = tctx?.chatId;
        if (!chatId) throw new Error('create_short_video requiere chat vinculado (Telegram).');

        let segments = Array.isArray(a.segments) ? a.segments.map((s) => String(s).trim()).filter(Boolean) : [];
        if (segments.length === 0 && a.script) segments = splitScript(String(a.script));
        if (segments.length === 0) throw new Error('Falta el guion: pasa "segments" (frases) o "script".');
        if (segments.length > 24) segments = segments.slice(0, 24);

        const caption = String(a.caption ?? '').trim().slice(0, 2200);
        if (!caption) throw new Error('Falta el caption del post.');

        const voice = String(a.voice ?? 'jorge').toLowerCase();
        const privacy: TikTokPrivacy = PRIVACIES.includes(a.privacy ?? '')
            ? (a.privacy as TikTokPrivacy)
            : 'PUBLIC_TO_EVERYONE';

        const imagePrompt =
            (a.image_prompt && String(a.image_prompt).trim()) ||
            `Fondo vertical cinematográfico, atmósfera moderna y sobria, sin texto, relacionado con: ${segments[0]}`;

        sendTelegramChatMessage(
            chatId,
            '🎬 Montando tu vídeo (voz + subtítulos + fondo)... tardo ~1-3 min y te lo dejo listo para aprobar.'
        ).catch(() => {});

        // 1) Fondo con IA
        let bgPath: string | null = null;
        const tmpFile = path.join(tmpdir(), `bg-${Date.now()}.jpg`);
        try {
            const imageUrl = await generateImageUrl(imagePrompt, '1024x1792');
            const res = await fetch(imageUrl);
            if (!res.ok) throw new Error(`descarga de fondo ${res.status}`);
            await fs.writeFile(tmpFile, Buffer.from(await res.arrayBuffer()));
            bgPath = tmpFile;
        } catch (err) {
            logger.error(`[create_short_video] fallo fondo IA: ${err instanceof Error ? err.message : String(err)}`);
            throw new Error('No se pudo generar el fondo del vídeo. Revisa KIE_API_KEY/OPENAI_API_KEY.');
        }

        // 2) Montaje
        let video;
        try {
            video = await buildShortVideo({ segments, bgImagePath: bgPath, voiceKey: voice });
        } finally {
            await fs.rm(tmpFile, { force: true }).catch(() => {});
        }

        // 3) Subir a storage
        const slug = segments[0].slice(0, 40);
        const { publicUrl } = await uploadVideoToStorage(video.buffer, chatId, slug);

        // 4) Encolar para TikTok (pendiente de aprobación)
        let queued = '';
        if (isTikTokConfigured()) {
            const id = await insertPending(chatId, publicUrl, caption, privacy);
            queued = [
                `📋 En cola para TikTok — id \`${id}\``,
                `Para publicar: \`/tt_approve ${id}\`  ·  Cancelar: \`/tt_reject ${id}\``,
            ].join('\n');
        } else {
            queued = '⚠️ TikTok no está configurado: el vídeo está subido pero no se encoló. Autoriza en /api/tiktok/auth.';
        }

        return [
            `✅ Vídeo montado (~${video.durationSec.toFixed(0)}s, 9:16, ${segments.length} subtítulos).`,
            `🔗 ${publicUrl}`,
            '',
            queued,
        ].join('\n');
    },
});
