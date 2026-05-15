import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { consumePendingVideo } from '../../../../integrations/kie/pending-videos';
import { insertPending } from '../../../../integrations/tiktok/pending-posts';
import { sendTelegramChatMessage } from '../../../../integrations/telegram/send-message';
import { logger } from '../../../../core/logger';

function verifyKieSignature(body: string, req: NextRequest): boolean {
    const hmacKey = process.env.KIE_WEBHOOK_HMAC_KEY?.trim();
    if (!hmacKey) return true; // sin clave configurada → skip verificación

    // Kie puede usar cualquiera de estos headers
    const sig =
        req.headers.get('x-kie-signature') ??
        req.headers.get('x-hmac-signature') ??
        req.headers.get('x-signature');

    if (!sig) {
        logger.warn('[KIE-CALLBACK] sin header de firma — aceptando igual');
        return true; // cabecera aún desconocida; no bloqueamos
    }

    const expected = createHmac('sha256', hmacKey).update(body).digest('hex');
    return sig === expected;
}

function extractVideoUrl(body: Record<string, unknown>): string | undefined {
    // Intentar varios formatos de respuesta de Kie
    const resultJson = (body.resultJson ?? (body.data as Record<string, unknown>)?.resultJson) as string | undefined;
    if (resultJson) {
        try {
            const parsed = JSON.parse(resultJson);
            if (Array.isArray(parsed)) return parsed[0] as string;
            return (parsed as { resultUrls?: string[] }).resultUrls?.[0];
        } catch { /* continuar */ }
    }
    return (
        body.videoUrl ??
        body.url ??
        (body.data as Record<string, unknown>)?.videoUrl
    ) as string | undefined;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
    const rawBody = await req.text();

    if (!verifyKieSignature(rawBody, req)) {
        logger.warn('[KIE-CALLBACK] firma inválida — rechazando');
        return NextResponse.json({ ok: false, error: 'invalid signature' }, { status: 401 });
    }

    let body: Record<string, unknown>;
    try {
        body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
        return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
    }

    logger.info(`[KIE-CALLBACK] ${JSON.stringify(body).slice(0, 600)}`);

    const taskId = (
        body.taskId ??
        body.task_id ??
        (body.data as Record<string, unknown>)?.taskId
    ) as string | undefined;

    if (!taskId) {
        logger.warn('[KIE-CALLBACK] sin taskId en el body');
        return NextResponse.json({ ok: true });
    }

    const pending = await consumePendingVideo(taskId);
    if (!pending) {
        logger.warn(`[KIE-CALLBACK] taskId ${taskId} no encontrado en pending store`);
        return NextResponse.json({ ok: true });
    }

    const state = (
        body.state ??
        body.status ??
        (body.data as Record<string, unknown>)?.state
    ) as string | undefined;

    if (state === 'success' || state === 'Success') {
        const videoUrl = extractVideoUrl(body);

        if (videoUrl) {
            try {
                const id = await insertPending(
                    pending.chatId,
                    videoUrl,
                    pending.caption,
                    pending.privacy as 'PUBLIC_TO_EVERYONE'
                );
                await sendTelegramChatMessage(
                    pending.chatId,
                    `🎬 ¡Video listo! Propuesto para TikTok — ID: ${id}\n🔗 ${videoUrl}\n\nPara publicar: /tt_approve ${id}\nPara cancelar: /tt_reject ${id}`,
                    false
                );
            } catch (err) {
                logger.error(`[KIE-CALLBACK] error al proponer TikTok: ${err}`);
                await sendTelegramChatMessage(
                    pending.chatId,
                    `🎬 Video generado: ${videoUrl}\n\nDime "súbelo a TikTok" para publicarlo.`
                );
            }
        } else {
            await sendTelegramChatMessage(
                pending.chatId,
                '⚠️ Video generado pero Kie no envió la URL. Revisa kie.ai → Logs → Veo y copia el enlace manualmente.'
            );
        }
    } else {
        await sendTelegramChatMessage(
            pending.chatId,
            `❌ La generación del video falló en Kie.ai (estado: ${state ?? 'desconocido'}). Inténtalo de nuevo.`
        );
    }

    return NextResponse.json({ ok: true });
}
