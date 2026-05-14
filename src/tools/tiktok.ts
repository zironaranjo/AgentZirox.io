import { registerTool } from '../core/dispatcher';
import { getToolContext } from '../core/tool-context';
import { getMeta, setMeta } from '../core/memory';
import { isTikTokConfigured, publishTikTokVideo, type TikTokPrivacy } from '../integrations/tiktok/tiktok-api';
import { sendTelegramChatMessage } from '../integrations/telegram/send-message';

const META_KEY = 'tiktok_pending_posts';

interface TikTokPendingRow {
    id: number;
    chat_id: string;
    video_url: string;
    caption: string;
    privacy: TikTokPrivacy;
    status: 'pending' | 'published' | 'failed' | 'rejected';
    created_at: number;
    publish_id?: string;
    error?: string;
}

async function loadPending(): Promise<TikTokPendingRow[]> {
    const raw = await getMeta(META_KEY);
    if (!raw) return [];
    try { return JSON.parse(raw) as TikTokPendingRow[]; } catch { return []; }
}

async function savePending(rows: TikTokPendingRow[]): Promise<void> {
    // Keep only last 100 rows to avoid unbounded growth
    const trimmed = rows.slice(-100);
    await setMeta(META_KEY, JSON.stringify(trimmed));
}

async function insertPending(chatId: string, videoUrl: string, caption: string, privacy: TikTokPrivacy): Promise<number> {
    const rows = await loadPending();
    const id = rows.length > 0 ? Math.max(...rows.map(r => r.id)) + 1 : 1;
    rows.push({ id, chat_id: chatId, video_url: videoUrl, caption, privacy, status: 'pending', created_at: Date.now() });
    await savePending(rows);
    return id;
}

export async function getTikTokPendingForChat(id: number, chatId: string): Promise<TikTokPendingRow | undefined> {
    const rows = await loadPending();
    return rows.find(r => r.id === id && r.chat_id === chatId);
}

export async function listTikTokPendingForChat(chatId: string, limit = 10): Promise<TikTokPendingRow[]> {
    const rows = await loadPending();
    return rows.filter(r => r.chat_id === chatId && r.status === 'pending').slice(-limit);
}

async function updatePending(id: number, update: Partial<TikTokPendingRow>): Promise<void> {
    const rows = await loadPending();
    const idx = rows.findIndex(r => r.id === id);
    if (idx !== -1) { rows[idx] = { ...rows[idx], ...update }; await savePending(rows); }
}

// ── Tools ──────────────────────────────────────────────────────────────────

registerTool({
    name: 'tiktok_propose_video',
    description:
        'Encola un video para publicar en TikTok con tu aprobación. REQUISITO OBLIGATORIO: el usuario debe haber proporcionado explícitamente una URL de video MP4 real en su mensaje. NUNCA inventes, generes ni adivines una URL — si el usuario no proporcionó una URL concreta, NO llames esta herramienta y pídele la URL primero. Nunca publiques sin /tt_approve.',
    parameters: {
        type: 'object',
        properties: {
            video_url: {
                type: 'string',
                description: 'URL pública y directa del video MP4 a publicar. DEBE ser una URL real proporcionada explícitamente por el usuario — nunca la inventes.',
            },
            caption: {
                type: 'string',
                description: 'Texto/descripción del post (máx 2200 caracteres). Incluye hashtags aquí.',
            },
            privacy: {
                type: 'string',
                enum: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'],
                description: 'Visibilidad: PUBLIC_TO_EVERYONE (recomendado), FOLLOWER_OF_CREATOR, MUTUAL_FOLLOW_FRIENDS o SELF_ONLY.',
            },
        },
        required: ['video_url', 'caption'],
    },
    handler: async (args) => {
        const { video_url, caption, privacy: privRaw } = args as {
            video_url: string; caption: string; privacy?: string;
        };

        const tctx = getToolContext();
        if (!tctx?.chatId) throw new Error('tiktok_propose_video requiere chat vinculado (Telegram).');

        if (!isTikTokConfigured()) {
            return [
                '⚠️ TikTok no está configurado.',
                `Visita https://ziro.zirox.io/api/tiktok/auth para autorizar tu cuenta.`,
            ].join('\n');
        }

        const url = video_url.trim();
        if (!url) throw new Error('video_url es obligatorio');
        try { new URL(url); } catch { throw new Error('video_url no es una URL válida'); }

        const text = caption.trim().slice(0, 2200);
        const privacy = (['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'].includes(privRaw ?? ''))
            ? (privRaw as TikTokPrivacy)
            : 'PUBLIC_TO_EVERYONE';

        const id = await insertPending(tctx.chatId, url, text, privacy);

        sendTelegramChatMessage(
            tctx.chatId,
            `📋 Video TikTok en cola — ID: ${id}\nPara publicar: /tt_approve ${id}\nPara cancelar: /tt_reject ${id}`,
            false
        ).catch(() => {});

        const preview = text.length > 300 ? `${text.slice(0, 300)}…` : text;

        return [
            `📋 **Video TikTok pendiente de aprobación** — id \`${id}\``,
            `Visibilidad: **${privacy}**`,
            `🔗 URL: ${url}`,
            '',
            '---',
            preview,
            '---',
            '',
            `Para publicar en TikTok: \`/tt_approve ${id}\``,
            `Para cancelar: \`/tt_reject ${id}\``,
            '',
            'Hasta que apruebes, **no** se llama a la API de TikTok.',
        ].join('\n');
    },
});

registerTool({
    name: 'approve_tiktok_video',
    description: 'Publica en TikTok un video pendiente de aprobación. Usar cuando el usuario diga "aprueba", "sí publícalo", "dale" después de un tiktok_propose_video.',
    parameters: {
        type: 'object',
        properties: {
            post_id: { type: 'number', description: 'ID del video a aprobar. Si se omite, usa el más reciente.' },
        },
        required: [],
    },
    handler: async (args) => {
        const tctx = getToolContext();
        if (!tctx?.chatId) throw new Error('approve_tiktok_video requiere chat vinculado (Telegram).');
        if (!isTikTokConfigured()) return '⚠️ TikTok no está configurado. Visita https://ziro.zirox.io/api/tiktok/auth';

        const chatId = tctx.chatId;
        let row: TikTokPendingRow | undefined;

        if ((args as { post_id?: number }).post_id) {
            const id = Number((args as { post_id?: number }).post_id);
            row = await getTikTokPendingForChat(id, chatId);
            if (!row || row.status !== 'pending') return `No existe el video #${id} pendiente en este chat.`;
        } else {
            const rows = await listTikTokPendingForChat(chatId, 1);
            row = rows[0];
            if (!row) return 'No hay videos TikTok pendientes de aprobación en este chat.';
        }

        try {
            const { publishId } = await publishTikTokVideo(row.video_url, row.caption, row.privacy);
            await updatePending(row.id, { status: 'published', publish_id: publishId });
            return `✅ Video publicado en TikTok.\nPublish ID: \`${publishId}\``;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await updatePending(row.id, { status: 'failed', error: msg });
            return `❌ Error al publicar en TikTok: ${msg}`;
        }
    },
});

registerTool({
    name: 'reject_tiktok_video',
    description: 'Cancela un video TikTok pendiente. Si no se indica id, cancela todos los pendientes.',
    parameters: {
        type: 'object',
        properties: {
            post_id: { type: 'number', description: 'ID del video a cancelar.' },
        },
        required: [],
    },
    handler: async (args) => {
        const tctx = getToolContext();
        if (!tctx?.chatId) throw new Error('reject_tiktok_video requiere chat vinculado.');
        const chatId = tctx.chatId;

        if ((args as { post_id?: number }).post_id) {
            const id = Number((args as { post_id?: number }).post_id);
            const row = await getTikTokPendingForChat(id, chatId);
            if (!row || row.status !== 'pending') return `No existe el video #${id} pendiente.`;
            await updatePending(id, { status: 'rejected' });
            return `🗑️ Video TikTok #${id} cancelado.`;
        }

        const rows = await listTikTokPendingForChat(chatId);
        if (rows.length === 0) return 'No hay videos TikTok pendientes.';
        await Promise.all(rows.map(r => updatePending(r.id, { status: 'rejected' })));
        return `🗑️ ${rows.length} video(s) cancelado(s): ${rows.map(r => `#${r.id}`).join(', ')}.`;
    },
});

registerTool({
    name: 'tiktok_list_pending',
    description: 'Lista videos TikTok pendientes de aprobación en este chat.',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: async () => {
        const tctx = getToolContext();
        if (!tctx?.chatId) throw new Error('tiktok_list_pending requiere chat vinculado.');
        const rows = await listTikTokPendingForChat(tctx.chatId);
        if (rows.length === 0) return 'No hay videos TikTok pendientes.';
        const lines = rows.map(r =>
            `• id ${r.id} — ${new Date(r.created_at).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}\n  ${r.caption.slice(0, 80)}…`
        );
        return `📋 Videos TikTok pendientes:\n\n${lines.join('\n\n')}`;
    },
});
