import { registerTool } from '../core/dispatcher';

function extractText(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<head[\s\S]*?<\/head>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/\s+/g, ' ')
        .trim();
}

async function fetchWithFirecrawl(url: string, maxChars: number): Promise<string> {
    const { default: FirecrawlApp } = await import('@mendable/firecrawl-js');
    const app = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY! });
    const raw = (await app.scrapeUrl(url, { formats: ['markdown'] })) as unknown;
    const result = raw as {
        success?: boolean;
        error?: string;
        markdown?: string;
        metadata?: { title?: string };
        data?: { markdown?: string; metadata?: { title?: string } };
    };

    // Compatibilidad con versiones viejas y nuevas del SDK.
    if (result.success === false) {
        throw new Error(result.error ?? 'Firecrawl: error desconocido');
    }

    const md = result.markdown ?? result.data?.markdown ?? '';
    if (!md) {
        throw new Error(result.error ?? 'Firecrawl no devolvió markdown');
    }
    const title = result.metadata?.title ?? result.data?.metadata?.title;
    const header = title ? `# ${title}\n\n` : '';
    const content = `${header}${md}`;
    return content.length > maxChars
        ? `${content.slice(0, maxChars)}…\n\n_(truncado — ${content.length} chars totales)_`
        : content;
}

async function fetchWithBasic(url: string, maxChars: number): Promise<string> {
    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; AgenteZirox/1.0)',
            Accept: 'text/html,application/xhtml+xml,*/*',
        },
        redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} al acceder a ${url}`);

    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
        const json = await res.text();
        return `📄 JSON de ${url}:\n\n${json.slice(0, maxChars)}`;
    }

    const html = await res.text();
    const text = extractText(html);
    return text.length > maxChars
        ? `${text.slice(0, maxChars)}…\n\n_(truncado — ${text.length} chars totales)_`
        : text;
}

registerTool({
    name: 'fetch_url',
    description:
        'Abre una URL y devuelve el contenido legible (artículo, blog, noticia, documentación). Usar cuando el usuario comparta un enlace y pida leerlo, resumirlo o analizarlo.',
    parameters: {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'URL completa a leer (https://...)' },
            max_chars: {
                type: 'string',
                description: 'Máximo de caracteres a devolver (default 4000, max 8000)',
            },
        },
        required: ['url'],
    },
    handler: async (args) => {
        const url = String(args.url ?? '').trim();
        const maxChars = Math.min(Number(args.max_chars ?? 4000), 8000);
        if (!url.startsWith('http')) throw new Error('URL debe empezar por http:// o https://');

        const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
        try {
            const content = apiKey
                ? await fetchWithFirecrawl(url, maxChars)
                : await fetchWithBasic(url, maxChars);
            return `📄 Contenido de ${url}:\n\n${content}`;
        } catch (err) {
            if (apiKey) {
                // Firecrawl falló → fallback a fetch básico
                const content = await fetchWithBasic(url, maxChars);
                return `📄 Contenido de ${url}:\n\n${content}`;
            }
            throw err;
        }
    },
});
