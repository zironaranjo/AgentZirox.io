import { registerTool } from '../core/dispatcher';
import { getToolContext } from '../core/tool-context';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pendingTelegramAudioPath = new Map<string, string>();

export function consumePendingTelegramAudioPath(chatId: string): string | undefined {
    const p = pendingTelegramAudioPath.get(chatId);
    if (p) pendingTelegramAudioPath.delete(chatId);
    return p;
}

export function setPendingTelegramAudioPath(chatId: string, filePath: string): void {
    pendingTelegramAudioPath.set(chatId, filePath);
}

const VOICES: Record<string, string> = {
    elvira: 'es-ES-ElviraNeural',
    alvaro: 'es-ES-AlvaroNeural',
    jorge: 'es-MX-JorgeNeural',
    dalia: 'es-MX-DaliaNeural',
    default: 'es-ES-ElviraNeural',
};

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
                description: 'Voz a usar: elvira, alvaro, jorge, dalia (default: elvira)',
            },
            filename: {
                type: 'string',
                description: 'Nombre del archivo de salida sin extensión (default: tts_output)',
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

        const tctx = getToolContext();
        if (tctx?.chatId) {
            pendingTelegramAudioPath.set(tctx.chatId, outputPath);
        }

        return [
            `🎙️ Audio generado correctamente`,
            `🗣️ Voz: ${voice}`,
            `📊 Tamaño: ${kb} KB`,
            `📝 Texto (${text.length} chars): "${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`,
        ].join('\n');
    },
});
