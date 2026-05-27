import { registerTool } from '../core/dispatcher';
import {
    isSpanishAiNewsSearch,
    looksLikeAiTopic,
    looksLikeNewsQuery,
    searchLocaleGl,
    searchLocaleHl,
    spanishAiNewsDomains,
    spanishAiNewsQuery,
    spanishAiNewsQueryWithDomains,
} from '../core/search-locale';

interface SerperOrganic {
    title?: string;
    link?: string;
    snippet?: string;
}

function truncate(s: string, max: number): string {
    const t = s.trim();
    return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

async function searchSerper(
    query: string,
    limit: number,
    opts?: { news?: boolean; includeDomains?: string[] }
): Promise<string | null> {
    const key = process.env.SERPER_API_KEY;
    if (!key) return null;

    const endpoint = opts?.news ? 'https://google.serper.dev/news' : 'https://google.serper.dev/search';
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'X-API-KEY': key,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            q: query,
            num: Math.min(limit, 10),
            gl: searchLocaleGl(),
            hl: searchLocaleHl(),
        }),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Serper error (${res.status}): ${err}`);
    }

    const data = (await res.json()) as { organic?: SerperOrganic[]; answerBox?: { answer?: string; snippet?: string } };
    const lines: string[] = [];

    if (data.answerBox?.answer) {
        lines.push(`📌 Respuesta directa: ${data.answerBox.answer}`);
    } else if (data.answerBox?.snippet) {
        lines.push(`📌 ${data.answerBox.snippet}`);
    }

    const organic = data.organic ?? [];
    if (organic.length === 0 && lines.length === 0) {
        return opts?.news
            ? 'Sin resultados de noticias en Serper para esta consulta.'
            : 'Sin resultados organicos en Serper para esta consulta.';
    }

    organic.slice(0, limit).forEach((r, i) => {
        const title = r.title ?? '(sin titulo)';
        const link = r.link ?? '';
        const snip = r.snippet ? truncate(r.snippet, 280) : '';
        lines.push(`${i + 1}. **${title}**\n   ${link}\n   ${snip}`);
    });

    return lines.join('\n\n');
}

async function searchTavily(
    query: string,
    limit: number,
    opts?: { news?: boolean; includeDomains?: string[] }
): Promise<string | null> {
    const key = process.env.TAVILY_API_KEY;
    if (!key) return null;

    const body: Record<string, unknown> = {
        api_key: key,
        query,
        max_results: Math.min(limit, 10),
        search_depth: 'basic',
    };
    if (opts?.news) {
        body.topic = 'news';
        body.time_range = 'day';
    } else {
        body.topic = 'general';
        body.country = searchLocaleGl();
    }
    if (opts?.includeDomains?.length) {
        body.include_domains = opts.includeDomains.slice(0, 20);
    }

    const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Tavily error (${res.status}): ${err}`);
    }

    const data = (await res.json()) as {
        answer?: string;
        results?: Array<{ title?: string; url?: string; content?: string }>;
    };

    const lines: string[] = [];
    if (data.answer) {
        lines.push(`📌 Resumen: ${data.answer}`);
    }

    const results = data.results ?? [];
    results.slice(0, limit).forEach((r, i) => {
        const title = r.title ?? '(sin titulo)';
        const url = r.url ?? '';
        const content = r.content ? truncate(r.content, 280) : '';
        lines.push(`${i + 1}. **${title}**\n   ${url}\n   ${content}`);
    });

    return lines.length > 0 ? lines.join('\n\n') : 'Sin resultados en Tavily.';
}

async function searchDuckDuckGoInstant(query: string): Promise<string | null> {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'AgenteZirox/1.0' },
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
        AbstractText?: string;
        AbstractURL?: string;
        Answer?: string;
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string } | { Topics?: unknown[] }>;
    };

    const lines: string[] = [];
    if (data.Answer) lines.push(`📌 ${data.Answer}`);
    if (data.AbstractText) {
        lines.push(`${truncate(data.AbstractText, 600)}`);
        if (data.AbstractURL) lines.push(`🔗 ${data.AbstractURL}`);
    }

    const topics = data.RelatedTopics ?? [];
    for (const t of topics) {
        if (typeof t === 'object' && t && 'Text' in t && t.Text) {
            lines.push(`• ${truncate(t.Text, 200)}`);
            if (lines.length >= 8) break;
        }
    }

    if (lines.length === 0) return null;
    return lines.join('\n');
}

registerTool({
    name: 'web_search',
    description:
        'Buscar informacion actual en internet (contactos, empresas, noticias, datos publicos). Noticias de IA: consultas en ESPAÑOL y fuentes xataka.com, hipertextual.com, genbeta.com, elpais.com, etc.',
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Consulta de busqueda en lenguaje natural, preferiblemente en el idioma del usuario',
            },
            limit: {
                type: 'string',
                description: 'Numero maximo de resultados (default 5, max 10)',
            },
        },
        required: ['query'],
    },
    handler: async (args) => {
        const query = String(args.query ?? '').trim();
        const parsed = Number(args.limit ?? 5);
        const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 10) : 5;

        if (!query) throw new Error('query es obligatorio');

        const wantsNews = looksLikeNewsQuery(query) || looksLikeAiTopic(query);
        const esAiNews = isSpanishAiNewsSearch(query) || (wantsNews && looksLikeAiTopic(query));
        const domains = esAiNews ? spanishAiNewsDomains() : [];

        let effectiveQuery = query;
        if (esAiNews) {
            effectiveQuery = spanishAiNewsQueryWithDomains(domains);
        } else if (wantsNews && looksLikeAiTopic(query) && !/\b(españa|español|spanish|hoy)\b/i.test(query)) {
            effectiveQuery = spanishAiNewsQuery();
        }

        const searchOpts = { news: wantsNews, includeDomains: domains.length ? domains : undefined };

        try {
            let serper = await searchSerper(effectiveQuery, limit, searchOpts);
            if (serper && /sin resultados/i.test(serper) && domains.length > 0) {
                serper = await searchSerper(spanishAiNewsQuery(), limit, { news: wantsNews });
            }
            if (serper && !/sin resultados/i.test(serper)) {
                const label = wantsNews ? 'Serper Noticias' : 'Serper';
                const srcHint = domains.length ? ` · medios ES: ${domains.slice(0, 4).join(', ')}…` : '';
                return `🌐 Resultados (${label}, es/${searchLocaleGl()}${srcHint}):\n\n${serper}`;
            }

            let tavily = await searchTavily(effectiveQuery, limit, searchOpts);
            if (tavily && /sin resultados/i.test(tavily) && domains.length > 0) {
                tavily = await searchTavily(spanishAiNewsQuery(), limit, { news: wantsNews });
            }
            if (tavily && !/sin resultados/i.test(tavily)) {
                const label = wantsNews ? 'Tavily Noticias' : 'Tavily';
                return `🌐 Resultados (${label}):\n\n${tavily}`;
            }

            const ddg = await searchDuckDuckGoInstant(query);
            if (ddg) {
                return `🌐 Resultados (DuckDuckGo, limitado):\n\n${ddg}\n\n_Nota: para mejores resultados configura SERPER_API_KEY o TAVILY_API_KEY en el servidor._`;
            }

            return [
                'No hay motor de busqueda configurado o DuckDuckGo no devolvio datos utiles.',
                '',
                'Configura en Dokploy una de estas variables:',
                '- SERPER_API_KEY (recomendado, https://serper.dev)',
                '- TAVILY_API_KEY (https://tavily.com)',
                '',
                `Consulta original: ${query}`,
            ].join('\n');
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return `❌ Error en web_search: ${msg}`;
        }
    },
});
