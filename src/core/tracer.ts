import { logger } from './logger';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ToolSpan {
    tool_name: string;
    duration_ms: number;
    success: boolean;
    error?: string;
}

export interface TraceSession {
    trace_id: string;
    chat_id: string;
    user_message: string;
    started_at: number;
    duration_ms?: number;
    llm_calls: number;
    hallucination_retries: number;
    domain?: string;
    intent?: string;
    spans: ToolSpan[];
    completed: boolean;
}

interface ToolAggregate {
    calls: number;
    successes: number;
    failures: number;
    total_ms: number;
    last_error?: string;
}

// ── In-memory store ──────────────────────────────────────────────────────────

const MAX_SESSIONS = 200;
const sessions: TraceSession[] = [];
const toolAgg = new Map<string, ToolAggregate>();
// Active sessions indexed by traceId for O(1) lookup during recording
const activeById = new Map<string, TraceSession>();

// ── Session lifecycle ─────────────────────────────────────────────────────────

export function startTrace(traceId: string, chatId: string, userMessage: string): TraceSession {
    const session: TraceSession = {
        trace_id: traceId,
        chat_id: chatId,
        user_message: userMessage.slice(0, 200),
        started_at: Date.now(),
        llm_calls: 0,
        hallucination_retries: 0,
        spans: [],
        completed: false,
    };
    sessions.push(session);
    if (sessions.length > MAX_SESSIONS) sessions.shift();
    activeById.set(traceId, session);
    return session;
}

export function endTrace(traceId: string): void {
    const s = activeById.get(traceId);
    if (!s) return;
    s.completed = true;
    s.duration_ms = Date.now() - s.started_at;
    activeById.delete(traceId);
    logger.info(
        `[tracer] trace=${traceId} done in ${s.duration_ms}ms ` +
        `llm_calls=${s.llm_calls} tools=${s.spans.length} retries=${s.hallucination_retries}`
    );
}

export function getTrace(traceId: string): TraceSession | undefined {
    if (activeById.has(traceId)) return activeById.get(traceId);
    for (let i = sessions.length - 1; i >= 0; i--) {
        if (sessions[i].trace_id === traceId) return sessions[i];
    }
    return undefined;
}

// ── Tool recording ────────────────────────────────────────────────────────────

export function recordTool(
    traceId: string,
    toolName: string,
    durationMs: number,
    success: boolean,
    error?: string
): void {
    const s = activeById.get(traceId);
    if (s) {
        s.spans.push({ tool_name: toolName, duration_ms: durationMs, success, error });
    }

    const agg = toolAgg.get(toolName) ?? { calls: 0, successes: 0, failures: 0, total_ms: 0 };
    agg.calls++;
    agg.total_ms += durationMs;
    if (success) {
        agg.successes++;
    } else {
        agg.failures++;
        agg.last_error = error?.slice(0, 120);
    }
    toolAgg.set(toolName, agg);
}

// ── Counters ──────────────────────────────────────────────────────────────────

export function incLlmCalls(traceId: string): void {
    const s = activeById.get(traceId);
    if (s) s.llm_calls++;
}

export function incHallucinationRetries(traceId: string): void {
    const s = activeById.get(traceId);
    if (s) s.hallucination_retries++;
}

export function setDomain(traceId: string, domain: string): void {
    const s = activeById.get(traceId);
    if (s) s.domain = domain;
}

export function setIntent(traceId: string, intent: string): void {
    const s = activeById.get(traceId);
    if (s) s.intent = intent;
}

// ── Metrics report ────────────────────────────────────────────────────────────

export function getMetricsSummary(): string {
    if (toolAgg.size === 0) return 'Sin métricas todavía — aún no se han ejecutado tools.';

    const sorted = [...toolAgg.entries()].sort((a, b) => b[1].calls - a[1].calls);

    const lines: string[] = ['📊 *Métricas del agente (sesión actual)*\n'];

    // Session stats
    const completed = sessions.filter(s => s.completed);
    if (completed.length > 0) {
        const avgDuration = Math.round(completed.reduce((a, s) => a + (s.duration_ms ?? 0), 0) / completed.length);
        const totalLlm = completed.reduce((a, s) => a + s.llm_calls, 0);
        const totalRetries = completed.reduce((a, s) => a + s.hallucination_retries, 0);
        lines.push(`💬 Mensajes procesados: ${completed.length}`);
        lines.push(`⏱ Duración media: ${avgDuration}ms`);
        lines.push(`🧠 LLM calls totales: ${totalLlm}`);
        if (totalRetries > 0) lines.push(`⚠️ Alucinaciones corregidas: ${totalRetries}`);
        lines.push('');
    }

    lines.push('🔧 *Tools más usadas:*');
    for (const [name, agg] of sorted.slice(0, 15)) {
        const rate = agg.calls > 0 ? Math.round((agg.successes / agg.calls) * 100) : 0;
        const avg  = agg.calls > 0 ? Math.round(agg.total_ms / agg.calls) : 0;
        const icon = rate >= 90 ? '✅' : rate >= 70 ? '⚠️' : '❌';
        const errText = agg.last_error ? `\n    └ error: ${agg.last_error}` : '';
        lines.push(`${icon} \`${name}\` — ${agg.calls} calls · ${rate}% OK · ${avg}ms avg${errText}`);
    }

    // Slowest tools
    const slowest = [...toolAgg.entries()]
        .filter(([, a]) => a.calls > 0)
        .sort((a, b) => (b[1].total_ms / b[1].calls) - (a[1].total_ms / a[1].calls))
        .slice(0, 3);

    if (slowest.length > 0) {
        lines.push('\n🐢 *Más lentas (avg):*');
        for (const [name, agg] of slowest) {
            lines.push(`  • \`${name}\` — ${Math.round(agg.total_ms / agg.calls)}ms`);
        }
    }

    // Most failing
    const failing = [...toolAgg.entries()]
        .filter(([, a]) => a.failures > 0)
        .sort((a, b) => b[1].failures - a[1].failures)
        .slice(0, 3);

    if (failing.length > 0) {
        lines.push('\n❌ *Con más fallos:*');
        for (const [name, agg] of failing) {
            lines.push(`  • \`${name}\` — ${agg.failures} fallos`);
            if (agg.last_error) lines.push(`    └ ${agg.last_error}`);
        }
    }

    return lines.join('\n');
}

export function resetMetrics(): void {
    toolAgg.clear();
    sessions.length = 0;
    activeById.clear();
}
