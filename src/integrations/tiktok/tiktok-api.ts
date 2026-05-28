const TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
// Dos modos de publicación:
//  - inbox (scope video.upload): el vídeo llega como BORRADOR; el usuario lo publica desde la app.
//  - direct (scope video.publish): publica directo, pero requiere pasar la auditoría del
//    Content Posting API de TikTok. Sin auditoría, solo permite SELF_ONLY (privado).
const TIKTOK_INBOX_INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/';
const TIKTOK_DIRECT_INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/video/init/';
const TIKTOK_CREATOR_INFO_URL = 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/';
const TIKTOK_USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/';

/** Modo de publicación efectivo. Default: inbox (borrador), seguro y sin auditoría. */
export function tiktokPostMode(): 'inbox' | 'direct' {
    return (process.env.TIKTOK_POST_MODE?.trim().toLowerCase() === 'direct') ? 'direct' : 'inbox';
}

/** Scopes a pedir en el OAuth. Configurable para añadir video.publish tras la auditoría. */
export function tiktokScopes(): string {
    const custom = process.env.TIKTOK_SCOPES?.trim();
    if (custom) return custom;
    return tiktokPostMode() === 'direct'
        ? 'user.info.basic,video.publish'
        : 'user.info.basic,video.upload';
}

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
        scope: tiktokScopes(),
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

export interface TikTokCreatorInfo {
    nickname?: string;
    username?: string;
    privacyOptions: string[];
    maxVideoDurationSec?: number;
    commentDisabled?: boolean;
    duetDisabled?: boolean;
    stitchDisabled?: boolean;
}

/**
 * Consulta la info del creador (también sirve para verificar que el token es válido y
 * qué niveles de privacidad permite la cuenta). NO publica nada.
 */
export async function getTikTokCreatorInfo(): Promise<TikTokCreatorInfo> {
    const token = await getAccessToken();
    const res = await fetch(TIKTOK_CREATOR_INFO_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({}),
    });
    const data = await res.json() as {
        data?: {
            creator_nickname?: string;
            creator_username?: string;
            privacy_level_options?: string[];
            max_video_post_duration_sec?: number;
            comment_disabled?: boolean;
            duet_disabled?: boolean;
            stitch_disabled?: boolean;
        };
        error?: { code?: string; message?: string };
    };
    if (!res.ok || (data.error?.code && data.error.code !== 'ok')) {
        throw new Error(`TikTok creator_info failed: ${data.error?.message ?? JSON.stringify(data)}`);
    }
    return {
        nickname: data.data?.creator_nickname,
        username: data.data?.creator_username,
        privacyOptions: data.data?.privacy_level_options ?? [],
        maxVideoDurationSec: data.data?.max_video_post_duration_sec,
        commentDisabled: data.data?.comment_disabled,
        duetDisabled: data.data?.duet_disabled,
        stitchDisabled: data.data?.stitch_disabled,
    };
}

export interface TikTokUserInfo {
    openId?: string;
    displayName?: string;
    avatarUrl?: string;
}

/**
 * Verifica que el access token es válido usando el scope user.info.basic
 * (disponible tanto en modo inbox como direct). No publica nada.
 */
export async function getTikTokUserInfo(): Promise<TikTokUserInfo> {
    const token = await getAccessToken();
    const url = `${TIKTOK_USER_INFO_URL}?fields=open_id,display_name,avatar_url`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json() as {
        data?: { user?: { open_id?: string; display_name?: string; avatar_url?: string } };
        error?: { code?: string; message?: string };
    };
    if (!res.ok || (data.error?.code && data.error.code !== 'ok')) {
        throw new Error(`TikTok user_info failed: ${data.error?.message ?? JSON.stringify(data)}`);
    }
    return {
        openId: data.data?.user?.open_id,
        displayName: data.data?.user?.display_name,
        avatarUrl: data.data?.user?.avatar_url,
    };
}

export async function publishTikTokVideo(
    videoUrl: string,
    caption: string,
    privacy: TikTokPrivacy
): Promise<{ publishId: string; mode: 'inbox' | 'direct' }> {
    const token = await getAccessToken();
    const mode = tiktokPostMode();

    // Descargar el video para usar FILE_UPLOAD (PULL_FROM_URL requiere dominio verificado)
    const dlRes = await fetch(videoUrl);
    if (!dlRes.ok) throw new Error(`No se pudo descargar el video de Kie: ${dlRes.status}`);
    const videoBuffer = Buffer.from(await dlRes.arrayBuffer());
    const videoSize = videoBuffer.length;

    // post_info: en direct, privacy_level es OBLIGATORIO. En inbox (borrador) no aplica.
    const postInfo: Record<string, unknown> = {
        title: caption.slice(0, 2200),
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        video_cover_timestamp_ms: 1000,
    };
    if (mode === 'direct') {
        postInfo.privacy_level = privacy;
    }

    const initUrl = mode === 'direct' ? TIKTOK_DIRECT_INIT_URL : TIKTOK_INBOX_INIT_URL;

    // 1. Iniciar subida
    const initRes = await fetch(initUrl, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({
            post_info: postInfo,
            source_info: {
                source: 'FILE_UPLOAD',
                video_size: videoSize,
                chunk_size: videoSize,
                total_chunk_count: 1,
            },
        }),
    });

    const initData = await initRes.json() as {
        data?: { publish_id?: string; upload_url?: string };
        error?: { code?: string; message?: string; log_id?: string };
    };

    if (!initRes.ok || (initData.error?.code && initData.error.code !== 'ok')) {
        throw new Error(`TikTok init failed: ${initData.error?.message ?? JSON.stringify(initData)}`);
    }

    const publishId = initData.data?.publish_id ?? '';
    const uploadUrl = initData.data?.upload_url;
    if (!uploadUrl) throw new Error('TikTok no devolvió upload_url');

    // 2. Subir el archivo
    const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
            'Content-Type': 'video/mp4',
            'Content-Range': `bytes 0-${videoSize - 1}/${videoSize}`,
            'Content-Length': String(videoSize),
        },
        body: videoBuffer,
    });

    if (!uploadRes.ok) {
        const body = await uploadRes.text();
        throw new Error(`TikTok upload failed: ${uploadRes.status} ${body.slice(0, 200)}`);
    }

    return { publishId, mode };
}
