import { processMessage } from './agent';
import {
    claimNextDueScheduledTask,
    markScheduledTaskDone,
    markScheduledTaskFailed,
    releaseStuckRunningTasks,
} from './memory';
import { sendTelegramChatMessage } from '../integrations/telegram/send-message';
import { logger } from './logger';

function scheduledTasksEnabled(): boolean {
    const v = (process.env.SCHEDULED_TASKS_ENABLED ?? '').toLowerCase();
    return v === 'true' || v === '1' || v === 'yes';
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
                const prompt =
                    `⏰ **Tarea programada**\n\n${task.instruction}\n\n` +
                    `Cumple lo anterior ahora (búsqueda web, resumen, etc.). Sé concreto.`;
                const reply = await processMessage(task.chat_id, prompt);
                await sendTelegramChatMessage(task.chat_id, `🔔 *Recordatorio*\n\n${reply}`);
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
