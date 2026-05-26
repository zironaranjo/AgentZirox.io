import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { registerTool } from '../core/dispatcher';
import { getToolContext } from '../core/tool-context';
import { clearCachedAudio, getCachedAudio } from '../core/audio-cache';
import { deleteMedia, listAudioMedia, uploadAudioToStorage } from '../core/storage';
import { setPendingTelegramAudioPath } from './tts-generate';

registerTool({
    name: 'save_audio',
    description:
        'Guarda en biblioteca el último audio TTS generado en este chat (o renombra uno recién creado). ' +
        'Usar cuando digan "guarda este audio", "guárdalo como oración matutina", etc. ' +
        'Requiere haber generado audio con tts_generate en los últimos minutos, o pasar audio_url.',
    parameters: {
        type: 'object',
        properties: {
            title: {
                type: 'string',
                description: 'Nombre para encontrarlo después (ej: oración matutina)',
            },
            description: {
                type: 'string',
                description: 'Descripción opcional para búsqueda',
            },
            audio_url: {
                type: 'string',
                description: 'URL HTTPS de un MP3 ya subido (opcional, si no hay caché TTS)',
            },
        },
        required: ['title'],
    },
    handler: async (args) => {
        const chatId = getToolContext()?.chatId;
        if (!chatId) throw new Error('No se pudo determinar el chat actual');

        const title = String(args.title ?? '').trim();
        if (!title) throw new Error('title es obligatorio (nombre del audio)');

        const description = String(args.description ?? title).trim();
        const audioUrl = String(args.audio_url ?? '').trim();

        let buffer: Buffer;
        let mimeType = 'audio/mpeg';
        let voice = 'jorge';
        let source = 'tts';

        if (audioUrl) {
            const res = await fetch(audioUrl);
            if (!res.ok) throw new Error(`No se pudo descargar audio (${res.status})`);
            buffer = Buffer.from(await res.arrayBuffer());
            const ct = res.headers.get('content-type') ?? '';
            if (ct) mimeType = ct.split(';')[0].trim();
            source = 'import';
        } else {
            const cached = getCachedAudio(chatId);
            if (!cached) {
                return (
                    '⚠️ No hay audio TTS reciente en caché. Genera uno con tts_generate primero, ' +
                    'o pasa audio_url de un enlace Supabase.'
                );
            }
            buffer = await fs.readFile(cached.path);
            mimeType = cached.mimeType;
            voice = cached.voice;
            await clearCachedAudio(chatId);
        }

        const { publicUrl, id } = await uploadAudioToStorage(buffer, mimeType, chatId, title, description, {
            voice,
            source,
        });

        return [
            `✅ Audio guardado (#${id}): **${title}**`,
            `🔗 ${publicUrl}`,
            `Para recuperarlo: "ponme el audio de ${title}" o get_saved_audio.`,
        ].join('\n');
    },
});

registerTool({
    name: 'list_audios',
    description: 'Lista audios guardados en la biblioteca de este chat.',
    parameters: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Filtrar por texto en el título (opcional)' },
            limit: { type: 'number', description: 'Máximo resultados (default 15)' },
        },
        required: [],
    },
    handler: async (args) => {
        const chatId = getToolContext()?.chatId;
        const limit = Math.min(30, Math.max(1, Number(args.limit ?? 15)));
        const query = String(args.query ?? '').trim().toLowerCase();

        const records = await listAudioMedia(chatId, limit);
        const filtered = query
            ? records.filter(
                  (r) =>
                      r.caption.toLowerCase().includes(query) ||
                      r.vision_description.toLowerCase().includes(query)
              )
            : records;

        if (filtered.length === 0) {
            return query
                ? `No hay audios guardados que coincidan con "${query}".`
                : 'No hay audios guardados. Usa save_audio tras generar uno con tts_generate.';
        }

        const lines = filtered.map((r, i) => {
            const date = r.created_at ? new Date(r.created_at).toLocaleString('es-ES') : '';
            const voice = r.sender_number ? ` · ${r.sender_number}` : '';
            return `${i + 1}. [#${r.id}] ${r.caption}${voice} — ${date}\n   🔗 ${r.public_url}`;
        });

        return `🎙️ Audios guardados (${filtered.length}):\n\n${lines.join('\n\n')}`;
    },
});

registerTool({
    name: 'get_saved_audio',
    description:
        'Busca un audio guardado por nombre o ID y lo envía al chat como archivo MP3. ' +
        'Usar cuando digan "ponme el audio de oración matutina", "envía el audio #5", etc.',
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Nombre, parte del título, o ID (#5)',
            },
        },
        required: ['query'],
    },
    handler: async (args) => {
        const chatId = getToolContext()?.chatId;
        if (!chatId) throw new Error('No se pudo determinar el chat actual');

        const query = String(args.query ?? '').trim();
        if (!query) throw new Error('query vacío');

        const records = await listAudioMedia(chatId, 50);
        if (records.length === 0) {
            return 'No hay audios guardados. Genera uno con tts_generate y save_audio.';
        }

        const idMatch = query.match(/^#?(\d+)$/);
        const q = query.toLowerCase();
        const found = idMatch
            ? records.find((r) => r.id === Number(idMatch[1]))
            : records.find(
                  (r) =>
                      r.caption.toLowerCase().includes(q) ||
                      r.vision_description.toLowerCase().includes(q)
              );

        if (!found) {
            return `No encontré audio "${query}". Usa list_audios para ver la biblioteca.`;
        }

        const res = await fetch(found.public_url);
        if (!res.ok) throw new Error(`No se pudo descargar el audio (#${found.id})`);

        const buf = Buffer.from(await res.arrayBuffer());
        const ext = found.mime_type.includes('mp4') ? 'mp4' : 'mp3';
        const tmpPath = join(tmpdir(), `saved-audio-${found.id}-${Date.now()}.${ext}`);
        await fs.writeFile(tmpPath, buf);

        setPendingTelegramAudioPath(chatId, tmpPath, `🎙️ ${found.caption}`);

        return `🎙️ Audio #${found.id}: ${found.caption}`;
    },
});

registerTool({
    name: 'delete_audio',
    description: 'Elimina un audio guardado de la biblioteca. ID de list_audios.',
    parameters: {
        type: 'object',
        properties: {
            id: { type: 'number', description: 'ID numérico del audio' },
        },
        required: ['id'],
    },
    handler: async (args) => {
        const chatId = getToolContext()?.chatId;
        const id = Number(args.id);
        if (!id || Number.isNaN(id)) return '⚠️ Indica el ID del audio (list_audios).';

        const records = await listAudioMedia(chatId, 50);
        const row = records.find((r) => r.id === id);
        if (!row) return `⚠️ No hay audio #${id} en este chat.`;

        await deleteMedia(id);
        return `🗑️ Audio #${id} "${row.caption}" eliminado.`;
    },
});
