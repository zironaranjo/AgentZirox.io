import { registerTool } from '../core/dispatcher';
import { getCachedImage, clearCachedImage } from '../core/image-cache';
import { uploadImageToStorage, listMedia } from '../core/storage';
import { getToolContext } from '../core/tool-context';

registerTool({
    name: 'save_image',
    description:
        'Guarda la última imagen recibida en este chat en Supabase Storage. Úsalo cuando el usuario diga "guarda esta imagen", "archiva la foto", "guarda esa foto" o similar. Devuelve la URL pública de la imagen guardada.',
    parameters: {
        type: 'object',
        properties: {
            label: {
                type: 'string',
                description: 'Etiqueta o descripción adicional para identificar la imagen (opcional)',
            },
        },
        required: [],
    },
    handler: async (args) => {
        const chatId = getToolContext()?.chatId;
        if (!chatId) throw new Error('No se pudo determinar el chat actual');

        const img = getCachedImage(chatId);
        if (!img) {
            return '⚠️ No hay ninguna imagen reciente en caché para este chat. Las imágenes solo están disponibles ~10 minutos después de recibirlas.';
        }

        const label = String(args.label ?? '').trim();
        const caption = label || img.caption || '(sin descripción)';

        const { publicUrl } = await uploadImageToStorage(
            img.base64,
            img.mimeType,
            chatId,
            img.senderNumber,
            img.senderName,
            caption,
            img.caption
        );

        clearCachedImage(chatId);

        return [
            `✅ Imagen guardada en Supabase Storage`,
            `📎 URL: ${publicUrl}`,
            `👤 Enviada por: ${img.senderName}`,
            `📝 "${caption}"`,
        ].join('\n');
    },
});

registerTool({
    name: 'list_images',
    description: 'Lista las imágenes guardadas en Supabase Storage para este chat o en general.',
    parameters: {
        type: 'object',
        properties: {
            limit: { type: 'number', description: 'Máximo de resultados (default 10)' },
        },
        required: [],
    },
    handler: async (args) => {
        const chatId = getToolContext()?.chatId;
        const limit = Math.min(20, Math.max(1, Number(args.limit ?? 10)));
        const records = await listMedia(chatId, limit);
        if (records.length === 0) return 'No hay imágenes guardadas aún.';
        const lines = records.map((r, i) => {
            const date = r.created_at ? new Date(r.created_at).toLocaleString('es-ES') : '';
            return `${i + 1}. [${date}] ${r.sender_name} — "${r.caption}"\n   🔗 ${r.public_url}`;
        });
        return `🖼️ Imágenes guardadas (${records.length}):\n\n${lines.join('\n\n')}`;
    },
});
