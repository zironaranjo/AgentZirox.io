import type { ScheduledTaskRow } from './memory';
import { isDailyInfographicTask } from './search-locale';

type AgentTaskRow = {
    id: string | number;
    title: string;
    description?: string | null;
};

function normalizeText(s: string): string {
    return s
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function formatScheduledLine(r: ScheduledTaskRow): string {
    const when = new Date(r.run_at_ms).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
    const repeat = r.repeat_interval ? ` 🔁 ${r.repeat_interval}` : '';
    const text = r.instruction.slice(0, 120) + (r.instruction.length > 120 ? '…' : '');
    return `• id ${r.id}${repeat} — 🕐 ${when}\n  ${text}`;
}

function formatAgentLine(t: AgentTaskRow): string {
    const desc = t.description?.trim()
        ? `\n  ${t.description.trim().slice(0, 160)}${t.description.length > 160 ? '…' : ''}`
        : '';
    return `• id ${t.id} — ${t.title}${desc}`;
}

export function isDailyScheduledTask(r: ScheduledTaskRow): boolean {
    if (r.repeat_interval === 'daily') return true;
    if (isDailyInfographicTask(r.instruction)) return true;
    const t = r.instruction.toLowerCase();
    return (
        /\b(cada\s+d[ií]a|diari[ao]|todos\s+los\s+d[ií]as)\b/.test(t) ||
        /\binfograf[ií]a\s+diaria\b/.test(t)
    );
}

export function buildListAllPending(scheduled: ScheduledTaskRow[], agentTasks: AgentTaskRow[]): string {
    const parts: string[] = [];

    if (scheduled.length > 0) {
        parts.push(
            `📅 Pendientes programados (${scheduled.length}):\n\n${scheduled.map(formatScheduledLine).join('\n\n')}`
        );
    } else {
        parts.push('📅 No tienes pendientes programados.');
    }

    if (agentTasks.length > 0) {
        parts.push(`📝 Pendientes sin fecha (${agentTasks.length}):\n\n${agentTasks.map(formatAgentLine).join('\n\n')}`);
    } else {
        parts.push('📝 No tienes pendientes sin fecha.');
    }

    return parts.join('\n\n---\n\n');
}

export function buildListDailyPending(scheduled: ScheduledTaskRow[]): string {
    const daily = scheduled.filter(isDailyScheduledTask);
    const other = scheduled.filter((r) => !isDailyScheduledTask(r));

    if (daily.length === 0) {
        const parts = ['📅 No hay tareas marcadas como diarias (🔁 daily o texto "cada día").'];
        if (other.length > 0) {
            parts.push(
                `\nTareas programadas puntuales (${other.length}):\n\n${other.map(formatScheduledLine).join('\n\n')}`
            );
        }
        return parts.join('\n');
    }

    const lines = daily.map(formatScheduledLine).join('\n\n');
    let out = `📅 Tareas diarias (${daily.length}):\n\n${lines}`;
    if (other.length > 0) {
        out += `\n\n---\n\n📌 Otras programadas (no diarias): ${other.length}\n\n${other.map(formatScheduledLine).join('\n\n')}`;
    }
    return out;
}

function tokenSet(s: string): Set<string> {
    return new Set(normalizeText(s).split(' ').filter((w) => w.length > 2));
}

function similarEnough(a: string, b: string): boolean {
    const na = normalizeText(a);
    const nb = normalizeText(b);
    if (na === nb) return true;
    if (na.includes(nb) || nb.includes(na)) return true;
    const ta = tokenSet(a);
    const tb = tokenSet(b);
    if (ta.size === 0 || tb.size === 0) return false;
    let inter = 0;
    for (const w of ta) if (tb.has(w)) inter++;
    const ratio = inter / Math.min(ta.size, tb.size);
    return ratio >= 0.65;
}

export function buildDuplicateReport(scheduled: ScheduledTaskRow[], agentTasks: AgentTaskRow[]): string {
    const groups: string[] = [];

    // Misma instrucción (normalizada)
    const byNorm = new Map<string, ScheduledTaskRow[]>();
    for (const r of scheduled) {
        const key = normalizeText(r.instruction);
        if (!key) continue;
        const list = byNorm.get(key) ?? [];
        list.push(r);
        byNorm.set(key, list);
    }
    for (const [, rows] of byNorm) {
        if (rows.length > 1) {
            const ids = rows.map((r) => r.id).join(', ');
            groups.push(`• Misma instrucción — ids ${ids}\n  "${rows[0].instruction.slice(0, 100)}…"`);
        }
    }

    // Misma hora (±2 min)
    for (let i = 0; i < scheduled.length; i++) {
        for (let j = i + 1; j < scheduled.length; j++) {
            const a = scheduled[i];
            const b = scheduled[j];
            if (Math.abs(a.run_at_ms - b.run_at_ms) <= 2 * 60 * 1000 && similarEnough(a.instruction, b.instruction)) {
                groups.push(`• Misma hora e tema similar — ids ${a.id}, ${b.id}`);
            }
        }
    }

    // Instrucciones parecidas (distintas horas)
    for (let i = 0; i < scheduled.length; i++) {
        for (let j = i + 1; j < scheduled.length; j++) {
            const a = scheduled[i];
            const b = scheduled[j];
            if (a.id === b.id) continue;
            if (normalizeText(a.instruction) === normalizeText(b.instruction)) continue;
            if (similarEnough(a.instruction, b.instruction)) {
                groups.push(`• Instrucciones parecidas — ids ${a.id}, ${b.id}`);
            }
        }
    }

    // Pendientes sin fecha duplicados por título
    const byTitle = new Map<string, AgentTaskRow[]>();
    for (const t of agentTasks) {
        const key = normalizeText(t.title);
        if (!key) continue;
        const list = byTitle.get(key) ?? [];
        list.push(t);
        byTitle.set(key, list);
    }
    for (const [, rows] of byTitle) {
        if (rows.length > 1) {
            const ids = rows.map((r) => r.id).join(', ');
            groups.push(`• Mismo título en backlog — ids ${ids}\n  "${rows[0].title}"`);
        }
    }

    if (groups.length === 0) {
        return [
            '✅ No veo duplicados claros entre tus pendientes.',
            '',
            `Revisadas: ${scheduled.length} programada(s), ${agentTasks.length} sin fecha.`,
            'Para ver todo: "lista pendientes". Para cancelar: "cancela la tarea #ID".',
        ].join('\n');
    }

    const unique = [...new Set(groups)];
    return [
        `⚠️ Posibles duplicados (${unique.length}):`,
        '',
        unique.join('\n\n'),
        '',
        'Para cancelar: "cancela la tarea #ID" (programadas) o cancel_agent_task con el id del backlog.',
    ].join('\n');
}
