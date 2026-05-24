/** Detecta si el mensaje del usuario exige persistir o programar una tarea real. */
export function requiresTaskAction(msg: string): 'schedule' | 'save' | null {
    const t = msg.toLowerCase();

    const hasTime =
        /\b(mañana|manana|pasado mañana|pasado manana|hoy|esta noche|esta tarde|este mediod[ií]a)\b/.test(t) ||
        /\ben\s+\d+\s*(minutos?|mins?|horas?|h)\b/.test(t) ||
        /\ba\s+las\s+\d/.test(t) ||
        /\d{1,2}:\d{2}/.test(t) ||
        /\b\d{1,2}\s*(am|pm|h)\b/.test(t) ||
        /\bde la mañana\b|\bde la tarde\b|\bde la noche\b|\ba mediod[ií]a\b/.test(t);

    const hasReminderVerb =
        /\b(recu[eé]rdame|recuerda que|ap[uú]ntame|apunta|programa|agenda|av[ií]same|recordatorio)\b/.test(t);

    if (hasReminderVerb && hasTime) return 'schedule';
    if (hasReminderVerb) return 'save';
    if (/\b(ap[uú]ntame|mi lista de tareas|tarea pendiente|no olvides que)\b/.test(t)) return 'save';
    return null;
}

/** Respuesta del LLM que afirma haber programado/guardado sin haber llamado tools. */
export function detectTaskHallucination(
    userMessage: string,
    content: string,
    executedToolNames: string[]
): boolean {
    const required = requiresTaskAction(userMessage);
    if (!required) return false;

    if (required === 'schedule' && executedToolNames.includes('schedule_task')) return false;
    if (
        required === 'save' &&
        (executedToolNames.includes('save_agent_task') || executedToolNames.includes('schedule_task'))
    ) {
        return false;
    }

    const lower = content.toLowerCase();
    const claimsDone =
        /\b(programad[oa]|agendad[oa]|apuntad[oa]|guardad[oa]|recordator(?:io)?\s+(?:creado|guardado|programado)|tarea ha sido|ha sido programad|ya est[aá] programad|correctamente)\b/.test(
            lower
        );
    const claimsId = /\b(?:id|ID)\s*#?\s*\d+\b/.test(content);
  const claimsExisting =
        /\b(mismo id|ya exist[ií]a|estaba previamente|en mi lista de tareas)\b/.test(lower);

    return claimsDone || claimsId || claimsExisting;
}

export function taskActionRetryHint(userMessage: string): string {
    const required = requiresTaskAction(userMessage);
    if (required === 'schedule') {
        return 'El usuario pidió un recordatorio CON HORA. DEBES llamar schedule_task AHORA con instruction clara y run_at_iso en ISO 8601 (Europa/Madrid, offset +01:00 o +02:00). PROHIBIDO inventar IDs o decir que ya está programado sin tool_calls.';
    }
    return 'El usuario pidió guardar una tarea pendiente. DEBES llamar save_agent_task AHORA (o schedule_task si incluye hora concreta). PROHIBIDO inventar IDs o afirmar que guardaste algo sin tool_calls.';
}
