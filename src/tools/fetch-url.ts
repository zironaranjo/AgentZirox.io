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
        const preview =
            text.length > maxChars
                ? `${text.slice(0, maxChars)}…\n\n_(truncado — ${text.length} chars totales)_`
                : text;

        return `📄 Contenido de ${url}:\n\n${preview}`;
    },
});
