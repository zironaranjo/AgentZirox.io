import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { initMemory } from '../../../../core/memory';
import { consumePendingVideo } from '../../../../integrations/kie/pending-videos';
import { insertPending } from '../../../../integrations/tiktok/pending-posts';
import { sendTelegramChatMessage } from '../../../../integrations/telegram/send-message';
import { logger } from '../../../../core/logger';

function verifyKieSignature(body: string, req: NextRequest): boolean {
    const hmacKey = process.env.KIE_WEBHOOK_HMAC_KEY?.trim();
    if (!hmacKey) return true;

    const sig =
        req.headers.get('x-kie-signature') ??
        req.headers.get('x-hmac-signature') ??
        req.headers.get('x-signature');

    if (!sig) {
        logger.warn('[KIE-CALLBACK] sin header de firma — aceptando igual');
        return true;
    }

    const expected = createHmac('sha256', hmacKey).update(body).digest('hex');
    return sig === expected;
}

type KieCallbackData = {
    taskId?: string;
    state?: string;
    resultJson?: string;
    info?: {
        resultUrls?: string[];
        result_urls?: string[];
        originUrls?: string[];
    };
};

function extractTaskId(body: Record<string, unknown>, data: KieCallbackData): string | undefined {
    // 1. Campo directo
    if (body.taskId) return body.taskId as string;
    if (data.taskId) return data.taskId;

    // 2. Extraer del nombre de archivo en originUrls (patrón: /{taskId}_{ts}.mp4)
    const originUrl = data.info?.originUrls?.[0];
    if (originUrl) {
        const m = originUrl.match(/\/([a-f0-9]{32})_\d+\.mp4/i);
        if (m) return m[1];
    }

    return undefined;
}

function extractVideoUrl(data: KieCallbackData): string | undefined {
    // resultUrls / result_urls dentro de info
    const url = data.info?.resultUrls?.[0] ?? data.info?.result_urls?.[0];
    if (url) return url;

    // resultJson legacy (imágenes)
    if (data.resultJson) {
        try {
            const parsed = JSON.parse(data.resultJson);
            if (Array.isArray(parsed)) return parsed[0] as string;
            return (parsed as { resultUrls?: string[] }).resultUrls?.[0];
        } catch { /* ignorar */ }
    }

    return undefined;
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

    logger.info(`[KIE-CALLBACK] ${rawBody.slice(0, 600)}`);

    // Inicializar memory (Next.js no llama initMemory automáticamente)
    await initMemory();

    const data = (body.data ?? {}) as KieCallbackData;
    const taskId = extractTaskId(body, data);

    if (!taskId) {
        logger.warn('[KIE-CALLBACK] no se pudo extraer taskId');
        return NextResponse.json({ ok: true });
    }

    const pending = await consumePendingVideo(taskId);
    if (!pending) {
        logger.warn(`[KIE-CALLBACK] taskId ${taskId} no encontrado en pending store`);
        return NextResponse.json({ ok: true });
    }

    const code = body.code as number | undefined;
    const videoUrl = extractVideoUrl(data);

    // code 200 + resultUrls = éxito
    if (code === 200 && videoUrl) {
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
        const state = data.state ?? (code !== 200 ? `error code ${code}` : 'desconocido');
        await sendTelegramChatMessage(
            pending.chatId,
            `❌ La generación del video falló en Kie.ai (estado: ${state}). Inténtalo de nuevo.`
        );
    }

    return NextResponse.json({ ok: true });
}
