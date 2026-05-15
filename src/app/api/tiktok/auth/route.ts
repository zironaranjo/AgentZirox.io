import { NextResponse } from 'next/server';
import { getTikTokAuthUrl } from '../../../../integrations/tiktok/tiktok-api';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL?.trim() || 'https://ziro.zirox.io';

export async function GET() {
    const clientKey = process.env.TIKTOK_CLIENT_KEY?.trim();
    if (!clientKey) {
        return NextResponse.json(
            { error: 'TIKTOK_CLIENT_KEY no está configurada en las variables de entorno del servidor.' },
            { status: 500 }
        );
    }

    const redirectUri = `${BASE_URL}/api/tiktok/callback`;
    const state = Math.random().toString(36).slice(2, 10);
    const authUrl = getTikTokAuthUrl(redirectUri, state);
    return NextResponse.redirect(authUrl);
}
