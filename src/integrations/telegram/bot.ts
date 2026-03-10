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
            : (process.env.OPENROUTER_MODEL ?? 'anthropic/claude-3.5-sonnet');
        await ctx.reply(
            `🟢 **AgenteZirox** — Online\n` +
            `🧠 Proveedor: \`${provider}\`\n` +
            `📦 Modelo: \`${model}\`\n` +
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

    // ── Error handler ─────────────────────────────────────────────────────────
    bot.catch((err) => {
        logger.error('Bot error:', err.message);
    });

    // Start polling
    await bot.start({
        onStart: () => logger.info('🤖 Telegram bot is polling...'),
    });
}
