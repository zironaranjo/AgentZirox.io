import { NextResponse } from 'next/server';
import { getTikTokAuthUrl } from '../../../../integrations/tiktok/tiktok-api';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL?.trim() || 'https://ziro.zirox.io';

export async function GET() {
    const redirectUri = `${BASE_URL}/api/tiktok/callback`;
    const state = Math.random().toString(36).slice(2, 10);
    const authUrl = getTikTokAuthUrl(redirectUri, state);
    return NextResponse.redirect(authUrl);
}
