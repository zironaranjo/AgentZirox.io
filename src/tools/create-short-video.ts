import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registerTool } from '../core/dispatcher';
import { getToolContext } from '../core/tool-context';
import { sendTelegramChatMessage } from '../integrations/telegram/send-message';
import { generateImageUrl } from './generate-image';
import { kieGenerateVeoClip } from '../integrations/kie/veo';
import { buildShortVideo, type BackgroundSpec } from '../lib/short-video';
import { uploadVideoToStorage } from '../core/storage';
import { insertPending, type TikTokPrivacy } from '../integrations/tiktok/pending-posts';
import { isTikTokConfigured } from '../integrations/tiktok/tiktok-api';
import { logger } from '../core/logger';

const PRIVACIES = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'];
const MOTIONS = ['veo', 'kenburns', 'image'];

function splitScript(script: string): string[] {
    return script
        .split(/\n+|(?<=[.!?…])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

async function downloadTo(url: string, file: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`descarga ${res.status} de ${url.slice(0, 60)}`);
    await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
}

registerTool({
    name: 'create_short_video',
    description:
        'Crea un vídeo vertical (9:16) tipo TikTok/Reel/Short a partir de un GUION: voz en off en español (Edge TTS), subtítulos grandes sincronizados quemados y un FONDO EN MOVIMIENTO. El fondo es configurable con "motion": "veo" (clips de vídeo generados por IA, más cinematográfico, más caro/lento), "kenburns" (zoom/paneo sobre imagen IA, barato) o "image" (imagen estática). Luego sube el MP4 y lo deja pendiente de aprobación para TikTok. Úsala para vídeos con voz+texto (estilo "valor"/motivacional). Pasa el guion en frases cortas en "segments".',
    parameters: {
        type: 'object',
        properties: {
            segments: {
                type: 'array',
                items: { type: 'string' },
                description: 'Frases del guion EN ORDEN. Cada frase = un subtítulo + un trozo de voz. Cortas (1 idea por frase).',
            },
            script: {
                type: 'string',
                description: 'Alternativa a segments: guion completo; se divide automáticamente en frases.',
            },
            caption: {
                type: 'string',
                description: 'Texto del post para TikTok (incluye hashtags). Máx 2200 caracteres.',
            },
            motion: {
                type: 'string',
                enum: MOTIONS,
                description: 'Tipo de fondo: veo (clips IA, default), kenburns (zoom sobre imagen IA), image (estática).',
            },
            scene_prompts: {
                type: 'array',
                items: { type: 'string' },
                description: 'Solo para motion=veo: descripciones de cada clip de vídeo a generar (en orden). Si se omite, se derivan del tema.',
            },
            image_prompt: {
                type: 'string',
                description: 'Para motion=kenburns/image: descripción del fondo a generar. Si se omite, se deriva del guion.',
            },
            veo_clips: {
                type: 'number',
                description: 'Solo motion=veo: nº de clips de 8s a generar (default 2, máx 4). Más clips = más variedad pero más coste/tiempo.',
            },
            voice: {
                type: 'string',
                description: 'Voz: jorge (MX masc, default), alvaro (ES masc), elvira (ES fem), dalia (MX fem).',
            },
            privacy: {
                type: 'string',
                enum: PRIVACIES,
                description: 'Visibilidad en TikTok (default PUBLIC_TO_EVERYONE).',
            },
        },
        required: ['caption'],
    },
    timeoutMs: 590_000,
    handler: async (args) => {
        const a = args as {
            segments?: string[];
            script?: string;
            caption?: string;
            motion?: string;
            scene_prompts?: string[];
            image_prompt?: string;
            veo_clips?: number;
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

        const motion = MOTIONS.includes(a.motion ?? '') ? (a.motion as string) : 'veo';
        const voice = String(a.voice ?? 'jorge').toLowerCase();
        const privacy: TikTokPrivacy = PRIVACIES.includes(a.privacy ?? '')
            ? (a.privacy as TikTokPrivacy)
            : 'PUBLIC_TO_EVERYONE';

        const tmpFiles: string[] = [];
        const baseTopic = segments[0];

        try {
            let background: BackgroundSpec;

            if (motion === 'veo') {
                const nClips = Math.min(4, Math.max(1, Math.round(Number(a.veo_clips) || 2)));
                const prompts: string[] = Array.isArray(a.scene_prompts) && a.scene_prompts.length > 0
                    ? a.scene_prompts.map(String).slice(0, nClips)
                    : Array.from({ length: nClips }, (_, i) =>
                          `Plano vertical cinematográfico 9:16, atmósfera moderna y sobria, sin texto en pantalla, movimiento de cámara lento, escena ${i + 1} relacionada con: ${baseTopic}`
                      );

                sendTelegramChatMessage(
                    chatId,
                    `🎬 Generando ${prompts.length} clip(s) de vídeo con Veo (puede tardar varios minutos)... luego añado voz y subtítulos.`
                ).catch(() => {});

                const urls = await Promise.all(
                    prompts.map((p) => kieGenerateVeoClip(p).catch((e) => {
                        logger.error(`[create_short_video] clip Veo falló: ${e instanceof Error ? e.message : String(e)}`);
                        return null;
                    }))
                );
                const okUrls = urls.filter((u): u is string => Boolean(u));
                if (okUrls.length === 0) throw new Error('No se pudo generar ningún clip de vídeo con Veo. Revisa KIE_API_KEY/saldo.');

                const clipPaths: string[] = [];
                for (let i = 0; i < okUrls.length; i++) {
                    const f = path.join(tmpdir(), `veo-${Date.now()}-${i}.mp4`);
                    await downloadTo(okUrls[i], f);
                    tmpFiles.push(f);
                    clipPaths.push(f);
                }
                background = { type: 'veo', clipPaths };
            } else {
                const imagePrompt =
                    (a.image_prompt && String(a.image_prompt).trim()) ||
                    `Fondo vertical cinematográfico, atmósfera moderna y sobria, sin texto, relacionado con: ${baseTopic}`;

                sendTelegramChatMessage(
                    chatId,
                    '🎬 Montando tu vídeo (fondo IA + voz + subtítulos)... ~1-3 min.'
                ).catch(() => {});

                const imageUrl = await generateImageUrl(imagePrompt, '1024x1792');
                const f = path.join(tmpdir(), `bg-${Date.now()}.jpg`);
                await downloadTo(imageUrl, f);
                tmpFiles.push(f);
                background = { type: motion === 'kenburns' ? 'kenburns' : 'image', path: f };
            }

            const video = await buildShortVideo({ segments, background, voiceKey: voice });

            const { publicUrl } = await uploadVideoToStorage(video.buffer, chatId, baseTopic.slice(0, 40));

            let queued: string;
            if (isTikTokConfigured()) {
                const id = await insertPending(chatId, publicUrl, caption, privacy);
                queued = [
                    `📋 En cola para TikTok — id \`${id}\``,
                    `Publicar: \`/tt_approve ${id}\`  ·  Cancelar: \`/tt_reject ${id}\``,
                ].join('\n');
            } else {
                queued = '⚠️ TikTok no está configurado: el vídeo está subido pero no se encoló. Autoriza en /api/tiktok/auth.';
            }

            return [
                `✅ Vídeo montado (~${video.durationSec.toFixed(0)}s, 9:16, fondo: ${motion}, ${segments.length} subtítulos).`,
                `🔗 ${publicUrl}`,
                '',
                queued,
            ].join('\n');
        } finally {
            await Promise.all(tmpFiles.map((f) => fs.rm(f, { force: true }).catch(() => {})));
        }
    },
});
