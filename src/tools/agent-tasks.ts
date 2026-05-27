import { registerTool } from '../core/dispatcher';
import { getToolContext } from '../core/tool-context';
import { buildDuplicateReport, buildListAllPending, buildListDailyPending } from '../core/pending-format';
import { listPendingScheduledForChat } from '../core/memory';

const DEFAULT_WEBHOOK =
    'https://ziroxxn8n.ziroxn8n.site/webhook/agent-tareas-memoria';

type AgentTaskAction = 'save' | 'list' | 'complete' | 'delete';

type AgentTaskRow = {
    id: string | number;
    title: string;
    description?: string | null;
    status?: string;
    priority?: string;
    due_at?: string | null;
    created_at?: string;
    updated_at?: string;
};

type AgentTaskResponse = {
    success?: boolean;
    action?: string;
    message?: string;
    error?: string;
    count?: number;
    tasks?: AgentTaskRow[];
    task?: AgentTaskRow;
};

function webhookUrl(): string {
    return (process.env.N8N_AGENT_TASKS_WEBHOOK_URL ?? DEFAULT_WEBHOOK).trim();
}

function isEnabled(): boolean {
    const v = (process.env.N8N_AGENT_TASKS_ENABLED ?? 'true').toLowerCase();
    return v !== 'false' && v !== '0' && v !== 'no';
}

async function callAgentTasksMemory(payload: Record<string, unknown>): Promise<AgentTaskResponse> {
    if (!isEnabled()) {
        throw new Error(
            'Memoria de tareas n8n desactivada. Activa N8N_AGENT_TASKS_ENABLED=true y revisa N8N_AGENT_TASKS_WEBHOOK_URL.'
        );
    }

    const res = await fetch(webhookUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    const text = await res.text();
    let data: AgentTaskResponse = {};
    if (text.trim()) {
        try {
            data = JSON.parse(text) as AgentTaskResponse;
        } catch {
            throw new Error(`Respuesta inválida del webhook n8n (${res.status}): ${text.slice(0, 200)}`);
        }
    }

    if (!res.ok) {
        throw new Error(data.error ?? `Webhook n8n respondió HTTP ${res.status}`);
    }
    if (data.success === false) {
        throw new Error(data.error ?? data.message ?? 'Error en memoria de tareas');
    }
    return data;
}

function requireChatId(): string {
    const ctx = getToolContext();
    if (!ctx?.chatId) {
        throw new Error('Memoria de tareas requiere chat_id (Telegram o WhatsApp)');
    }
    return ctx.chatId;
}

function formatTaskLine(task: AgentTaskRow): string {
    const prio = task.priority && task.priority !== 'normal' ? ` [${task.priority}]` : '';
    const desc = task.description?.trim()
        ? `\n  ${task.description.trim().slice(0, 160)}${task.description.length > 160 ? '…' : ''}`
        : '';
    const due = task.due_at
        ? `\n  📅 ${new Date(task.due_at).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}`
        : '';
    return `• id ${task.id} — ${task.title}${prio}${desc}${due}`;
}

registerTool({
    name: 'save_agent_task',
    description:
        'Guarda una tarea pendiente de forma PERMANENTE (lista de cosas por hacer, ideas, pendientes). Úsala cuando el usuario diga "recuérdame que tengo que...", "apunta esta tarea", "añade a mi lista", "no olvides que debo...". NO uses esta tool para recordatorios con hora de ejecución automática — para eso usa schedule_task.',
    parameters: {
        type: 'object',
        properties: {
            title: { type: 'string', description: 'Título breve de la tarea' },
            description: { type: 'string', description: 'Detalle opcional' },
            priority: {
                type: 'string',
                enum: ['low', 'normal', 'high'],
                description: 'Prioridad (default: normal)',
            },
            due_at: {
                type: 'string',
                description: 'Fecha límite opcional en ISO 8601 con offset (ej. 2026-05-30T18:00:00+02:00)',
            },
        },
        required: ['title'],
    },
    handler: async (args) => {
        const chatId = requireChatId();
        const title = String((args as { title?: string }).title ?? '').trim();
        if (!title) throw new Error('title vacío');

        const data = await callAgentTasksMemory({
            action: 'save',
            chat_id: chatId,
            title,
            description: String((args as { description?: string }).description ?? '').trim(),
            priority: (args as { priority?: string }).priority ?? 'normal',
            due_at: (args as { due_at?: string }).due_at ?? null,
        });

        return data.message ?? `✅ Pendiente guardado: ${title}`;
    },
});

registerTool({
    name: 'list_agent_tasks',
    description:
        'Lista tareas pendientes guardadas de forma persistente en este chat (lista de cosas por hacer). Distinto de list_scheduled_tasks, que son recordatorios con hora de ejecución automática.',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: async () => {
        const chatId = requireChatId();
        const data = await callAgentTasksMemory({ action: 'list', chat_id: chatId });
        const tasks = data.tasks ?? [];
        if (tasks.length === 0) {
            return data.message ?? 'No tienes pendientes sin fecha guardados.';
        }
        return `📝 Pendientes sin fecha (${tasks.length}):\n\n${tasks.map(formatTaskLine).join('\n\n')}`;
    },
});

registerTool({
    name: 'complete_agent_task',
    description: 'Marca como hecha una tarea persistente por id (lista de pendientes, no recordatorios programados).',
    parameters: {
        type: 'object',
        properties: {
            task_id: { type: 'string', description: 'Id numérico de la tarea' },
        },
        required: ['task_id'],
    },
    handler: async (args) => {
        const chatId = requireChatId();
        const taskId = String((args as { task_id?: string }).task_id ?? '').trim();
        if (!taskId) throw new Error('task_id vacío');

        const data = await callAgentTasksMemory({
            action: 'complete' satisfies AgentTaskAction,
            chat_id: chatId,
            task_id: taskId,
        });
        return data.message ?? `Tarea ${taskId} completada.`;
    },
});

registerTool({
    name: 'cancel_agent_task',
    description: 'Cancela/elimina una tarea persistente por id (lista de pendientes, no recordatorios programados).',
    parameters: {
        type: 'object',
        properties: {
            task_id: { type: 'string', description: 'Id numérico de la tarea' },
        },
        required: ['task_id'],
    },
    handler: async (args) => {
        const chatId = requireChatId();
        const taskId = String((args as { task_id?: string }).task_id ?? '').trim();
        if (!taskId) throw new Error('task_id vacío');

        const data = await callAgentTasksMemory({
            action: 'delete' satisfies AgentTaskAction,
            chat_id: chatId,
            task_id: taskId,
        });
        return data.message ?? `Tarea ${taskId} cancelada.`;
    },
});

export async function loadPendingData(chatId: string): Promise<{
    scheduled: Awaited<ReturnType<typeof listPendingScheduledForChat>>;
    agentTasks: AgentTaskRow[];
}> {
    const [scheduled, agentData] = await Promise.all([
        listPendingScheduledForChat(chatId),
        callAgentTasksMemory({ action: 'list', chat_id: chatId }),
    ]);
    return { scheduled, agentTasks: agentData.tasks ?? [] };
}

registerTool({
    name: 'list_all_pending',
    description:
        'Lista TODOS los pendientes del usuario: programados (con fecha/hora) y sin fecha (backlog). Úsala cuando el usuario diga "lista mis pendientes", "qué tengo pendiente", "mis recordatorios", "qué hay en mi lista" o similar. Devuelve ambas listas unificadas en un solo bloque.',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: async () => {
        const ctx = getToolContext();
        if (!ctx?.chatId) throw new Error('list_all_pending requiere chat_id');
        const chatId = ctx.chatId;

        const { scheduled, agentTasks } = await loadPendingData(chatId);
        return buildListAllPending(scheduled, agentTasks);
    },
});
