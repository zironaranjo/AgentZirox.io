import { Bot, InputFile, type Context } from 'grammy';
import { processMessage } from '../../core/agent';
import {
    clearHistory,
    getLinkedInPendingPostForChat,
    listLinkedInPendingPostsForChat,
    setLinkedInPendingFailed,
    setLinkedInPendingPublished,
    setLinkedInPendingRejected,
} from '../../core/memory';
import { isLinkedInOAuthConfigured, publishLinkedInFeedPost } from '../linkedin/linkedin-api';
import { listTools } from '../../core/dispatcher';
import { logger } from '../../core/logger';
import { consumePendingTelegramImageUrl } from '../../tools/generate-image';

const lastTranscriptionByChat = new Map<string, string>();

export async function startTelegramBot() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set in .env');

    const bot = new Bot<Context>(token);

    // ── /start ────────────────────────────────────────────────────────────────
    bot.command('start', async (ctx) => {
        const name = ctx.from?.first_name ?? 'there';
        await ctx.reply(
            `👋 Hola ${name}! Soy **AgenteZirox** 🤖\n\n` +
            `Puedo ayudarte con:\n` +
            `• 📧 Enviar emails\n` +
            `• 🌐 Llamar cualquier API\n` +
            `• 🔌 Integrar servicios via MCP\n` +
            `• 🎙️ Transcribir notas de voz\n` +
            `• 🖼️ Analizar y generar imagenes\n` +
            `• 💾 Recordar conversaciones anteriores\n` +
            `• 💼 Borradores y publicacion LinkedIn (con tu aprobacion)\n\n` +
            `Solo escríbeme lo que necesitas!\n\n` +
            `Comandos:\n` +
            `/reset — Borrar historial\n` +
            `/status — Estado del agente\n` +
            `/tools — Ver herramientas disponibles\n` +
            `/provider [groq|openrouter] — Cambiar LLM\n` +
            `/li_pending — Posts LinkedIn esperando tu OK\n` +
            `/li_approve ID — Publicar en LinkedIn la propuesta ID\n` +
            `/li_reject ID — Cancelar propuesta ID`,
            { parse_mode: 'Markdown' }
        );
    });

    // ── /reset ────────────────────────────────────────────────────────────────
    bot.command('reset', async (ctx) => {
        const chatId = String(ctx.chat.id);
        await clearHistory(chatId);
        await ctx.reply('🧹 Historial borrado. Empezamos de cero!');
    });

    // ── /status ───────────────────────────────────────────────────────────────
    bot.command('status', async (ctx) => {
        const provider = process.env.LLM_PROVIDER ?? 'groq';
        const model = provider === 'groq'
            ? (process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile')
            : provider === 'hermes'
                ? (process.env.HERMES_MODEL ?? 'hermes-3-llama-3.1-70b')
                : (process.env.OPENROUTER_MODEL ?? 'anthropic/claude-3.5-sonnet');
        const toolsModel = provider === 'openrouter'
            ? (process.env.OPENROUTER_TOOLS_MODEL ?? process.env.OPENROUTER_MODEL ?? 'anthropic/claude-3.5-sonnet')
            : null;
        await ctx.reply(
            `🟢 **AgenteZirox** — Online\n` +
            `🧠 Proveedor: \`${provider}\`\n` +
            `📦 Modelo: \`${model}\`\n` +
            (toolsModel ? `🛠️ Modelo tools: \`${toolsModel}\`\n` : '') +
            `🔧 Herramientas: ${listTools().length}`,
            { parse_mode: 'Markdown' }
        );
    });

    // ── /tools ────────────────────────────────────────────────────────────────
    bot.command('tools', async (ctx) => {
        const tools = listTools();
        await ctx.reply(
            `🔧 **Herramientas disponibles (${tools.length}):**\n\n` +
            tools.map((t) => `• \`${t}\``).join('\n'),
            { parse_mode: 'Markdown' }
        );
    });

    // ── /provider ─────────────────────────────────────────────────────────────
    bot.command('provider', async (ctx) => {
        const arg = ctx.match?.toString().trim().toLowerCase();
        if (!arg || !['groq', 'openrouter'].includes(arg)) {
            await ctx.reply('Uso: /provider groq | /provider openrouter');
            return;
        }
        process.env.LLM_PROVIDER = arg;
        await ctx.reply(`✅ Proveedor LLM cambiado a: **${arg}**`, { parse_mode: 'Markdown' });
    });

    // ── LinkedIn (aprobación humana antes de publicar) ────────────────────────
    bot.command('li_pending', async (ctx) => {
        const chatId = String(ctx.chat.id);
        const rows = await listLinkedInPendingPostsForChat(chatId, 15);
        if (rows.length === 0) {
            await ctx.reply('No hay publicaciones LinkedIn pendientes de aprobación en este chat.');
            return;
        }
        const lines = rows.map((r) => {
            const snippet = r.body.length > 220 ? `${r.body.slice(0, 220)}…` : r.body;
            const pic = r.image_url ? '🖼️ ' : '';
            return `• ${pic}#${r.id} (${r.visibility}) — ${r.created_at}\n${snippet}`;
        });
        await ctx.reply(
            `📋 Pendientes:\n\n${lines.join('\n\n')}\n\nAprobar: /li_approve N — Rechazar: /li_reject N`
        );
    });

    bot.command('li_approve', async (ctx) => {
        const chatId = String(ctx.chat.id);
        const text = ctx.message?.text ?? '';
        const id = parseLiCommandId(text, 'li_approve');
        if (id == null || !Number.isFinite(id)) {
            await ctx.reply('Uso: /li_approve NUMERO (ejemplo: /li_approve 3)');
            return;
        }
        if (!isLinkedInOAuthConfigured()) {
            await ctx.reply('LinkedIn OAuth no configurado. Revisa LINKEDIN_* en .env (README).');
            return;
        }
        const row = await getLinkedInPendingPostForChat(id, chatId);
        if (!row || row.status !== 'pending') {
            await ctx.reply(`No existe la propuesta #${id} en estado pendiente para este chat.`);
            return;
        }
        await ctx.reply('⏳ Publicando en LinkedIn…');
        try {
            const result = await publishLinkedInFeedPost(
                row.body,
                row.visibility === 'CONNECTIONS' ? 'CONNECTIONS' : 'PUBLIC',
                row.image_url
            );
            const ref = result.restLiId ?? result.rawBody ?? 'ok';
            await setLinkedInPendingPublished(id, ref);
            const msg = result.restLiId
                ? `✅ Publicado en LinkedIn.\nRef: \`${result.restLiId}\``
                : `✅ Publicado en LinkedIn.`;
            await ctx.reply(msg, { parse_mode: 'Markdown' });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await setLinkedInPendingFailed(id, msg);
            await ctx.reply(`❌ Error al publicar: ${msg}`);
        }
    });

    bot.command('li_reject', async (ctx) => {
        const chatId = String(ctx.chat.id);
        const text = ctx.message?.text ?? '';
        const id = parseLiCommandId(text, 'li_reject');
        if (id == null || !Number.isFinite(id)) {
            await ctx.reply('Uso: /li_reject NUMERO');
            return;
        }
        const row = await getLinkedInPendingPostForChat(id, chatId);
        if (!row || row.status !== 'pending') {
            await ctx.reply(`No existe la propuesta #${id} pendiente.`);
            return;
        }
        await setLinkedInPendingRejected(id);
        await ctx.reply(`🛑 Propuesta #${id} rechazada. No se ha publicado nada en LinkedIn.`);
    });

    // ── Main message handler ──────────────────────────────────────────────────
    bot.on('message:text', async (ctx) => {
        const chatId = String(ctx.chat.id);
        const userText = ctx.message.text;

        // Quick shortcut to read last transcribed audio
        if (isReadLastAudioRequest(userText)) {
            const last = lastTranscriptionByChat.get(chatId);
            if (!last) {
                await ctx.reply('ℹ️ Aun no tengo una transcripcion de audio reciente en este chat.');
                return;
            }
            await sendLongReply(ctx, `🎙️ Ultima transcripcion:\n\n${last}`);
            return;
        }

        if (isAudioCapabilityQuestion(userText)) {
            await ctx.reply(
                '✅ Si, puedo entender tus audios en Telegram. Los transcribo automaticamente y luego te ayudo con resumenes, tareas o guardado de ideas.'
            );
            return;
        }

        // Show typing indicator
        await ctx.replyWithChatAction('typing');

        try {
            const response = await processMessage(chatId, userText);
            await sendAgentReplyWithOptionalImage(ctx, chatId, response);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('Telegram handler error:', msg);
            await ctx.reply(`❌ Error: ${msg}`);
        }
    });

    // ── Voice message handler ────────────────────────────────────────────────
    bot.on('message:voice', async (ctx) => {
        const chatId = String(ctx.chat.id);
        await ctx.replyWithChatAction('typing');

        try {
            await ctx.reply('🎙️ Recibido. Estoy transcribiendo tu nota de voz...');
            const transcription = await transcribeTelegramFile(ctx, ctx.message.voice.file_id);
            lastTranscriptionByChat.set(chatId, transcription);
            const response = await processMessage(chatId, transcription);
            await sendAgentReplyWithOptionalImage(ctx, chatId, response);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('Telegram voice handler error:', msg);
            await ctx.reply(`❌ Error procesando audio: ${msg}`);
        }
    });

    // ── Audio file handler ───────────────────────────────────────────────────
    bot.on('message:audio', async (ctx) => {
        const chatId = String(ctx.chat.id);
        await ctx.replyWithChatAction('typing');

        try {
            await ctx.reply('🎧 Recibido. Estoy transcribiendo el audio...');
            const transcription = await transcribeTelegramFile(ctx, ctx.message.audio.file_id);
            lastTranscriptionByChat.set(chatId, transcription);
            const response = await processMessage(chatId, transcription);
            await sendAgentReplyWithOptionalImage(ctx, chatId, response);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('Telegram audio handler error:', msg);
            await ctx.reply(`❌ Error procesando audio: ${msg}`);
        }
    });

    // ── Photo handler ────────────────────────────────────────────────────────
    bot.on('message:photo', async (ctx) => {
        await ctx.replyWithChatAction('typing');
        try {
            await ctx.reply('🖼️ Recibido. Estoy analizando la imagen...');
            const bestPhoto = ctx.message.photo[ctx.message.photo.length - 1];
            const analysis = await analyzeTelegramPhoto(ctx, bestPhoto.file_id, ctx.message.caption);
            await sendLongReply(ctx, analysis);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('Telegram photo handler error:', msg);
            await ctx.reply(`❌ Error analizando imagen: ${msg}`);
        }
    });

    // ── Error handler ─────────────────────────────────────────────────────────
    bot.catch((err) => {
        logger.error('Bot error:', err.message);
    });

    // Start polling
    await bot.start({
        onStart: () => logger.info('🤖 Telegram bot is polling...'),
    });
}

/** Si generate_image dejo URL pendiente para este chat, envia la foto antes del texto. */
async function sendAgentReplyWithOptionalImage(ctx: Context, chatId: string, response: string) {
    const imageUrl = consumePendingTelegramImageUrl(chatId);
    if (imageUrl) {
        try {
            // Descargar y subir como buffer para evitar que la URL de KIE expire
            const res = await fetch(imageUrl);
            if (res.ok) {
                const buf = Buffer.from(await res.arrayBuffer());
                await ctx.replyWithPhoto(new InputFile(buf, 'imagen.jpg'), { caption: '🖼️ Imagen generada' });
            } else {
                await ctx.replyWithPhoto(imageUrl, { caption: '🖼️ Imagen generada' });
            }
        } catch (e) {
            logger.warn('No se pudo enviar foto; el texto incluye el enlace.', e);
        }
    }
    await sendLongReply(ctx, response);
}

async function sendLongReply(ctx: Context, response: string) {
    const chunks = response.match(/.{1,4000}/gs) ?? [response];
    for (const chunk of chunks) {
        try {
            await ctx.reply(chunk, { parse_mode: 'Markdown' });
        } catch {
            // Fallback when Markdown entities are malformed in dynamic tool output.
            await ctx.reply(chunk);
        }
    }
}

async function transcribeTelegramFile(ctx: Context, fileId: string): Promise<string> {
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const groqApiKey = process.env.GROQ_API_KEY;

    if (!telegramToken) throw new Error('TELEGRAM_BOT_TOKEN no configurado');
    if (!groqApiKey) {
        throw new Error('GROQ_API_KEY no configurado para transcribir audio');
    }

    const telegramFile = await ctx.api.getFile(fileId);
    if (!telegramFile.file_path) {
        throw new Error('No se pudo obtener la ruta del archivo de Telegram');
    }

    const telegramFileUrl = `https://api.telegram.org/file/bot${telegramToken}/${telegramFile.file_path}`;
    const telegramRes = await fetch(telegramFileUrl);
    if (!telegramRes.ok) {
        throw new Error(`No se pudo descargar el audio de Telegram (${telegramRes.status})`);
    }

    const audioBuffer = await telegramRes.arrayBuffer();
    const audioBlob = new Blob([audioBuffer], { type: 'audio/ogg' });

    const form = new FormData();
    form.append('model', process.env.GROQ_TRANSCRIPTION_MODEL ?? 'whisper-large-v3-turbo');
    form.append('language', 'es');
    form.append('response_format', 'text');
    form.append('file', audioBlob, 'telegram-audio.ogg');

    const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${groqApiKey}`,
        },
        body: form,
    });

    if (!groqRes.ok) {
        const errText = await groqRes.text();
        throw new Error(`Fallo de transcripcion (${groqRes.status}): ${errText}`);
    }

    const text = (await groqRes.text()).trim();
    if (!text) throw new Error('No se pudo transcribir el audio');

    return `[Transcripcion de audio]\n${text}`;
}

function isReadLastAudioRequest(text: string): boolean {
    const normalized = text.trim().toLowerCase();
    return (
        normalized === 'lee el audio' ||
        normalized === 'leer el audio' ||
        normalized === 'lee la transcripcion' ||
        normalized === 'leer la transcripcion' ||
        normalized === 'muestra la transcripcion' ||
        normalized === 'repite la transcripcion'
    );
}

function parseLiCommandId(text: string, command: string): number | null {
    const trimmed = text.trim();
    const re = new RegExp(`^/${command}(?:@\\S+)?\\s+(\\d+)\\s*$`, 'i');
    const m = trimmed.match(re);
    if (!m) return null;
    return parseInt(m[1], 10);
}

function isAudioCapabilityQuestion(text: string): boolean {
    const normalized = text.trim().toLowerCase();
    return (
        normalized.includes('puedes leer') && normalized.includes('audio') ||
        normalized.includes('entiendes') && normalized.includes('audio') ||
        normalized.includes('puedes escuchar') && normalized.includes('audio') ||
        normalized.includes('puedes procesar') && normalized.includes('audio')
    );
}

async function analyzeTelegramPhoto(
    ctx: Context,
    fileId: string,
    caption?: string
): Promise<string> {
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const openRouterApiKey = process.env.OPENROUTER_API_KEY;
    const visionModel = process.env.OPENROUTER_VISION_MODEL ?? 'openai/gpt-4o-mini';

    if (!telegramToken) throw new Error('TELEGRAM_BOT_TOKEN no configurado');
    if (!openRouterApiKey) {
        throw new Error('OPENROUTER_API_KEY no configurado para analisis de imagen');
    }

    const telegramFile = await ctx.api.getFile(fileId);
    if (!telegramFile.file_path) {
        throw new Error('No se pudo obtener la ruta de la imagen en Telegram');
    }

    const fileUrl = `https://api.telegram.org/file/bot${telegramToken}/${telegramFile.file_path}`;
    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) {
        throw new Error(`No se pudo descargar la imagen de Telegram (${fileRes.status})`);
    }

    const imageBuffer = Buffer.from(await fileRes.arrayBuffer());
    const imageBase64 = imageBuffer.toString('base64');
    const prompt =
        (caption?.trim() ? `Peticion del usuario: ${caption.trim()}\n\n` : '') +
        'Analiza esta imagen en espanol. Describe lo relevante y responde de forma util y concreta.';

    const payload = {
        model: visionModel,
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:image/jpeg;base64,${imageBase64}`,
                        },
                    },
                ],
            },
        ],
        temperature: 0.2,
        max_tokens: 800,
    };

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${openRouterApiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://agentezirox.io',
            'X-Title': 'AgenteZirox',
        },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Fallo de vision (${res.status}): ${errText}`);
    }

    const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) {
        throw new Error('El modelo no devolvio analisis de imagen');
    }

    return `🖼️ Analisis de imagen:\n\n${content}`;
}
