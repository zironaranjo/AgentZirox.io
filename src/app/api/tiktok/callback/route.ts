import { NextRequest, NextResponse } from 'next/server';
import { exchangeTikTokCode } from '../../../../integrations/tiktok/tiktok-api';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL?.trim() || 'https://ziro.zirox.io';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    if (error || !code) {
        return new NextResponse(`TikTok auth error: ${error ?? 'no code recibido'}`, { status: 400 });
    }

    try {
        const redirectUri = `${BASE_URL}/api/tiktok/callback`;
        const tokens = await exchangeTikTokCode(code, redirectUri);
        const expiresAtMs = Date.now() + tokens.expires_in * 1000;
        const refreshExpiresAtMs = Date.now() + tokens.refresh_expires_in * 1000;

        const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>TikTok autorizado</title></head>
<body style="font-family:monospace;padding:24px;background:#0a0a0a;color:#00ff88;max-width:700px">
<h2>✅ TikTok autorizado correctamente</h2>
<p>Añade estas variables de entorno en <strong>Dokploy</strong> y haz redeploy:</p>
<pre style="background:#111;padding:16px;border-radius:8px;border:1px solid #333;white-space:pre-wrap;word-break:break-all">TIKTOK_CLIENT_KEY=${process.env.TIKTOK_CLIENT_KEY ?? ''}
TIKTOK_CLIENT_SECRET=${process.env.TIKTOK_CLIENT_SECRET ?? ''}
TIKTOK_ACCESS_TOKEN=${tokens.access_token}
TIKTOK_REFRESH_TOKEN=${tokens.refresh_token}
TIKTOK_OPEN_ID=${tokens.open_id}
TIKTOK_ACCESS_TOKEN_EXPIRES_AT_MS=${expiresAtMs}</pre>
<p style="color:#aaa">Access token expira: ${new Date(expiresAtMs).toLocaleString('es-ES')}</p>
<p style="color:#aaa">Refresh token expira: ${new Date(refreshExpiresAtMs).toLocaleString('es-ES')}</p>
<p style="color:#ff6">⚠️ Guarda el TIKTOK_REFRESH_TOKEN — lo necesitarás para renovar el access token automáticamente.</p>
</body></html>`;

        return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return new NextResponse(`Error: ${msg}`, { status: 500 });
    }
}
