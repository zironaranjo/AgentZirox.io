import { processMessage } from './agent';
import {
    claimNextDueScheduledTask,
    markScheduledTaskDone,
    markScheduledTaskFailed,
    releaseStuckRunningTasks,
} from './memory';
import { sendTelegramChatMessage } from '../integrations/telegram/send-message';
import { isAiNewsBriefing } from './search-locale';
import { logger } from './logger';

const WA_API_VERSION = 'v19.0';

async function deliverScheduledReply(chatId: string, text: string): Promise<void> {
    if (chatId.startsWith('wa_')) {
        const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
        const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
        if (!phoneNumberId || !accessToken) {
            logger.error('[scheduled] WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN no configurados — no se puede entregar el recordatorio');
            return;
        }
        const to = chatId.startsWith('wa_group_')
            ? chatId.replace('wa_group_', '')
            : chatId.replace('wa_', '');
        const chunks = splitIntoChunks(text, 4000);
        for (const chunk of chunks) {
            const res = await fetch(
                `https://graph.facebook.com/${WA_API_VERSION}/${phoneNumberId}/messages`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        messaging_product: 'whatsapp',
                        to,
                        type: 'text',
                        text: { body: chunk },
                    }),
                }
            );
            if (!res.ok) {
                const raw = await res.text();
                logger.error(`[scheduled] WhatsApp delivery error (${res.status}): ${raw.slice(0, 300)}`);
            }
        }
    } else {
        await sendTelegramChatMessage(chatId, text);
    }
}

function splitIntoChunks(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text];
    const chunks: string[] = [];
    let i = 0;
    while (i < text.length) { chunks.push(text.slice(i, i + maxLen)); i += maxLen; }
    return chunks;
}

function scheduledTasksEnabled(): boolean {
    const v = (process.env.SCHEDULED_TASKS_ENABLED ?? '').toLowerCase();
    return v === 'true' || v === '1' || v === 'yes';
}

function buildScheduledPrompt(instruction: string): string {
    const base = `⏰ **Tarea programada** (ejecución automática)\n\n${instruction}\n\n`;

    if (isAiNewsBriefing(instruction)) {
        return (
            base +
            'BRIEFING NOTICIAS IA (OBLIGATORIO):\n' +
            '1) Llama web_search UNA vez (la consulta ya filtra medios en español: Xataka, Hipertextual, Genbeta, El País, etc.).\n' +
            '2) Resume 3 noticias en ESPAÑOL con este formato por cada una:\n' +
            '   • **Titular** — por qué importa (1 frase) — 🔗 URL\n' +
            '3) SOLO fuentes en español de la búsqueda. PROHIBIDO citar medios en inglés.\n' +
            '4) PROHIBIDO inventar noticias. PROHIBIDO responder solo en inglés.\n' +
            'NO llames schedule_task, save_agent_task ni cancel_scheduled_task.'
        );
    }

    return (
        base +
        'Entrega el recordatorio al usuario en 1–3 frases, SIEMPRE en español (salvo que pida otro idioma). ' +
        'NO llames schedule_task, save_agent_task ni cancel_scheduled_task.'
    );
}

/** Evita dos ticks solapados (cron HTTP + ticker interno). */
let tickInProgress = false;

/**
 * Ejecuta todas las tareas vencidas (sin comprobar Bearer). Usado por el ticker del servidor y tras auth HTTP.
 */
export async function tickScheduledTasksInternal(): Promise<{ processed: number; errors: string[] }> {
    if (!scheduledTasksEnabled()) {
        return { processed: 0, errors: [] };
    }

    if (tickInProgress) {
        return { processed: 0, errors: [] };
    }

    tickInProgress = true;
    const errors: string[] = [];
    let processed = 0;

    try {
        const nowMs = Date.now();
        const released = await releaseStuckRunningTasks(nowMs, 2 * 60 * 60 * 1000);
        if (released > 0) {
            logger.warn(`[scheduled] released ${released} stuck running task(s)`);
        }

        for (let i = 0; i < 15; i++) {
            const task = await claimNextDueScheduledTask(nowMs);
            if (!task) break;

            try {
                const prompt = buildScheduledPrompt(task.instruction);
                const reply = await processMessage(task.chat_id, prompt);
                const isNews = isAiNewsBriefing(task.instruction);
                const maxLen = isNews ? 3500 : 500;
                const short =
                    reply.length > maxLen ? `${reply.slice(0, maxLen - 1).trim()}…` : reply;
                const header = isNews ? '📰 *Noticias IA*' : '🔔 *Recordatorio*';
                await deliverScheduledReply(task.chat_id, `${header}\n\n${short}`);
                await markScheduledTaskDone(task.id);
                processed++;
                logger.info(`[scheduled] completed task ${task.id} for chat ${task.chat_id}`);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                errors.push(`task ${task.id}: ${msg}`);
                logger.error(`[scheduled] task ${task.id} failed:`, err);
                await markScheduledTaskFailed(task.id);
            }
        }
    } finally {
        tickInProgress = false;
    }

    return { processed, errors };
}

export type RunScheduledResult =
    | { status: 'disabled' }
    | { status: 'unauthorized' }
    | { status: 'ok'; processed: number; errors: string[] };

export async function runDueScheduledTasks(authToken: string | null): Promise<RunScheduledResult> {
    const secret = (process.env.CRON_SECRET ?? process.env.SELF_IMPROVE_CRON_SECRET ?? '').trim();
    if (!scheduledTasksEnabled()) {
        return { status: 'disabled' };
    }
    if (!secret || authToken !== secret) {
        return { status: 'unauthorized' };
    }

    const { processed, errors } = await tickScheduledTasksInternal();
    return { status: 'ok', processed, errors };
}

/**
 * Ticker dentro del proceso Node (server.ts): no sustituye al endpoint HTTP si quieres disparar desde fuera,
 * pero evita depender solo del cron de Dokploy.
 */
export function startScheduledTasksTicker(): void {
    if (!scheduledTasksEnabled()) {
        return;
    }

    const v = (process.env.SCHEDULED_TASKS_INTERNAL_TICKER ?? 'true').toLowerCase();
    if (v === 'false' || v === '0' || v === 'no') {
        logger.info('[scheduled] ticker interno desactivado (SCHEDULED_TASKS_INTERNAL_TICKER=false); usa HTTP /api/cron/scheduled-tasks');
        return;
    }

    const ms = Math.max(
        15_000,
        Math.min(300_000, Number(process.env.SCHEDULED_TASKS_TICK_MS) || 60_000)
    );

    logger.info(`[scheduled] ticker interno cada ${ms / 1000}s (SCHEDULED_TASKS_ENABLED=true)`);

    const run = () => {
        tickScheduledTasksInternal()
            .then(({ processed, errors }) => {
                if (processed > 0) {
                    logger.info(`[scheduled] ticker: ${processed} tarea(s) ejecutada(s)`);
                }
                if (errors.length > 0) {
                    logger.warn('[scheduled] ticker errors:', errors);
                }
            })
            .catch((e) => logger.error('[scheduled] ticker:', e));
    };

    setTimeout(run, 12_000);
    setInterval(run, ms);
}
