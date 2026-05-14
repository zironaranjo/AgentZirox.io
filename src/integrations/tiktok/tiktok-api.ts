const TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_VIDEO_INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/video/init/';

export function isTikTokConfigured(): boolean {
    return Boolean(
        process.env.TIKTOK_CLIENT_KEY?.trim() &&
        process.env.TIKTOK_CLIENT_SECRET?.trim() &&
        (process.env.TIKTOK_ACCESS_TOKEN?.trim() || process.env.TIKTOK_REFRESH_TOKEN?.trim())
    );
}

export function getTikTokAuthUrl(redirectUri: string, state: string): string {
    const params = new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY ?? '',
        scope: 'user.info.basic,video.publish',
        response_type: 'code',
        redirect_uri: redirectUri,
        state,
    });
    return `${TIKTOK_AUTH_URL}?${params.toString()}`;
}

export async function exchangeTikTokCode(code: string, redirectUri: string): Promise<{
    access_token: string;
    refresh_token: string;
    open_id: string;
    expires_in: number;
    refresh_expires_in: number;
}> {
    const res = await fetch(TIKTOK_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_key: process.env.TIKTOK_CLIENT_KEY ?? '',
            client_secret: process.env.TIKTOK_CLIENT_SECRET ?? '',
            code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
        }).toString(),
    });
    const data = await res.json() as {
        access_token?: string; refresh_token?: string; open_id?: string;
        expires_in?: number; refresh_expires_in?: number;
        error?: string; error_description?: string;
    };
    if (!res.ok || data.error) {
        throw new Error(`TikTok token exchange failed: ${data.error_description ?? JSON.stringify(data)}`);
    }
    return {
        access_token: data.access_token!,
        refresh_token: data.refresh_token!,
        open_id: data.open_id!,
        expires_in: data.expires_in ?? 86400,
        refresh_expires_in: data.refresh_expires_in ?? 2592000,
    };
}

let tokenCache: { token: string; expiresAtMs: number } | null = null;

async function getAccessToken(): Promise<string> {
    const now = Date.now();

    if (tokenCache && tokenCache.expiresAtMs > now + 60_000) return tokenCache.token;

    const staticToken = process.env.TIKTOK_ACCESS_TOKEN?.trim();
    if (staticToken) {
        const expiresAt = parseInt(process.env.TIKTOK_ACCESS_TOKEN_EXPIRES_AT_MS ?? '0', 10) || (now + 86_400_000);
        if (expiresAt > now + 60_000) {
            tokenCache = { token: staticToken, expiresAtMs: expiresAt };
            return staticToken;
        }
    }

    const refreshToken = process.env.TIKTOK_REFRESH_TOKEN?.trim();
    if (!refreshToken) {
        throw new Error('TikTok no configurado. Visita https://ziro.zirox.io/api/tiktok/auth para autorizar.');
    }

    const res = await fetch(TIKTOK_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_key: process.env.TIKTOK_CLIENT_KEY ?? '',
            client_secret: process.env.TIKTOK_CLIENT_SECRET ?? '',
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
        }).toString(),
    });
    const data = await res.json() as {
        access_token?: string; expires_in?: number;
        error?: string; error_description?: string;
    };
    if (!res.ok || data.error) {
        throw new Error(`TikTok refresh failed: ${data.error_description ?? JSON.stringify(data)}`);
    }

    const newToken = data.access_token!;
    const expiresInMs = (data.expires_in ?? 86400) * 1000;
    tokenCache = { token: newToken, expiresAtMs: now + expiresInMs };
    return newToken;
}

export type TikTokPrivacy =
    | 'PUBLIC_TO_EVERYONE'
    | 'MUTUAL_FOLLOW_FRIENDS'
    | 'FOLLOWER_OF_CREATOR'
    | 'SELF_ONLY';

export async function publishTikTokVideo(
    videoUrl: string,
    caption: string,
    privacy: TikTokPrivacy
): Promise<{ publishId: string }> {
    const token = await getAccessToken();

    const res = await fetch(TIKTOK_VIDEO_INIT_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({
            post_info: {
                title: caption.slice(0, 2200),
                privacy_level: privacy,
                disable_duet: false,
                disable_comment: false,
                disable_stitch: false,
                video_cover_timestamp_ms: 1000,
            },
            source_info: {
                source: 'PULL_FROM_URL',
                video_url: videoUrl,
            },
        }),
    });

    const data = await res.json() as {
        data?: { publish_id?: string };
        error?: { code?: string; message?: string; log_id?: string };
    };

    if (!res.ok || (data.error?.code && data.error.code !== 'ok')) {
        throw new Error(`TikTok publish failed: ${data.error?.message ?? JSON.stringify(data)}`);
    }

    return { publishId: data.data?.publish_id ?? '' };
}
