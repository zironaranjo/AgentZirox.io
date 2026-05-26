import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { registerTool } from '../core/dispatcher';
import { getToolContext } from '../core/tool-context';
import { logger } from '../core/logger';
import { runNotebooklmAudio } from '../lib/notebooklm-audio';
import { uploadNotebooklmAudio } from '../core/storage';
import { setPendingTelegramAudioPath } from './tts-generate';

registerTool({
    name: 'create_notebooklm_audio',
    description:
        'Genera un RESUMEN EN AUDIO (Audio Overview / podcast) con Google NotebookLM a partir de un tema o texto. ' +
        'Dos voces estilo podcast, calidad NotebookLM. Tarda 5–15 min. ' +
        'Usar cuando pidan resumen en audio, podcast NotebookLM, audio overview o episodio sobre un tema. ' +
        'NO usar para TTS rápido de un texto corto (usa tts_generate).',
    parameters: {
        type: 'object',
        properties: {
            title: { type: 'string', description: 'Título del tema o episodio' },
            brief: { type: 'string', description: 'Contexto o resumen del contenido a tratar' },
            topics: {
                type: 'array',
                items: { type: 'string' },
                description: 'Puntos clave a cubrir en el audio (3–8 frases cortas)',
            },
            sources: {
                type: 'array',
                items: { type: 'string' },
                description: 'URLs solo si el usuario las pegó explícitamente',
            },
            instructions: {
                type: 'string',
                description: 'Instrucciones de tono o enfoque para el podcast (opcional)',
            },
            audio_format: {
                type: 'string',
                enum: ['deep_dive', 'brief', 'critique', 'debate'],
                description: 'Formato: deep_dive (profundo, default), brief, critique, debate',
            },
            audio_length: {
                type: 'string',
                enum: ['short', 'default', 'long'],
                description: 'Duración: short, default, long',
            },
        },
        required: ['title'],
    },
    timeoutMs: 1_200_000,
    handler: async (args) => {
        const ctx = getToolContext();
        const a = args as {
            title?: string;
            brief?: string;
            topics?: unknown;
            sources?: unknown;
            instructions?: string;
            audio_format?: string;
            audio_length?: string;
        };

        const title = String(a.title ?? '').trim();
        const brief = String(a.brief ?? '').trim();
        const topics = Array.isArray(a.topics)
            ? a.topics.map((t) => String(t).trim()).filter(Boolean).slice(0, 12)
            : [];
        const sources = Array.isArray(a.sources)
            ? a.sources.map((s) => String(s).trim()).filter(Boolean).slice(0, 8)
            : [];

        if (!title) throw new Error('title vacío');
        if (!brief && topics.length < 2) {
            throw new Error('Necesitas brief o al menos 2 topics para generar el audio NotebookLM.');
        }

        const chatId = ctx?.chatId ?? 'global';
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48);

        const format = ['deep_dive', 'brief', 'critique', 'debate'].includes(
            String(a.audio_format ?? '').toLowerCase()
        )
            ? (String(a.audio_format).toLowerCase() as 'deep_dive' | 'brief' | 'critique' | 'debate')
            : 'deep_dive';

        const length = ['short', 'default', 'long'].includes(String(a.audio_length ?? '').toLowerCase())
            ? (String(a.audio_length).toLowerCase() as 'short' | 'default' | 'long')
            : 'default';

        const { audioBuffer, mimeType, notebookId, taskId } = await runNotebooklmAudio({
            title,
            brief,
            topics,
            sources,
            instructions: String(a.instructions ?? '').trim() || undefined,
            language: 'es',
            audio_format: format,
            audio_length: length,
        });

        const ext = mimeType.includes('mp4') ? 'mp4' : 'mp3';
        const uploaded = await uploadNotebooklmAudio(audioBuffer, chatId, `${slug}-nlm`, mimeType, ext);
        const audioUrl = uploaded.publicUrl;

        const tempPath = join(tmpdir(), `notebooklm-audio-${Date.now()}.${ext}`);
        await fs.writeFile(tempPath, audioBuffer);

        if (ctx?.chatId) {
            setPendingTelegramAudioPath(ctx.chatId, tempPath);
        }

        const mb = (audioBuffer.length / (1024 * 1024)).toFixed(1);

        const lines = [
            `✅ Resumen en audio NotebookLM listo: **${title}**`,
            `🎙️ Podcast enviado por Telegram (${mb} MB, formato ${format}).`,
            taskId ? `🧠 task: ${taskId}` : '',
            notebookId ? `📒 notebook: ${notebookId}` : '',
            `🔗 Audio: ${audioUrl}`,
        ].filter(Boolean);

        logger.info(`[create_notebooklm_audio] ${title} (${mb} MB)`);

        return lines.join('\n');
    },
});
