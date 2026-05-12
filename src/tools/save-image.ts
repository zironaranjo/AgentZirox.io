import { registerTool } from '../core/dispatcher';
import { getCachedImage, clearCachedImage } from '../core/image-cache';
import { uploadImageToStorage, listMedia, deleteMedia } from '../core/storage';
import { getToolContext } from '../core/tool-context';
import { setPendingTelegramImageUrl } from './generate-image';

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
            return `${i + 1}. [${r.id}] [${date}] ${r.sender_name} — "${r.caption}"\n   🔗 ${r.public_url}`;
        });
        return `🖼️ Imágenes guardadas (${records.length}):\n\n${lines.join('\n\n')}`;
    },
});

registerTool({
    name: 'delete_image',
    description: 'Elimina una imagen guardada de Supabase Storage y su metadata. Usa el ID numérico que aparece en list_images (ej: #3). Úsalo cuando el usuario diga "borra la imagen", "elimina la foto", "borra la #3", etc.',
    parameters: {
        type: 'object',
        properties: {
            id: { type: 'number', description: 'ID numérico de la imagen a eliminar (de list_images)' },
        },
        required: ['id'],
    },
    handler: async (args) => {
        const id = Number(args.id);
        if (!id || isNaN(id)) return '⚠️ Especifica el ID numérico de la imagen (usa list_images para verlos).';
        await deleteMedia(id);
        return `🗑️ Imagen #${id} eliminada de Supabase Storage.`;
    },
});

registerTool({
    name: 'get_saved_image',
    description: 'Recupera y envía al chat una imagen guardada en Supabase Storage. Úsalo cuando el usuario diga "muéstrame la imagen", "dame la foto", "envíame la foto del robot", etc. Busca por descripción, caption o ID.',
    parameters: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Texto a buscar en caption o descripción, o ID numérico precedido de #' },
        },
        required: ['query'],
    },
    handler: async (args) => {
        const chatId = getToolContext()?.chatId;
        if (!chatId) throw new Error('No se pudo determinar el chat actual');

        const query = String(args.query ?? '').trim();
        const records = await listMedia(chatId, 50);
        if (records.length === 0) return 'No hay imágenes guardadas para este chat.';

        // Buscar por ID (#3) o por texto en caption/vision_description
        const idMatch = query.match(/^#?(\d+)$/);
        let found = idMatch
            ? records.find(r => r.id === Number(idMatch[1]))
            : records.find(r =>
                r.caption.toLowerCase().includes(query.toLowerCase()) ||
                r.vision_description.toLowerCase().includes(query.toLowerCase())
            ) ?? records[0]; // fallback a la más reciente

        if (!found) return `No encontré ninguna imagen que coincida con "${query}".`;

        // Encolar URL para que el bot de Telegram la envíe como foto
        setPendingTelegramImageUrl(chatId, found.public_url);

        return `📎 Imagen #${found.id}: "${found.caption}"\n🔗 ${found.public_url}`;
    },
});
