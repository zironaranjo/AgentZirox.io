/** Preferencias de idioma/país para web_search (noticias y consultas en español). */

export function searchLocaleGl(): string {
    return (process.env.WEB_SEARCH_GL ?? 'es').trim().toLowerCase() || 'es';
}

export function searchLocaleHl(): string {
    return (process.env.WEB_SEARCH_HL ?? 'es').trim().toLowerCase() || 'es';
}

/** Medios tech en español para briefing de IA (configurable por env). */
const DEFAULT_ES_AI_NEWS_DOMAINS = [
    'xataka.com',
    'hipertextual.com',
    'genbeta.com',
    'computerhoy.com',
    'elpais.com',
    'abc.es',
    'lavanguardia.com',
    'elconfidencial.com',
];

export function spanishAiNewsDomains(): string[] {
    const raw = (process.env.WEB_SEARCH_ES_NEWS_DOMAINS ?? '').trim();
    if (!raw) return DEFAULT_ES_AI_NEWS_DOMAINS;
    return raw
        .split(/[,;\s]+/)
        .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, ''))
        .filter(Boolean);
}

/** Consulta base para noticias recientes de IA en español. */
export function spanishAiNewsQuery(): string {
    const custom = (process.env.WEB_SEARCH_AI_NEWS_QUERY ?? '').trim();
    if (custom) return custom;
    return 'noticias inteligencia artificial hoy España';
}

/** Consulta Serper/Google con filtro site: para medios en español. */
export function spanishAiNewsQueryWithDomains(domains = spanishAiNewsDomains()): string {
    const base = spanishAiNewsQuery();
    if (domains.length === 0) return base;
    const siteClause = domains.map((d) => `site:${d}`).join(' OR ');
    return `${base} (${siteClause})`;
}

export function isSpanishAiNewsSearch(query: string): boolean {
    return looksLikeAiTopic(query) && (looksLikeNewsQuery(query) || spanishAiNewsDomains().some((d) => query.includes(d)));
}

export function looksLikeNewsQuery(query: string): boolean {
    const q = query.toLowerCase();
    return /\b(noticias?|news|actualidad|últimas|ultimas|hoy|briefing|resumen\s+diario)\b/.test(q);
}

export function looksLikeAiTopic(query: string): boolean {
    const q = query.toLowerCase();
    return /\b(ia|ai|inteligencia\s+artificial|machine\s+learning|llm|chatgpt|openai|gemini|claude)\b/.test(q);
}

export function isAiNewsBriefing(text: string): boolean {
    const t = text.toLowerCase();
    const hasNews = /\b(noticias?|news|resumen\s+diario|briefing|actualidad)\b/.test(t);
    const hasAi = looksLikeAiTopic(t);
    const hasSearch = /\b(busca|buscar|consulta|investiga|env[ií]a|enviar|manda|cu[eé]nta|resum)\b/.test(t);
    return hasNews && hasAi && (hasSearch || /\bprogramad/.test(t) || t.includes('tarea programada'));
}

/** Tarea programada: infografía (NotebookLM/AntV) + publicar/proponer en LinkedIn. */
export function isDailyInfographicTask(text: string): boolean {
    const t = text.toLowerCase();
    const hasInfographic = /\binfograf/.test(t);
    const hasLinkedIn = /\blinkedin\b/.test(t) || /\bpublicar\b/.test(t);
    return hasInfographic && hasLinkedIn;
}
