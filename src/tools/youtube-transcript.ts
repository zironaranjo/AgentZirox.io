import { registerTool } from '../core/dispatcher';

function extractVideoId(input: string): string | null {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
        /^([a-zA-Z0-9_-]{11})$/,
    ];
    for (const p of patterns) {
        const m = input.match(p);
        if (m) return m[1];
    }
    return null;
}

registerTool({
    name: 'youtube_transcript',
    description:
        'Obtiene la transcripción/subtítulos de un vídeo de YouTube a partir de su URL o ID. Útil para resumir vídeos, extraer información o crear guiones basados en el contenido.',
    parameters: {
        type: 'object',
        properties: {
            video: {
                type: 'string',
                description: 'URL de YouTube o ID del vídeo (ej: https://youtu.be/abc123 o abc123xyz)',
            },
            lang: {
                type: 'string',
                description: 'Idioma preferido de los subtítulos (ej: es, en). Default: es, luego en',
            },
        },
        required: ['video'],
    },
    handler: async (args) => {
        const input = String(args.video ?? '').trim();
        const lang = String(args.lang ?? 'es').toLowerCase();

        const videoId = extractVideoId(input);
        if (!videoId) throw new Error('No se pudo extraer el ID del vídeo. Pasa una URL de YouTube o un ID de 11 caracteres.');

        const { YoutubeTranscript } = await import('youtube-transcript');

        let transcript;
        try {
            transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang });
        } catch {
            // Fallback to English if requested lang not found
            if (lang !== 'en') {
                transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
            } else {
                throw new Error(`No hay subtítulos disponibles para este vídeo (ID: ${videoId}). El vídeo puede no tener subtítulos o estar restringido.`);
            }
        }

        if (!transcript || transcript.length === 0) {
            throw new Error(`No se encontraron subtítulos para el vídeo ${videoId}.`);
        }

        const text = transcript.map((t) => t.text).join(' ').replace(/\s+/g, ' ').trim();
        const maxChars = 6000;
        const preview = text.length > maxChars ? `${text.slice(0, maxChars)}…\n\n_(transcripción truncada — ${text.length} chars totales)_` : text;

        return [
            `📺 Transcripción de https://youtu.be/${videoId}`,
            `📊 ${transcript.length} fragmentos — ${text.length} caracteres`,
            ``,
            preview,
        ].join('\n');
    },
});
