import { callLLMSimple } from './llm';
import { appendUserProfileNote, getMeta, getRecentMessagesAllChats, setMeta } from './memory';
import { logger } from './logger';

const META_LAST_DAY = 'self_improve_last_day';

function madridCalendarDay(d: Date): string {
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
}

function selfImproveEnabled(): boolean {
    const v = (process.env.SELF_IMPROVE_ENABLED ?? '').toLowerCase();
    return v === 'true' || v === '1' || v === 'yes';
}

function parseInsightLines(raw: string): string[] {
    const t = raw.trim();
    if (!t || /^nada\b/i.test(t)) return [];
    return t
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => /^-\s+/.test(l))
        .map((l) => l.replace(/^-\s+/, '').trim())
        .filter(Boolean)
        .slice(0, 6);
}

const EXTRACTOR_SYSTEM = `Eres un analista que extrae hechos duraderos para que un asistente personal mejore día a día.
Te llega una transcripción reciente (roles user y assistant).

Reglas:
- Devuelve como máximo 5 líneas; cada línea empieza exactamente con "- ".
- Incluye preferencias del usuario, correcciones que haya pedido, temas recurrentes, forma de trabajar o tono que quiera.
- No inventes. Si no hay nada útil que guardar, responde solo la palabra NADA (sin viñetas).
- No incluyas secretos, contraseñas, tokens, DNI, datos bancarios ni contenido muy privado.
- Sé breve en cada viñeta (una oración).`;

export type DailySelfImproveResult =
    | { status: 'disabled' }
    | { status: 'unauthorized' }
    | { status: 'already_run'; day: string }
    | { status: 'skipped_low_activity'; userMessages: number }
    | { status: 'ok'; day: string; insightsAdded: number; rawPreview?: string }
    | { status: 'error'; message: string };

/**
 * Ejecuta un ciclo de auto-mejora: resume conversación reciente y añade viñetas al perfil en SQLite.
 * Debe llamarse como máximo una vez por día (calendario Europe/Madrid); control por metadata.
 */
export async function runDailySelfImprove(authToken: string | null): Promise<DailySelfImproveResult> {
    const secret = (process.env.CRON_SECRET ?? process.env.SELF_IMPROVE_CRON_SECRET ?? '').trim();
    if (!selfImproveEnabled()) {
        return { status: 'disabled' };
    }
    if (!secret || authToken !== secret) {
        return { status: 'unauthorized' };
    }

    const today = madridCalendarDay(new Date());
    const last = await getMeta(META_LAST_DAY);
    if (last === today) {
        return { status: 'already_run', day: today };
    }

    const windowH = Math.min(Math.max(Number(process.env.SELF_IMPROVE_WINDOW_HOURS ?? 36) || 36, 6), 72);
    const minUser = Math.min(Math.max(Number(process.env.SELF_IMPROVE_MIN_USER_MESSAGES ?? 4) || 4, 2), 20);
    const maxRows = Math.min(Math.max(Number(process.env.SELF_IMPROVE_MAX_ROWS ?? 220) || 220, 50), 500);
    const maxChars = Math.min(Math.max(Number(process.env.SELF_IMPROVE_MAX_TRANSCRIPT_CHARS ?? 14000) || 14000, 2000), 32000);

    const since = Date.now() - windowH * 60 * 60 * 1000;
    const rows = (await getRecentMessagesAllChats(maxRows)).filter((r) => {
        const t = new Date(r.created_at).getTime();
        return t >= since;
    });

    const userCount = rows.filter((r) => r.role === 'user').length;
    if (userCount < minUser) {
        await setMeta(META_LAST_DAY, today);
        logger.info(`[self-improve] skipped low activity (${userCount} user msgs)`);
        return { status: 'skipped_low_activity', userMessages: userCount };
    }

    let transcript = rows
        .map((r) => `${r.role === 'user' ? 'Usuario' : 'Asistente'}: ${r.content}`)
        .join('\n');
    if (transcript.length > maxChars) {
        transcript = transcript.slice(transcript.length - maxChars);
    }

    try {
        const raw = await callLLMSimple(
            EXTRACTOR_SYSTEM,
            [{ role: 'user', content: `Transcripción:\n\n${transcript}` }],
            { temperature: 0.3, max_tokens: 700 }
        );

        const insights = parseInsightLines(raw);
        if (insights.length === 0) {
            await setMeta(META_LAST_DAY, today);
            logger.info('[self-improve] no insights (NADA o vacío)');
            return { status: 'ok', day: today, insightsAdded: 0, rawPreview: raw.slice(0, 200) };
        }

        for (const line of insights) {
            await appendUserProfileNote(`[auto ${today}] ${line}`);
        }
        await setMeta(META_LAST_DAY, today);
        logger.info(`[self-improve] added ${insights.length} insight(s) for ${today}`);
        return { status: 'ok', day: today, insightsAdded: insights.length };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('[self-improve] LLM error:', err);
        return { status: 'error', message };
    }
}
