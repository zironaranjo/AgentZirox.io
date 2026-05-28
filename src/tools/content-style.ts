import { registerTool } from '../core/dispatcher';
import {
    detectPlatform,
    insertStyleRecipe,
    loadStyleRecipes,
    getStyleRecipe,
    deleteStyleRecipe,
} from '../integrations/content/style-recipes';

function extractYouTubeId(input: string): string | null {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/(?:embed|shorts)\/([a-zA-Z0-9_-]{11})/,
    ];
    for (const p of patterns) {
        const m = input.match(p);
        if (m) return m[1];
    }
    return null;
}

async function fetchOEmbed(endpoint: string): Promise<Record<string, unknown> | null> {
    try {
        const res = await fetch(endpoint, { headers: { 'User-Agent': 'Mozilla/5.0 ZiroxBot' } });
        if (!res.ok) return null;
        return await res.json() as Record<string, unknown>;
    } catch {
        return null;
    }
}

function extractOgTags(html: string): { title?: string; description?: string } {
    const pick = (prop: string): string | undefined => {
        const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
        const m = html.match(re);
        return m ? m[1] : undefined;
    };
    return {
        title: pick('og:title') ?? pick('twitter:title'),
        description: pick('og:description') ?? pick('twitter:description') ?? pick('description'),
    };
}

/** Recopila datos crudos de la referencia (transcript/caption/metadatos). */
async function gatherReference(url: string): Promise<string> {
    const platform = detectPlatform(url);
    const parts: string[] = [`Plataforma: ${platform}`, `URL: ${url}`];

    if (platform === 'youtube') {
        const id = extractYouTubeId(url);
        const oembed = await fetchOEmbed(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
        if (oembed?.title) parts.push(`Título: ${String(oembed.title)}`);
        if (oembed?.author_name) parts.push(`Autor: ${String(oembed.author_name)}`);
        if (id) {
            try {
                const { YoutubeTranscript } = await import('youtube-transcript');
                let tr;
                try { tr = await YoutubeTranscript.fetchTranscript(id, { lang: 'es' }); }
                catch { tr = await YoutubeTranscript.fetchTranscript(id, { lang: 'en' }); }
                const text = tr.map(t => t.text).join(' ').replace(/\s+/g, ' ').trim();
                parts.push(`Transcripción (${text.length} chars):\n${text.slice(0, 4000)}`);
            } catch {
                parts.push('Transcripción: no disponible (sin subtítulos).');
            }
        }
    } else if (platform === 'tiktok') {
        const oembed = await fetchOEmbed(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
        if (oembed?.title) parts.push(`Texto/caption: ${String(oembed.title)}`);
        if (oembed?.author_name) parts.push(`Autor: @${String(oembed.author_name)}`);
        if (!oembed) parts.push('No se pudo leer el oEmbed de TikTok (puede ser privado o requerir login).');
    } else if (platform === 'instagram') {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 ZiroxBot' } });
            const html = await res.text();
            const og = extractOgTags(html);
            if (og.title) parts.push(`Título: ${og.title}`);
            if (og.description) parts.push(`Descripción: ${og.description}`);
        } catch {
            parts.push('No se pudo leer la página de Instagram (puede requerir login).');
        }
    } else {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 ZiroxBot' } });
            const html = await res.text();
            const og = extractOgTags(html);
            if (og.title) parts.push(`Título: ${og.title}`);
            if (og.description) parts.push(`Descripción: ${og.description}`);
        } catch {
            parts.push('No se pudo leer la página.');
        }
    }

    return parts.join('\n');
}

registerTool({
    name: 'analyze_reference',
    description:
        'Analiza un vídeo de referencia (TikTok, YouTube/Shorts o Instagram Reel) que le gusta al usuario para APRENDER su FORMATO/ESTILO (no copiar el contenido). Recopila transcripción, caption y metadatos. DESPUÉS de llamarla, DEBES destilar una "receta de estilo" (hook, estructura por bloques, tono, ritmo/edición, CTA, hashtags, duración) y guardarla llamando save_style_recipe. Úsala cuando el usuario diga "analiza este vídeo", "aprende de este tiktok", "me gusta este formato", etc.',
    parameters: {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'URL del vídeo de referencia (TikTok/YouTube/Instagram).' },
        },
        required: ['url'],
    },
    handler: async (args) => {
        const url = String((args as { url?: string }).url ?? '').trim();
        if (!url) throw new Error('Falta la URL del vídeo de referencia.');
        try { new URL(url); } catch { throw new Error('La URL no es válida.'); }

        const data = await gatherReference(url);
        return [
            '📥 Datos de la referencia recopilados:',
            '',
            data,
            '',
            '---',
            'AHORA: destila una RECETA DE ESTILO (imitar el formato, NO el contenido) y guárdala con save_style_recipe:',
            '- name: nombre corto y descriptivo del estilo',
            '- hook, structure (por bloques con tiempos), tone, pacing, cta, hashtags, duration_sec',
            'Resume en español.',
        ].join('\n');
    },
});

registerTool({
    name: 'save_style_recipe',
    description:
        'Guarda una "receta de estilo" en la biblioteca tras analizar una referencia con analyze_reference. La receta describe el FORMATO a imitar (no el contenido).',
    parameters: {
        type: 'object',
        properties: {
            name: { type: 'string', description: 'Nombre corto del estilo (ej. "Tips IA rápidos enérgico").' },
            platform: { type: 'string', description: 'tiktok | youtube | instagram | otro' },
            source_url: { type: 'string', description: 'URL de la referencia analizada.' },
            hook: { type: 'string', description: 'Gancho de los primeros segundos.' },
            structure: { type: 'string', description: 'Estructura por bloques con tiempos (ej. "hook 3s → problema → 3 tips → CTA").' },
            tone: { type: 'string', description: 'Tono y voz (cercano, técnico, enérgico...).' },
            pacing: { type: 'string', description: 'Ritmo y edición (cortes rápidos, texto en pantalla, b-roll...).' },
            cta: { type: 'string', description: 'Llamada a la acción típica.' },
            hashtags: { type: 'array', items: { type: 'string' }, description: 'Hashtags sugeridos.' },
            duration_sec: { type: 'number', description: 'Duración objetivo en segundos.' },
            notes: { type: 'string', description: 'Notas libres del análisis.' },
        },
        required: ['name', 'hook', 'structure', 'tone', 'cta'],
    },
    handler: async (args) => {
        const a = args as Record<string, unknown>;
        const recipe = await insertStyleRecipe({
            name: String(a.name),
            platform: String(a.platform ?? 'otro'),
            sourceUrl: a.source_url ? String(a.source_url) : undefined,
            hook: String(a.hook),
            structure: String(a.structure),
            tone: String(a.tone),
            pacing: String(a.pacing ?? ''),
            cta: String(a.cta),
            hashtags: Array.isArray(a.hashtags) ? (a.hashtags as unknown[]).map(String) : [],
            durationSec: Number(a.duration_sec) || 30,
            notes: a.notes ? String(a.notes) : undefined,
        });
        return [
            `✅ Receta de estilo guardada — id ${recipe.id}: **${recipe.name}**`,
            `Para crear contenido con ella: "crea un vídeo estilo ${recipe.name} sobre <tema>".`,
        ].join('\n');
    },
});

registerTool({
    name: 'list_style_recipes',
    description: 'Lista las recetas de estilo guardadas (formatos aprendidos de vídeos que le gustan al usuario).',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: async () => {
        const rows = await loadStyleRecipes();
        if (rows.length === 0) return 'No hay recetas de estilo guardadas. Analiza un vídeo con analyze_reference para empezar.';
        return [
            '🎨 Recetas de estilo guardadas:',
            '',
            ...rows.map(r => `• id ${r.id} — **${r.name}** (${r.platform}, ~${r.durationSec}s)\n  ${r.structure}`),
        ].join('\n');
    },
});

registerTool({
    name: 'create_from_style',
    description:
        'Prepara la creación de un contenido nuevo imitando una receta de estilo guardada, sobre un tema concreto. Devuelve la receta y el tema para que generes un GUION + texto del post (caption con hashtags) en español. Si el usuario quiere el vídeo, después llama generate_video con un prompt que incluya la narración en español del guion (Veo genera vídeo con voz). Úsala cuando el usuario diga "crea un vídeo estilo X sobre Y".',
    parameters: {
        type: 'object',
        properties: {
            recipe: { type: 'string', description: 'Nombre o id de la receta de estilo a imitar.' },
            topic: { type: 'string', description: 'Tema/asunto del nuevo contenido.' },
        },
        required: ['recipe', 'topic'],
    },
    handler: async (args) => {
        const a = args as { recipe?: string | number; topic?: string };
        const topic = String(a.topic ?? '').trim();
        if (!topic) throw new Error('Falta el tema (topic) del contenido.');
        const key = typeof a.recipe === 'number' ? a.recipe : String(a.recipe ?? '').trim();
        if (!key) throw new Error('Falta la receta de estilo.');

        const recipe = await getStyleRecipe(key);
        if (!recipe) return `No encontré la receta "${key}". Usa list_style_recipes para ver las disponibles.`;

        return [
            `🎬 Crea contenido imitando el FORMATO (no el contenido) de **${recipe.name}** sobre: "${topic}"`,
            '',
            'RECETA A SEGUIR:',
            `- Hook: ${recipe.hook}`,
            `- Estructura: ${recipe.structure}`,
            `- Tono: ${recipe.tone}`,
            `- Ritmo/edición: ${recipe.pacing}`,
            `- CTA: ${recipe.cta}`,
            `- Duración objetivo: ~${recipe.durationSec}s`,
            `- Hashtags base: ${recipe.hashtags.join(' ') || '(propón los más adecuados)'}`,
            '',
            'GENERA EN ESPAÑOL:',
            '1) GUION con marcas de tiempo siguiendo la estructura (incluye el hook literal de los primeros segundos).',
            '2) TEXTO DEL POST (caption) con hashtags para TikTok.',
            '3) Si el usuario pidió el vídeo, llama generate_video con un prompt visual + la narración en off en español del guion.',
        ].join('\n');
    },
});

registerTool({
    name: 'delete_style_recipe',
    description: 'Elimina una receta de estilo por id.',
    parameters: {
        type: 'object',
        properties: { id: { type: 'number', description: 'ID de la receta a eliminar.' } },
        required: ['id'],
    },
    handler: async (args) => {
        const id = Number((args as { id?: number }).id);
        if (!id) throw new Error('Falta el id de la receta.');
        const ok = await deleteStyleRecipe(id);
        return ok ? `🗑️ Receta #${id} eliminada.` : `No existe la receta #${id}.`;
    },
});
