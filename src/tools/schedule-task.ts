import { registerTool } from '../core/dispatcher';
import { getToolContext } from '../core/tool-context';
import {
    cancelScheduledTaskForChat,
    insertScheduledTask,
    listPendingScheduledForChat,
} from '../core/memory';

function parseRunAtMs(runAtIso: string): number {
    const ms = Date.parse(runAtIso.trim());
    if (!Number.isFinite(ms)) {
        throw new Error('run_at_iso no es una fecha válida (usa ISO 8601 con zona, ej. 2026-04-23T08:00:00+02:00)');
    }
    return ms;
}

registerTool({
    name: 'schedule_task',
    description:
        'Programa una acción futura en ESTE chat (Telegram o WhatsApp). OBLIGATORIO si el usuario pide un recordatorio, aviso o tarea a una hora/fecha concreta (mañana a las 8, en 30 minutos, etc.). Sin llamar a esta tool, nada se ejecutará solo: no basta con prometerlo en texto. Calcula run_at_iso en Europa/Madrid con offset correcto (+01:00 o +02:00 según DST).',
    parameters: {
        type: 'object',
        properties: {
            instruction: {
                type: 'string',
                description:
                    'Qué debe hacer el agente cuando llegue la hora, redactado de forma autosuficiente (ej. buscar 3 noticias de IA y resumirlas).',
            },
            run_at_iso: {
                type: 'string',
                description:
                    'Momento de ejecución en ISO 8601 con offset explícito de España, ej. 2026-04-23T08:00:00+02:00',
            },
        },
        required: ['instruction', 'run_at_iso'],
    },
    handler: async (args) => {
        const ctx = getToolContext();
        if (!ctx?.chatId) {
            throw new Error('schedule_task requiere un chat_id (Telegram o WhatsApp)');
        }
        const instruction = String((args as { instruction?: string }).instruction ?? '').trim();
        const runAtIso = String((args as { run_at_iso?: string }).run_at_iso ?? '').trim();
        if (!instruction) throw new Error('instruction vacío');

        const runAtMs = parseRunAtMs(runAtIso);
        const minAhead = 60_000;
        if (runAtMs < Date.now() + minAhead) {
            const nowIso = new Date().toISOString();
            throw new Error(
                `La fecha debe ser al menos ~1 minuto en el futuro. Hora actual del servidor (UTC): ${nowIso}. Usa esa hora como base y suma los minutos necesarios.`
            );
        }

        const id = await insertScheduledTask(ctx.chatId, instruction, runAtMs);
        const when = new Date(runAtMs).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
        return [
            '✅ Tarea programada.',
            `🆔 id: ${id}`,
            `🕐 Ejecución (Madrid): ${when}`,
            '',
            'Asegúrate de que en el servidor estén SCHEDULED_TASKS_ENABLED=true y un cron cada 1–2 min a /api/cron/scheduled-tasks con el mismo secreto que el resto de crons.',
        ].join('\n');
    },
});

registerTool({
    name: 'list_scheduled_tasks',
    description: 'Lista tareas pendientes programadas para este chat.',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: async () => {
        const ctx = getToolContext();
        if (!ctx?.chatId) throw new Error('list_scheduled_tasks requiere chat_id (Telegram o WhatsApp)');
        const rows = await listPendingScheduledForChat(ctx.chatId);
        if (rows.length === 0) return 'No hay tareas pendientes en este chat.';
        const lines = rows.map((r) => {
            const when = new Date(r.run_at_ms).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
            return `• id ${r.id} — ${when}\n  ${r.instruction.slice(0, 120)}${r.instruction.length > 120 ? '…' : ''}`;
        });
        return `📋 Tareas pendientes:\n\n${lines.join('\n\n')}`;
    },
});

registerTool({
    name: 'cancel_scheduled_task',
    description: 'Cancela una tarea pendiente por id (el usuario puede decir "cancela el recordatorio 3").',
    parameters: {
        type: 'object',
        properties: {
            task_id: { type: 'string', description: 'Identificador numérico devuelto al programar' },
        },
        required: ['task_id'],
    },
    handler: async (args) => {
        const ctx = getToolContext();
        if (!ctx?.chatId) throw new Error('cancel_scheduled_task requiere chat_id (Telegram o WhatsApp)');
        const id = Number((args as { task_id?: string }).task_id);
        if (!Number.isFinite(id)) throw new Error('task_id inválido');
        const ok = await cancelScheduledTaskForChat(ctx.chatId, id);
        return ok ? `✅ Tarea ${id} cancelada.` : `No se encontró la tarea ${id} pendiente en este chat.`;
    },
});
