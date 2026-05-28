import { NextResponse } from 'next/server';
import {
    isTikTokConfigured,
    tiktokPostMode,
    tiktokScopes,
    getTikTokCreatorInfo,
    getTikTokUserInfo,
} from '../../../../integrations/tiktok/tiktok-api';

/**
 * Diagnóstico de TikTok sin publicar nada.
 * GET /api/tiktok/status → indica si está configurado, el modo (inbox/direct),
 * los scopes, y si el token es válido (consultando creator_info).
 */
export async function GET() {
    const configured = isTikTokConfigured();
    const mode = tiktokPostMode();
    const scopes = tiktokScopes();

    const base = {
        configured,
        mode,
        scopes,
        hint:
            mode === 'inbox'
                ? 'Modo BORRADOR: el vídeo llega a TikTok como borrador; lo publicas desde la app. Para publicar directo necesitas la auditoría del Content Posting API y TIKTOK_POST_MODE=direct.'
                : 'Modo DIRECTO: publica sin pasar por la app. Requiere scope video.publish y auditoría aprobada por TikTok (si no, solo SELF_ONLY).',
    };

    if (!configured) {
        return NextResponse.json(
            {
                ...base,
                tokenValid: false,
                error: 'TikTok no está configurado. Faltan TIKTOK_CLIENT_KEY/SECRET y TIKTOK_ACCESS_TOKEN o TIKTOK_REFRESH_TOKEN. Autoriza en /api/tiktok/auth.',
            },
            { status: 200 }
        );
    }

    // Verificación del token compatible con el scope actual:
    //  - inbox  → user.info.basic (getTikTokUserInfo). El borrador funciona con este scope.
    //  - direct → creator_info (requiere video.publish + auditoría).
    try {
        const user = await getTikTokUserInfo();
        const result: Record<string, unknown> = {
            ...base,
            tokenValid: true,
            account: {
                displayName: user.displayName ?? null,
                openId: user.openId ?? null,
            },
            canUploadDraft: true,
        };

        // Solo en modo direct intentamos creator_info (capacidad de publicación directa).
        if (mode === 'direct') {
            try {
                const info = await getTikTokCreatorInfo();
                result.privacyOptions = info.privacyOptions;
                result.maxVideoDurationSec = info.maxVideoDurationSec ?? null;
                result.canPostPublic = info.privacyOptions.includes('PUBLIC_TO_EVERYONE');
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                result.directPostReady = false;
                result.directPostError =
                    'El token no tiene video.publish o la app no está auditada. Re-autoriza en /api/tiktok/auth con TIKTOK_POST_MODE=direct tras aprobar la auditoría. Detalle: ' + msg;
            }
        }

        return NextResponse.json(result, { status: 200 });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json(
            {
                ...base,
                tokenValid: false,
                error: msg,
            },
            { status: 200 }
        );
    }
}
