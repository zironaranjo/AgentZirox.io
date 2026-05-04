import { NextResponse } from 'next/server';
import { processMessage } from '../../../core/agent';
import { initMemory } from '../../../core/memory';
import { logger } from '../../../core/logger';

export async function POST(req: Request) {
    // Parse body — return a clear 400 for non-JSON instead of a 500 crash
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json(
            { reply: 'Cuerpo inválido. Envía JSON: { "message": "hola", "chatId": "opcional" }' },
            { status: 400 }
        );
    }

    try {
        const raw = body as Record<string, unknown> | null;
        // Coerce message to string regardless of what the caller sends
        const rawMsg = raw?.message;
        const message = typeof rawMsg === 'string' ? rawMsg : rawMsg != null ? String(rawMsg) : '';
        const chatId = typeof raw?.chatId === 'string' ? raw.chatId : undefined;

        if (!message.trim()) {
            return NextResponse.json({ reply: 'Mensaje vacío.' }, { status: 400 });
        }

        // Optional API secret for external clients (Jarvis, etc.)
        // Skip check for same-origin requests (the web UI at the same domain is always trusted)
        const secret = process.env.WEB_API_SECRET?.trim();
        if (secret) {
            const host     = req.headers.get('host') ?? '';
            const referer  = req.headers.get('referer') ?? '';
            const origin   = req.headers.get('origin') ?? '';
            const isSameOrigin =
                (referer  && (referer.startsWith(`https://${host}`) || referer.startsWith(`http://${host}`))) ||
                (origin   && (origin  === `https://${host}`          || origin  === `http://${host}`));
            if (!isSameOrigin) {
                const auth = req.headers.get('x-api-secret') ?? '';
                if (auth !== secret) {
                    return NextResponse.json({ reply: 'No autorizado.' }, { status: 401 });
                }
            }
        }

        await initMemory();
        const resolvedChatId = chatId?.trim() || 'web';
        const reply = await processMessage(resolvedChatId, message.trim());
        return NextResponse.json({ reply });
    } catch (error) {
        logger.error('Error en /api/chat:', error);
        return NextResponse.json({ reply: 'Error interno.' }, { status: 500 });
    }
}
