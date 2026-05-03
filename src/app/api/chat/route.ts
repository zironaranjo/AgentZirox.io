import { NextResponse } from 'next/server';
import { processMessage } from '../../../core/agent';
import { logger } from '../../../core/logger';

export async function POST(req: Request) {
    try {
        const { message, chatId } = await req.json() as { message?: string; chatId?: string };

        if (!message?.trim()) {
            return NextResponse.json({ reply: 'Mensaje vacío.' }, { status: 400 });
        }

        // Optional API secret for external clients (voice desktop app, etc.)
        const secret = process.env.WEB_API_SECRET?.trim();
        if (secret) {
            const auth = req.headers.get('x-api-secret') ?? '';
            if (auth !== secret) {
                return NextResponse.json({ reply: 'No autorizado.' }, { status: 401 });
            }
        }

        const resolvedChatId = chatId?.trim() || 'web';
        const reply = await processMessage(resolvedChatId, message.trim());
        return NextResponse.json({ reply });
    } catch (error) {
        logger.error('Error en /api/chat:', error);
        return NextResponse.json({ reply: 'Error interno.' }, { status: 500 });
    }
}
