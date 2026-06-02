import { registerTool } from '../core/dispatcher';

const APIFY_BASE = 'https://api.apify.com/v2';

function getToken(): string {
    const token = process.env.APIFY_API_KEY;
    if (!token) throw new Error('APIFY_API_KEY no configurado en Dokploy');
    return token;
}

async function startRun(actorId: string, input: Record<string, unknown>, token: string): Promise<string> {
    const res = await fetch(`${APIFY_BASE}/acts/${encodeURIComponent(actorId)}/runs?token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`Apify start failed (${res.status}): ${await res.text()}`);
    const data = await res.json() as { data: { id: string } };
    return data.data.id;
}

async function pollRun(runId: string, token: string, maxWaitMs: number): Promise<string> {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
        const res = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${token}`);
        const data = await res.json() as { data: { status: string; defaultDatasetId: string } };
        const { status, defaultDatasetId } = data.data;
        if (status === 'SUCCEEDED') return defaultDatasetId;
        if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
            throw new Error(`Actor run ${status}`);
        }
        await new Promise(r => setTimeout(r, 3000));
    }
    throw new Error('Actor run no terminó en el tiempo límite');
}

async function fetchItems(datasetId: string, token: string, limit: number): Promise<unknown[]> {
    const res = await fetch(`${APIFY_BASE}/datasets/${datasetId}/items?token=${token}&limit=${limit}&clean=true`);
    if (!res.ok) throw new Error(`Dataset fetch failed (${res.status})`);
    return res.json() as Promise<unknown[]>;
}

function formatItems(items: unknown[], maxChars = 4000): string {
    const lines: string[] = [];
    let total = 0;
    for (const item of items) {
        const line = typeof item === 'string' ? item : JSON.stringify(item, null, 2);
        if (total + line.length > maxChars) break;
        lines.push(line);
        total += line.length;
    }
    return lines.join('\n\n');
}

// ── apify_run_actor ────────────────────────────────────────────────────────────

registerTool({
    name: 'apify_run_actor',
    description: 'Ejecuta cualquier actor de Apify con el input dado y devuelve los resultados del dataset. Útil para scrapers especializados de LinkedIn, Instagram, Amazon, etc.',
    parameters: {
        type: 'object',
        properties: {
            actor_id: {
                type: 'string',
                description: 'ID del actor de Apify (ej: "apify/google-search-scraper", "curious_coder/linkedin-scraper")',
            },
            input: {
                type: 'string',
                description: 'JSON string con el input del actor según su documentación',
            },
            max_items: {
                type: 'string',
                description: 'Máximo de resultados a devolver (default: 10)',
            },
        },
        required: ['actor_id', 'input'],
    },
    timeoutMs: 120_000,
    handler: async (args) => {
        const actorId = String(args.actor_id ?? '').trim();
        const maxItems = Math.min(Math.max(parseInt(String(args.max_items ?? '10'), 10) || 10, 1), 50);

        let input: Record<string, unknown>;
        try {
            input = JSON.parse(String(args.input ?? '{}'));
        } catch {
            throw new Error('El parámetro "input" debe ser un JSON válido');
        }

        const token = getToken();
        const runId = await startRun(actorId, input, token);
        const datasetId = await pollRun(runId, token, 100_000);
        const items = await fetchItems(datasetId, token, maxItems);

        if (items.length === 0) return '✅ Actor completado pero sin resultados en el dataset.';

        return `✅ Apify \`${actorId}\` — ${items.length} resultado(s):\n\n${formatItems(items)}`;
    },
});

// ── apify_google_search ────────────────────────────────────────────────────────

registerTool({
    name: 'apify_google_search',
    description: 'Busca en Google vía Apify y devuelve resultados estructurados (título, URL, snippet, featured snippet, imágenes). Más completo que web_search básico.',
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Consulta de búsqueda',
            },
            num_results: {
                type: 'string',
                description: 'Número de resultados por página (default: 10, max: 100)',
            },
            country: {
                type: 'string',
                description: 'Código de país para localizar resultados (default: "es")',
            },
            language: {
                type: 'string',
                description: 'Código de idioma (default: "es")',
            },
        },
        required: ['query'],
    },
    timeoutMs: 90_000,
    handler: async (args) => {
        const query = String(args.query ?? '').trim();
        const numResults = Math.min(Math.max(parseInt(String(args.num_results ?? '10'), 10) || 10, 1), 100);
        const country = String(args.country ?? 'es').trim();
        const language = String(args.language ?? 'es').trim();

        if (!query) throw new Error('"query" es obligatorio');

        const token = getToken();
        const input = {
            queries: query,
            maxPagesPerQuery: 1,
            resultsPerPage: numResults,
            countryCode: country,
            languageCode: language,
            saveHtml: false,
            saveHtmlToKeyValueStore: false,
        };

        const runId = await startRun('apify/google-search-scraper', input, token);
        const datasetId = await pollRun(runId, token, 80_000);
        const items = await fetchItems(datasetId, token, 1);

        if (items.length === 0) return '✅ Búsqueda completada sin resultados.';

        const page = items[0] as Record<string, unknown>;
        const lines: string[] = [`🔍 Google via Apify — "${query}"\n`];

        if (page.featuredSnippet) {
            const fs = page.featuredSnippet as Record<string, unknown>;
            lines.push(`📌 Featured snippet: ${fs.description ?? ''}\n   ${fs.url ?? ''}\n`);
        }

        const organicResults = (page.organicResults as Array<Record<string, unknown>> | undefined) ?? [];
        organicResults.slice(0, numResults).forEach((r, i) => {
            lines.push(`${i + 1}. **${r.title ?? ''}**\n   ${r.url ?? ''}\n   ${String(r.description ?? '').slice(0, 300)}`);
        });

        return lines.join('\n');
    },
});

// ── apify_scrape_url ───────────────────────────────────────────────────────────

registerTool({
    name: 'apify_scrape_url',
    description: 'Extrae el contenido de una URL con rendering JavaScript completo (Playwright). Ideal para SPAs, webs dinámicas, e-commerce o cualquier página que fetch_url no pueda leer correctamente.',
    parameters: {
        type: 'object',
        properties: {
            url: {
                type: 'string',
                description: 'URL a scrapear (debe empezar con https://)',
            },
            max_chars: {
                type: 'string',
                description: 'Máximo de caracteres de texto a devolver (default: 5000)',
            },
        },
        required: ['url'],
    },
    timeoutMs: 90_000,
    handler: async (args) => {
        const url = String(args.url ?? '').trim();
        const maxChars = Math.min(Math.max(parseInt(String(args.max_chars ?? '5000'), 10) || 5000, 500), 15000);

        if (!url.startsWith('http')) throw new Error('La URL debe empezar con http:// o https://');

        const token = getToken();
        const input = {
            startUrls: [{ url }],
            maxCrawlPages: 1,
            crawlerType: 'playwright:firefox',
            maxCrawlDepth: 0,
            htmlTransformer: 'readableText',
            readableTextCharThreshold: 100,
            maxResultSize: maxChars,
            saveHtml: false,
            saveMarkdown: true,
        };

        const runId = await startRun('apify/website-content-crawler', input, token);
        const datasetId = await pollRun(runId, token, 80_000);
        const items = await fetchItems(datasetId, token, 1);

        if (items.length === 0) return '✅ Scraping completado pero sin contenido extraído.';

        const page = items[0] as Record<string, unknown>;
        const content = String(page.markdown ?? page.text ?? page.content ?? JSON.stringify(page)).slice(0, maxChars);
        const title = page.metadata ? (page.metadata as Record<string, unknown>).title ?? '' : '';

        return `🕷️ **${title || url}**\n🔗 ${url}\n\n${content}`;
    },
});
