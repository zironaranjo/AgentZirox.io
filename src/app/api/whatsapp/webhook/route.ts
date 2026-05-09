import { NextRequest, NextResponse } from 'next/server';
import { initMemory, saveMessage } from '../../../../core/memory';
import { processMessage } from '../../../../core/agent';
import { logger } from '../../../../core/logger';
import { sendTelegramChatMessage } from '../../../../integrations/telegram/send-message';
import { analyzeImageBase64, visionAvailable } from '../../../../core/vision';

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
                const { type, from } = msg;
                if (!from) continue;
                if (!['text', 'image', 'video'].includes(type)) continue;

                const groupId = msg.group_id ?? msg.context?.group_id;
                const isGroup = Boolean(groupId);
                const chatId = isGroup ? `wa_group_${groupId}` : `wa_${from}`;
                const replyTo = isGroup ? groupId! : from;
                const senderName =
                    value.contacts?.find((c) => c.wa_id === from)?.profile?.name ?? `+${from}`;

                await initMemory();

                // ── Vídeo: guardar en historial (sin analizar) ────────────────
                if (type === 'video') {
                    if (isGroup) {
                        const caption = msg.video?.caption ? ` — "${msg.video.caption}"` : '';
                        await saveMessage(chatId, 'user', `[${senderName}]: subió un vídeo${caption}`).catch(() => {});
                    }
                    continue;
                }

                // ── Imagen: descargar y analizar ──────────────────────────────
                if (type === 'image') {
                    const mediaId = msg.image?.id;
                    const caption = msg.image?.caption?.trim() ?? '';
                    if (!mediaId) continue;

                    let visionResult = '';
                    if (visionAvailable()) {
                        try {
                            const { base64, mimeType } = await downloadWhatsAppMedia(mediaId);
                            visionResult = await analyzeImageBase64(base64, mimeType, caption);
                        } catch (e) {
                            logger.warn('[whatsapp] Error analizando imagen:', e);
                            visionResult = '(no se pudo analizar la imagen)';
                        }
                    }

                    const historyLine = `[${senderName}]: [FOTO]${caption ? ` "${caption}"` : ''}${visionResult ? ` | 🔍 ${visionResult}` : ''}`;

                    // En grupos: guardar siempre en historial
                    if (isGroup) {
                        const lower = (caption + ' ' + visionResult).toLowerCase();
                        const triggered = GROUP_TRIGGERS.some((t) => lower.includes(t)) ||
                            GROUP_TRIGGERS.some((t) => (msg.image?.caption ?? '').toLowerCase().includes(t));

                        if (!triggered) {
                            await saveMessage(chatId, 'user', historyLine).catch(() => {});
                            logger.info(`[whatsapp] Grupo ${groupId} — imagen pasiva de ${senderName}: ${caption || '(sin caption)'}`);
                            continue;
                        }
                    }

                    // Responder (grupo con trigger o chat individual)
                    const textForAgent = visionResult
                        ? `[IMAGEN RECIBIDA]\n${caption ? `El usuario dice: "${caption}"\n` : ''}Descripción automática: ${visionResult}`
                        : caption || '[IMAGEN sin descripción]';

                    logger.info(`[whatsapp] ${isGroup ? `Grupo ${groupId}` : `+${from}`} imagen: "${caption.slice(0, 60)}"`);
                    try {
                        const reply = await processMessage(chatId, textForAgent);
                        await sendWhatsAppReply(replyTo, reply, value.metadata.phone_number_id);
                        await notifyTelegramOwner(from, `📷 ${caption || '(imagen)'}`, reply, isGroup ? groupId : undefined);
                    } catch (err) {
                        const errMsg = err instanceof Error ? err.message : String(err);
                        logger.error(`[whatsapp] Error procesando imagen de ${from}:`, errMsg);
                        await sendWhatsAppReply(replyTo, `❌ Error: ${errMsg.slice(0, 200)}`, value.metadata.phone_number_id).catch(() => {});
                    }
                    continue;
                }

                // ── Texto ─────────────────────────────────────────────────────
                const rawText = msg.text?.body?.trim();
                if (!rawText) continue;

                if (isGroup) {
                    const lower = rawText.toLowerCase();
                    const triggered = GROUP_TRIGGERS.some((t) => lower.includes(t));

                    if (!triggered) {
                        await saveMessage(chatId, 'user', `[${senderName}]: ${rawText}`).catch(() => {});
                        continue;
                    }
                    logger.info(`[whatsapp] Grupo ${groupId} — trigger de ${senderName}: "${rawText.slice(0, 80)}"`);
                }

                let text = rawText;
                for (const trigger of GROUP_TRIGGERS) {
                    text = text.replace(new RegExp(trigger, 'gi'), '').trim();
                }
                if (!text) continue;

                logger.info(`[whatsapp] ${isGroup ? `Grupo ${groupId}` : `+${from}`}: "${text.slice(0, 80)}"`);
                try {
                    const reply = await processMessage(chatId, text);
                    await sendWhatsAppReply(replyTo, reply, value.metadata.phone_number_id);
                    await notifyTelegramOwner(from, rawText, reply, isGroup ? groupId : undefined);
                } catch (err) {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    logger.error(`[whatsapp] Error procesando mensaje de ${from}:`, errMsg);
                    await sendWhatsAppReply(replyTo, `❌ Error: ${errMsg.slice(0, 200)}`, value.metadata.phone_number_id).catch(() => {});
                }
            }
        }
    }
}

async function downloadWhatsAppMedia(mediaId: string): Promise<{ base64: string; mimeType: string }> {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
    if (!accessToken) throw new Error('WHATSAPP_ACCESS_TOKEN no configurado');

    const metaRes = await fetch(`https://graph.facebook.com/${WA_API_VERSION}/${mediaId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!metaRes.ok) throw new Error(`Meta media metadata error (${metaRes.status})`);
    const { url, mime_type } = (await metaRes.json()) as { url: string; mime_type: string };

    const imgRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!imgRes.ok) throw new Error(`Meta media download error (${imgRes.status})`);
    const base64 = Buffer.from(await imgRes.arrayBuffer()).toString('base64');
    return { base64, mimeType: mime_type };
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
                    image?: { id: string; mime_type: string; caption?: string };
                    video?: { id: string; mime_type: string; caption?: string };
                    group_id?: string;
                    context?: { group_id?: string; from?: string; id?: string };
                }>;
            };
        }>;
    }>;
}
