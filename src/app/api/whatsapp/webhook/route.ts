import { NextRequest, NextResponse } from 'next/server';
import { initMemory, saveMessage } from '../../../../core/memory';
import { processMessage } from '../../../../core/agent';
import { logger } from '../../../../core/logger';
import { sendTelegramChatMessage } from '../../../../integrations/telegram/send-message';

const WA_API_VERSION = 'v19.0';

// Palabra(s) que activan el agente en grupos. Insensible a mayúsculas.
const GROUP_TRIGGERS = ['@zirox', '@agente', '@bot'];

// ── Verificación del webhook (GET) ────────────────────────────────────────────
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
                if (msg.type !== 'text') continue;

                const from = msg.from;
                const rawText = msg.text?.body?.trim();
                if (!from || !rawText) continue;

                // Detectar si es mensaje de grupo
                const groupId = msg.group_id ?? msg.context?.group_id;
                const isGroup = Boolean(groupId);
                const chatId = isGroup ? `wa_group_${groupId}` : `wa_${from}`;
                const replyTo = isGroup ? groupId! : from;

                // En grupos: escucha pasiva — guardar todos los mensajes en el historial
                if (isGroup) {
                    const senderName =
                        value.contacts?.find((c) => c.wa_id === from)?.profile?.name ?? `+${from}`;
                    const lower = rawText.toLowerCase();
                    const triggered = GROUP_TRIGGERS.some((t) => lower.includes(t));

                    if (!triggered) {
                        // Guardar en historial sin responder (contexto para futuras consultas)
                        try {
                            await initMemory();
                            await saveMessage(chatId, 'user', `[${senderName}]: ${rawText}`);
                        } catch (e) {
                            logger.warn('[whatsapp] No se pudo guardar mensaje pasivo de grupo:', e);
                        }
                        continue;
                    }
                    // Si hay trigger, el prefijo del remitente se añade al texto para contexto
                    logger.info(`[whatsapp] Grupo ${groupId} — trigger de ${senderName}: "${rawText.slice(0, 80)}"`);
                }

                // Limpiar trigger word del texto antes de procesar
                let text = rawText;
                for (const trigger of GROUP_TRIGGERS) {
                    text = text.replace(new RegExp(trigger, 'gi'), '').trim();
                }
                if (!text) continue;

                logger.info(`[whatsapp] ${isGroup ? `Grupo ${groupId}` : `+${from}`}: "${text.slice(0, 80)}"`);

                try {
                    await initMemory();
                    const reply = await processMessage(chatId, text);
                    await sendWhatsAppReply(replyTo, reply, value.metadata.phone_number_id);
                    await notifyTelegramOwner(from, rawText, reply, isGroup ? groupId : undefined);
                } catch (err) {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    logger.error(`[whatsapp] Error procesando mensaje de ${from}:`, errMsg);
                    await sendWhatsAppReply(
                        replyTo,
                        `❌ Error: ${errMsg.slice(0, 200)}`,
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
        logger.error('[whatsapp] WHATSAPP_ACCESS_TOKEN no configurado');
        return;
    }

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

async function notifyTelegramOwner(
    from: string,
    userMsg: string,
    agentReply: string,
    groupId?: string
) {
    const ownerChatId = process.env.TELEGRAM_OWNER_CHAT_ID?.trim();
    if (!ownerChatId) return;
    const preview = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);
    const origin = groupId ? `👥 *Grupo WhatsApp* (de +${from})` : `📱 *WhatsApp* de +${from}`;
    const replyCmd = groupId ? `/wa ${groupId} tu mensaje` : `/wa ${from} tu mensaje`;
    const text = [
        `${origin}:`,
        `_"${preview(userMsg, 300)}"_`,
        ``,
        `🤖 *Agente respondió:*`,
        `_"${preview(agentReply, 300)}"_`,
        ``,
        `↩️ Para intervenir: \`${replyCmd}\``,
    ].join('\n');
    await sendTelegramChatMessage(ownerChatId, text, 'Markdown').catch((e) =>
        logger.warn('[whatsapp] No se pudo notificar a Telegram:', e)
    );
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
                    group_id?: string;
                    context?: { group_id?: string; from?: string; id?: string };
                }>;
            };
        }>;
    }>;
}
