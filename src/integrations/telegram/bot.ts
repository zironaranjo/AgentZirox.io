import { Bot, type Context } from 'grammy';
import { processMessage } from '../../core/agent.js';
import { clearHistory } from '../../core/memory.js';
import { listTools } from '../../core/dispatcher.js';
import { logger } from '../../core/logger.js';

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
            `• 💾 Recordar conversaciones anteriores\n\n` +
            `Solo escríbeme lo que necesitas!\n\n` +
            `Comandos:\n` +
            `/reset — Borrar historial\n` +
            `/status — Estado del agente\n` +
            `/tools — Ver herramientas disponibles\n` +
            `/provider [groq|openrouter] — Cambiar LLM`,
            { parse_mode: 'Markdown' }
        );
    });

    // ── /reset ────────────────────────────────────────────────────────────────
    bot.command('reset', async (ctx) => {
        const chatId = String(ctx.chat.id);
        clearHistory(chatId);
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

    // ── Main message handler ──────────────────────────────────────────────────
    bot.on('message:text', async (ctx) => {
        const chatId = String(ctx.chat.id);
        const userText = ctx.message.text;

        // Show typing indicator
        await ctx.replyWithChatAction('typing');

        try {
            const response = await processMessage(chatId, userText);
            // Split long messages (Telegram limit: 4096 chars)
            if (response.length <= 4096) {
                await ctx.reply(response, { parse_mode: 'Markdown' });
            } else {
                // Split into chunks
                const chunks = response.match(/.{1,4000}/gs) ?? [response];
                for (const chunk of chunks) {
                    await ctx.reply(chunk, { parse_mode: 'Markdown' });
                }
            }
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
            const response = await processMessage(chatId, transcription);
            await sendLongReply(ctx, response);
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
            const response = await processMessage(chatId, transcription);
            await sendLongReply(ctx, response);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('Telegram audio handler error:', msg);
            await ctx.reply(`❌ Error procesando audio: ${msg}`);
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

async function sendLongReply(ctx: Context, response: string) {
    if (response.length <= 4096) {
        await ctx.reply(response, { parse_mode: 'Markdown' });
        return;
    }

    const chunks = response.match(/.{1,4000}/gs) ?? [response];
    for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: 'Markdown' });
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
