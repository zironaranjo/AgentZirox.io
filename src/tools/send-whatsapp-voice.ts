import { registerTool } from '../core/dispatcher';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WA_API_VERSION = 'v19.0';

const VOICES: Record<string, string> = {
    elvira: 'es-ES-ElviraNeural',
    alvaro: 'es-ES-AlvaroNeural',
    jorge: 'es-MX-JorgeNeural',
    dalia: 'es-MX-DaliaNeural',
    default: 'es-ES-ElviraNeural',
};

registerTool({
    name: 'send_whatsapp_voice',
    description:
        'Genera una nota de voz (audio TTS) y la envía por WhatsApp. Úsalo cuando el usuario pida responder con voz, enviar un resumen hablado o mandar una nota de voz. Voces disponibles: elvira (es-ES femenina), alvaro (es-ES masculino), jorge (es-MX masculino), dalia (es-MX femenina).',
    parameters: {
        type: 'object',
        properties: {
            to: {
                type: 'string',
                description: 'Número destino en formato internacional sin + ni espacios (ej: 34612345678)',
            },
            text: {
                type: 'string',
                description: 'Texto que se convertirá en nota de voz (máx 5000 caracteres)',
            },
            voice: {
                type: 'string',
                description: 'Voz a usar: elvira, alvaro, jorge, dalia (default: elvira)',
            },
        },
        required: ['to', 'text'],
    },
    handler: async (args) => {
        const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
        const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
        if (!phoneNumberId || !accessToken) {
            return '❌ WhatsApp no configurado. Añade WHATSAPP_PHONE_NUMBER_ID y WHATSAPP_ACCESS_TOKEN en Dokploy.';
        }

        const to = String(args.to ?? '').replace(/[\s+\-()]/g, '');
        const text = String(args.text ?? '').trim();
        if (!to) throw new Error('to es obligatorio (número en formato internacional)');
        if (!text) throw new Error('text es obligatorio');
        if (text.length > 5000) throw new Error('Texto demasiado largo (máx 5000 caracteres)');

        const voiceKey = String(args.voice ?? 'default').toLowerCase();
        const voice = VOICES[voiceKey] ?? VOICES.default;

        // 1. Generar TTS → MP3
        const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');
        const tts = new MsEdgeTTS();
        await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

        const audioPath = join(tmpdir(), `wa_voice_${Date.now()}.mp3`);
        await new Promise<void>((resolve, reject) => {
            const { audioStream } = tts.toStream(text);
            const chunks: Buffer[] = [];
            audioStream.on('data', (chunk: Buffer) => chunks.push(chunk));
            audioStream.on('end', async () => {
                try {
                    await fs.writeFile(audioPath, Buffer.concat(chunks));
                    resolve();
                } catch (e) { reject(e); }
            });
            audioStream.on('error', reject);
        });

        // 2. Subir a WhatsApp Media API
        const audioBuffer = await fs.readFile(audioPath);
        const formData = new FormData();
        formData.append('messaging_product', 'whatsapp');
        formData.append('type', 'audio/mpeg');
        formData.append('file', new Blob([audioBuffer], { type: 'audio/mpeg' }), 'voice.mp3');

        const uploadRes = await fetch(
            `https://graph.facebook.com/${WA_API_VERSION}/${phoneNumberId}/media`,
            {
                method: 'POST',
                headers: { Authorization: `Bearer ${accessToken}` },
                body: formData,
            }
        );

        if (!uploadRes.ok) {
            const err = await uploadRes.text();
            await fs.unlink(audioPath).catch(() => {});
            throw new Error(`Error subiendo audio (${uploadRes.status}): ${err.slice(0, 300)}`);
        }

        const { id: mediaId } = (await uploadRes.json()) as { id: string };

        // 3. Enviar mensaje de audio
        const sendRes = await fetch(
            `https://graph.facebook.com/${WA_API_VERSION}/${phoneNumberId}/messages`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    to,
                    type: 'audio',
                    audio: { id: mediaId },
                }),
            }
        );

        await fs.unlink(audioPath).catch(() => {});

        if (!sendRes.ok) {
            const err = await sendRes.text();
            throw new Error(`Error enviando audio (${sendRes.status}): ${err.slice(0, 300)}`);
        }

        const data = (await sendRes.json()) as { messages?: Array<{ id?: string }> };
        const msgId = data.messages?.[0]?.id ?? '(sin ID)';

        return `🎙️ Nota de voz enviada a +${to}\n🆔 ${msgId}\n🗣️ Voz: ${voice}\n📝 "${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`;
    },
});
