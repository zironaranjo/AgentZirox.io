import { processMessage } from './agent';
import {
    claimNextDueScheduledTask,
    insertScheduledTask,
    markScheduledTaskDone,
    markScheduledTaskFailed,
    releaseStuckRunningTasks,
} from './memory';
import { sendTelegramChatMessage } from '../integrations/telegram/send-message';
import { isAiNewsBriefing, isDailyInfographicTask } from './search-locale';
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

function nextRepeatMs(runAtMs: number, interval: string): number {
    const d = new Date(runAtMs);
    switch (interval) {
        case 'hourly':  return runAtMs + 3_600_000;
        case 'daily':   return runAtMs + 86_400_000;
        case 'weekly':  return runAtMs + 7 * 86_400_000;
        case 'monthly': d.setMonth(d.getMonth() + 1); return d.getTime();
        default:        return runAtMs + 86_400_000;
    }
}

function buildScheduledPrompt(instruction: string): string {
    const base = `⏰ **Tarea programada** (ejecución automática)\n\n${instruction}\n\n`;

    if (isAiNewsBriefing(instruction)) {
        return (
            base +
            'BRIEFING NOTICIAS IA — 2 noticias de calidad (OBLIGATORIO):\n' +
            '1) web_search query 1: "nuevas herramientas IA lanzamiento desarrolladores software site:xataka.com OR site:hipertextual.com OR site:genbeta.com"\n' +
            '2) web_search query 2: "noticias inteligencia artificial tecnología hoy site:xataka.com OR site:hipertextual.com OR site:genbeta.com"\n' +
            '3) Elige la MEJOR noticia de cada búsqueda. Deben ser sobre TEMAS DISTINTOS (no misma empresa ni herramienta).\n' +
            '   PRIORIZA: lanzamientos de herramientas, APIs, modelos, frameworks nuevos — antes que análisis o artículos de opinión.\n' +
            '4) Formato de cada noticia (sin introducción, directo):\n' +
            '   🔧 **Titular exacto**\n' +
            '   • Qué es: una frase\n' +
            '   • Por qué importa para devs: una frase\n' +
            '   🔗 URL\n' +
            '5) PROHIBIDO: inventar, citar fuentes en inglés, repetir la misma empresa en ambas noticias.\n' +
            'NO llames schedule_task, save_agent_task ni cancel_scheduled_task.'
        );
    }

    if (isDailyInfographicTask(instruction)) {
        return (
            base +
            'INFOGRAFÍA + LINKEDIN (OBLIGATORIO — flujo completo en este turno):\n' +
            '1) web_search UNA vez: noticias IA hoy en español (Xataka, Hipertextual, Genbeta, etc.).\n' +
            '2) create_infographic_notebooklm con title, brief, steps[] (3–5) y benefits[] (3–5) basados en las noticias del día.\n' +
            '   Si NotebookLM no está disponible, usa create_infographic como fallback.\n' +
            '3) linkedin_propose_post con post_text en español + image_url = URL del PNG devuelto en el paso 2.\n' +
            '4) NO pares tras la infografía: debes llegar a linkedin_propose_post.\n' +
            '5) PROHIBIDO inventar noticias. PROHIBIDO schedule_task, save_agent_task ni cancel_scheduled_task.'
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
                const isInfographic = isDailyInfographicTask(task.instruction);
                const maxLen = isNews ? 3500 : isInfographic ? 2000 : 500;
                const short =
                    reply.length > maxLen ? `${reply.slice(0, maxLen - 1).trim()}…` : reply;
                const header = isNews
                    ? '📰 *Noticias IA*'
                    : isInfographic
                      ? '📊 *Infografía LinkedIn*'
                      : '🔔 *Recordatorio*';
                await deliverScheduledReply(task.chat_id, `${header}\n\n${short}`);
                await markScheduledTaskDone(task.id);
                if (task.repeat_interval) {
                    const nextMs = nextRepeatMs(task.run_at_ms, task.repeat_interval);
                    await insertScheduledTask(task.chat_id, task.instruction, nextMs, task.repeat_interval);
                    logger.info(`[scheduled] task ${task.id} rescheduled (${task.repeat_interval}) → ${new Date(nextMs).toISOString()}`);
                }
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
