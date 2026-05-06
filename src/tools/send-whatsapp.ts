import { registerTool } from '../core/dispatcher';

const WA_API_VERSION = 'v19.0';

registerTool({
    name: 'send_whatsapp',
    description:
        'Envía un mensaje de WhatsApp a un número de teléfono usando la API de Meta (WhatsApp Business). El número debe estar en formato internacional sin + ni espacios (ej: 34612345678). Requiere WHATSAPP_PHONE_NUMBER_ID y WHATSAPP_ACCESS_TOKEN configurados.',
    parameters: {
        type: 'object',
        properties: {
            to: {
                type: 'string',
                description: 'Número de teléfono destino en formato internacional sin + (ej: 34612345678)',
            },
            message: {
                type: 'string',
                description: 'Texto del mensaje a enviar',
            },
        },
        required: ['to', 'message'],
    },
    handler: async (args) => {
        const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
        const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();

        if (!phoneNumberId || !accessToken) {
            return '❌ WhatsApp no configurado. Añade WHATSAPP_PHONE_NUMBER_ID y WHATSAPP_ACCESS_TOKEN en las variables de entorno (Dokploy).';
        }

        const to = String(args.to ?? '').replace(/[\s+\-()]/g, '');
        const message = String(args.message ?? '').trim();
        if (!to) throw new Error('to es obligatorio (número en formato internacional)');
        if (!message) throw new Error('message es obligatorio');

        const url = `https://graph.facebook.com/${WA_API_VERSION}/${phoneNumberId}/messages`;
        const body = {
            messaging_product: 'whatsapp',
            to,
            type: 'text',
            text: { body: message },
        };

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        const raw = await res.text();
        if (!res.ok) {
            throw new Error(`WhatsApp API error (${res.status}): ${raw.slice(0, 500)}`);
        }

        const data = JSON.parse(raw) as { messages?: Array<{ id?: string }> };
        const msgId = data.messages?.[0]?.id ?? '(sin ID)';

        return `✅ WhatsApp enviado a +${to}\n🆔 Message ID: ${msgId}\n💬 "${message.slice(0, 80)}${message.length > 80 ? '…' : ''}"`;
    },
});
