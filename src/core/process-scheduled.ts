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

    const nowMs = Date.now();
    const released = releaseStuckRunningTasks(nowMs, 2 * 60 * 60 * 1000);
    if (released > 0) {
        logger.warn(`[scheduled] released ${released} stuck running task(s)`);
    }

    const errors: string[] = [];
    let processed = 0;

    for (let i = 0; i < 15; i++) {
        const task = claimNextDueScheduledTask(nowMs);
        if (!task) break;

        try {
            const prompt =
                `⏰ **Tarea programada**\n\n${task.instruction}\n\n` +
                `Cumple lo anterior ahora (búsqueda web, resumen, etc.). Sé concreto.`;
            const reply = await processMessage(task.chat_id, prompt);
            await sendTelegramChatMessage(task.chat_id, `🔔 *Recordatorio*\n\n${reply}`);
            markScheduledTaskDone(task.id);
            processed++;
            logger.info(`[scheduled] completed task ${task.id} for chat ${task.chat_id}`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`task ${task.id}: ${msg}`);
            logger.error(`[scheduled] task ${task.id} failed:`, err);
            markScheduledTaskFailed(task.id);
        }
    }

    return { status: 'ok', processed, errors };
}
