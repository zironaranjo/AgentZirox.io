import { registerTool } from '../../core/dispatcher';
import {
    assertDesktopControl,
    findFirstYoutubeVideoUrl,
    openUrl,
    youtubeSearchFallbackUrl,
} from './desktop-utils';

registerTool({
    name: 'play_youtube',
    description:
        'Reproduce música o vídeo en YouTube en el navegador del PC local. ' +
        'Usar cuando pidan poner/reproducir una canción, artista o vídeo en YouTube. ' +
        'Requiere DESKTOP_CONTROL_ENABLED=true y agente corriendo en el mismo Windows del usuario.',
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Canción, artista o tema a buscar en YouTube (ej: "Bad Bunny Monaco")',
            },
        },
        required: ['query'],
    },
    handler: async (args) => {
        assertDesktopControl();
        const query = String(args.query ?? '').trim();
        if (!query) throw new Error('Indica qué quieres reproducir en YouTube.');

        const direct = await findFirstYoutubeVideoUrl(query);
        if (direct) {
            await openUrl(direct);
            return `▶️ Reproduciendo en YouTube: ${query}\n🔗 ${direct}`;
        }

        const fallback = youtubeSearchFallbackUrl(query);
        await openUrl(fallback);
        return `🔍 Abrí la búsqueda en YouTube: ${query}\n🔗 ${fallback}`;
    },
});
