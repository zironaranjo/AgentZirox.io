import { NextRequest, NextResponse } from 'next/server';
import { initMemory } from '../../../../core/memory';
import { processMessage } from '../../../../core/agent';
import { logger } from '../../../../core/logger';

const WA_API_VERSION = 'v19.0';

// ── Verificación del webhook (GET) ────────────────────────────────────────────
// Meta llama a este endpoint una vez para confirmar que el webhook es tuyo.
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get('hub.mode');
    const token = searchParams.get('hub.verify_token');
    const challenge = searchParams.get('hub.challenge');

    const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim();
    if (!verifyToken) {
        return new NextResponse('WHATSAPP_WEBHOOK_VERIFY_TOKEN no configurado', { status: 500 });
    }

    if (mode === 'subscribe' && token === verifyToken) {
        logger.info('[whatsapp] Webhook verificado correctamente');
        return new NextResponse(challenge, { status: 200 });
    }

    logger.warn('[whatsapp] Verificación fallida — token incorrecto');
    return new NextResponse('Forbidden', { status: 403 });
}

// ── Mensajes entrantes (POST) ─────────────────────────────────────────────────
export async function POST(req: NextRequest) {
    let body: WhatsAppWebhookPayload;
    try {
        body = (await req.json()) as WhatsAppWebhookPayload;
    } catch {
        return new NextResponse('Bad Request', { status: 400 });
    }

    // Meta espera siempre un 200 rápido, procesamos en background
    processIncoming(body).catch((err) =>
        logger.error('[whatsapp] Error procesando mensaje entrante:', err)
    );

    return new NextResponse('OK', { status: 200 });
}

async function processIncoming(payload: WhatsAppWebhookPayload) {
    if (payload.object !== 'whatsapp_business_account') return;

    for (const entry of payload.entry ?? []) {
        for (const change of entry.changes ?? []) {
            if (change.field !== 'messages') continue;

            const value = change.value;
            for (const msg of value.messages ?? []) {
                if (msg.type !== 'text') continue; // solo texto por ahora

                const from = msg.from; // número del usuario, ej: "34612345678"
                const text = msg.text?.body?.trim();
                if (!from || !text) continue;

                const chatId = `wa_${from}`;
                logger.info(`[whatsapp] Mensaje de +${from}: "${text.slice(0, 80)}"`);

                try {
                    await initMemory();
                    const reply = await processMessage(chatId, text);
                    await sendWhatsAppReply(from, reply, value.metadata.phone_number_id);
                } catch (err) {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    logger.error(`[whatsapp] Error procesando mensaje de ${from}:`, errMsg);
                    await sendWhatsAppReply(
                        from,
                        `❌ Error interno: ${errMsg.slice(0, 200)}`,
                        value.metadata.phone_number_id
                    ).catch(() => {});
                }
            }
        }
    }
}

async function sendWhatsAppReply(to: string, text: string, phoneNumberId: string) {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
    if (!accessToken) {
        logger.error('[whatsapp] WHATSAPP_ACCESS_TOKEN no configurado — no se puede responder');
        return;
    }

    // WhatsApp tiene límite de 4096 chars por mensaje
    const chunks = splitMessage(text, 4000);
    for (const chunk of chunks) {
        const res = await fetch(
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
                    type: 'text',
                    text: { body: chunk },
                }),
            }
        );

        if (!res.ok) {
            const raw = await res.text();
            logger.error(`[whatsapp] Error enviando respuesta (${res.status}): ${raw.slice(0, 300)}`);
        }
    }
}

function splitMessage(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text];
    const chunks: string[] = [];
    let i = 0;
    while (i < text.length) {
        chunks.push(text.slice(i, i + maxLen));
        i += maxLen;
    }
    return chunks;
}

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface WhatsAppWebhookPayload {
    object: string;
    entry?: Array<{
        id: string;
        changes?: Array<{
            field: string;
            value: {
                metadata: { display_phone_number: string; phone_number_id: string };
                contacts?: Array<{ profile: { name: string }; wa_id: string }>;
                messages?: Array<{
                    from: string;
                    id: string;
                    timestamp: string;
                    type: string;
                    text?: { body: string };
                }>;
            };
        }>;
    }>;
}
