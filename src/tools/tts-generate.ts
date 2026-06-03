import { registerTool } from '../core/dispatcher';
import { getToolContext } from '../core/tool-context';
import { cacheAudioFile, clearCachedAudio } from '../core/audio-cache';
import { uploadAudioToStorage } from '../core/storage';
import { stripForSpeech } from '../lib/speech-text';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pendingTelegramAudioPath = new Map<string, string>();
const pendingTelegramAudioCaption = new Map<string, string>();

export function consumePendingTelegramAudioPath(chatId: string): string | undefined {
    const p = pendingTelegramAudioPath.get(chatId);
    if (p) {
        pendingTelegramAudioPath.delete(chatId);
        pendingTelegramAudioCaption.delete(chatId);
    }
    return p;
}

export function consumePendingTelegramAudioCaption(chatId: string): string | undefined {
    return pendingTelegramAudioCaption.get(chatId);
}

export function setPendingTelegramAudioPath(chatId: string, filePath: string, caption?: string): void {
    pendingTelegramAudioPath.set(chatId, filePath);
    if (caption) pendingTelegramAudioCaption.set(chatId, caption);
    else pendingTelegramAudioCaption.delete(chatId);
}

export const VOICES: Record<string, string> = {
    elvira: 'es-ES-ElviraNeural',
    alvaro: 'es-ES-AlvaroNeural',
    jorge: 'es-MX-JorgeNeural',
    dalia: 'es-MX-DaliaNeural',
    default: 'es-MX-JorgeNeural',
};

/**
 * Sintetiza voz a partir de texto y devuelve el MP3 como Buffer.
 * Reutilizable por otras tools (ej. create_short_video). Usa Edge TTS gratuito.
 */
export async function synthesizeSpeech(text: string, voiceKey = 'default'): Promise<Buffer> {
    const clean = stripForSpeech(text);
    if (!clean) throw new Error('synthesizeSpeech: texto vacío');
    const voice = VOICES[voiceKey.toLowerCase()] ?? VOICES.default;

    const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    return await new Promise<Buffer>((resolve, reject) => {
        const { audioStream } = tts.toStream(clean);
        const chunks: Buffer[] = [];
        audioStream.on('data', (chunk: Buffer) => chunks.push(chunk));
        audioStream.on('end', () => resolve(Buffer.concat(chunks)));
        audioStream.on('error', reject);
    });
}

registerTool({
    name: 'tts_generate',
    description:
        'Convierte texto a audio (voz) usando Microsoft Edge TTS gratuito. Genera un archivo MP3. Útil para voiceovers de YouTube, podcasts o mensajes de voz. Voces disponibles: elvira (es-ES femenina), alvaro (es-ES masculino), jorge (es-MX masculino), dalia (es-MX femenina).',
    parameters: {
        type: 'object',
        properties: {
            text: { type: 'string', description: 'Texto a convertir en audio' },
            voice: {
                type: 'string',
                description: 'Voz a usar: elvira, alvaro, jorge, dalia (default: jorge)',
            },
            filename: {
                type: 'string',
                description: 'Nombre del archivo de salida sin extensión (default: tts_output)',
            },
            save_as: {
                type: 'string',
                description:
                    'Si se indica, guarda en biblioteca con este nombre (ej: oración matutina) para recuperarlo después',
            },
        },
        required: ['text'],
    },
    handler: async (args) => {
        const text = String(args.text ?? '').trim();
        if (!text) throw new Error('text es obligatorio');
        if (text.length > 5000) throw new Error('Texto demasiado largo (máx 5000 caracteres)');

        const voiceKey = String(args.voice ?? 'default').toLowerCase();
        const voice = VOICES[voiceKey] ?? VOICES.default;
        const filename = String(args.filename ?? 'tts_output').replace(/[^a-zA-Z0-9_-]/g, '_');

        // Dynamic import — msedge-tts uses ESM
        const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');

        const tts = new MsEdgeTTS();
        await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

        const outputPath = join(tmpdir(), `${filename}_${Date.now()}.mp3`);

        await new Promise<void>((resolve, reject) => {
            const { audioStream } = tts.toStream(text);
            const chunks: Buffer[] = [];
            audioStream.on('data', (chunk: Buffer) => chunks.push(chunk));
            audioStream.on('end', async () => {
                try {
                    await fs.writeFile(outputPath, Buffer.concat(chunks));
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
            audioStream.on('error', reject);
        });

        const stat = await fs.stat(outputPath);
        const kb = (stat.size / 1024).toFixed(1);
        const audioBuffer = await fs.readFile(outputPath);

        const tctx = getToolContext();
        if (tctx?.chatId) {
            await cacheAudioFile(tctx.chatId, outputPath, 'audio/mpeg', voiceKey, text);
            pendingTelegramAudioPath.set(tctx.chatId, outputPath);
        }

        const saveAs = String(args.save_as ?? '').trim();
        let savedLine = '';
        if (saveAs && tctx?.chatId) {
            const { publicUrl, id } = await uploadAudioToStorage(
                audioBuffer,
                'audio/mpeg',
                tctx.chatId,
                saveAs,
                text.slice(0, 500),
                { voice: voiceKey, source: 'tts' }
            );
            savedLine = `\n💾 Guardado en biblioteca (#${id}): ${publicUrl}`;
            await clearCachedAudio(tctx.chatId);
        }

        return [
            `🎙️ Audio generado correctamente`,
            `🗣️ Voz: ${voice}`,
            `📊 Tamaño: ${kb} KB`,
            `📝 Texto (${text.length} chars): "${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`,
            savedLine,
        ]
            .filter(Boolean)
            .join('\n');
    },
});
