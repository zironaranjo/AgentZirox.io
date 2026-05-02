/**
 * Envío de mensajes vía API HTTP de Telegram (sin instancia de Bot).
 * Para cron / tareas programadas que no pasan por grammY.
 */
export async function sendTelegramChatMessage(chatId: string, text: string, parseMode?: 'Markdown' | 'HTML' | false): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN no configurado');

    const chunks = text.match(/[\s\S]{1,4000}/g) ?? [text];
    for (const chunk of chunks) {
        const body: Record<string, unknown> = { chat_id: chatId, text: chunk };
        if (parseMode !== false) body.parse_mode = parseMode ?? 'Markdown';
        let res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: chunk }),
            });
            if (!res.ok) {
                const err = await res.text();
                throw new Error(`Telegram sendMessage ${res.status}: ${err}`);
            }
        }
    }
}
