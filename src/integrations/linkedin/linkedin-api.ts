import { getMeta, setMeta } from '../../core/memory';

const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';
const UGC_POSTS_URL = 'https://api.linkedin.com/v2/ugcPosts';

const META_PERSON_URN = 'linkedin_person_urn';

let accessTokenCache: { token: string; expiresAtMs: number } | null = null;

export function isLinkedInOAuthConfigured(): boolean {
    return Boolean(
        process.env.LINKEDIN_CLIENT_ID?.trim() &&
            process.env.LINKEDIN_CLIENT_SECRET?.trim() &&
            process.env.LINKEDIN_REFRESH_TOKEN?.trim()
    );
}

async function refreshAccessToken(): Promise<string> {
    const clientId = process.env.LINKEDIN_CLIENT_ID?.trim();
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET?.trim();
    const refreshToken = process.env.LINKEDIN_REFRESH_TOKEN?.trim();
    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error(
            'LinkedIn: faltan LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET o LINKEDIN_REFRESH_TOKEN en el entorno.'
        );
    }

    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
    });

    const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });

    const raw = await res.text();
    if (!res.ok) {
        throw new Error(
            `LinkedIn: no se pudo renovar el access token (${res.status}). Revisa credenciales y scopes. ${raw.slice(0, 500)}`
        );
    }

    let data: {
        access_token: string;
        expires_in?: number;
        refresh_token?: string;
    };
    try {
        data = JSON.parse(raw) as {
            access_token: string;
            expires_in?: number;
            refresh_token?: string;
        };
    } catch {
        throw new Error(`LinkedIn: respuesta de token no es JSON: ${raw.slice(0, 200)}`);
    }

    if (!data.access_token) {
        throw new Error('LinkedIn: respuesta de token sin access_token.');
    }

    const ttlSec = data.expires_in ?? 3600;
    accessTokenCache = {
        token: data.access_token,
        expiresAtMs: Date.now() + ttlSec * 1000,
    };

    if (data.refresh_token) {
        // LinkedIn puede rotar el refresh token; conviene actualizar .env manualmente.
        // No escribimos .env desde aquí.
    }

    return accessTokenCache.token;
}

export async function getLinkedInAccessToken(): Promise<string> {
    if (accessTokenCache && Date.now() < accessTokenCache.expiresAtMs - 120_000) {
        return accessTokenCache.token;
    }
    return refreshAccessToken();
}

/**
 * Person URN para ugcPosts: openid `sub` → urn:li:person:{sub}
 */
export async function getLinkedInPersonUrn(): Promise<string> {
    const fromEnv = process.env.LINKEDIN_PERSON_URN?.trim();
    if (fromEnv?.startsWith('urn:li:person:')) {
        return fromEnv;
    }

    try {
        const cached = getMeta(META_PERSON_URN);
        if (cached?.startsWith('urn:li:person:')) {
            return cached;
        }
    } catch {
        /* DB no lista */
    }

    const token = await getLinkedInAccessToken();
    const res = await fetch(USERINFO_URL, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const raw = await res.text();
    if (!res.ok) {
        throw new Error(
            `LinkedIn userinfo falló (${res.status}). Necesitas scopes openid y profile (Sign In with LinkedIn). ${raw.slice(0, 400)}`
        );
    }
    const j = JSON.parse(raw) as { sub?: string };
    if (!j.sub) {
        throw new Error('LinkedIn userinfo: falta sub (person id).');
    }
    const urn = `urn:li:person:${j.sub}`;
    try {
        setMeta(META_PERSON_URN, urn);
    } catch {
        /* ignore */
    }
    return urn;
}

export type LinkedInVisibility = 'PUBLIC' | 'CONNECTIONS';

/**
 * Publica un post de solo texto (feed) vía UGC API.
 * Requiere producto "Share on LinkedIn" en la app y scope w_member_social.
 */
export async function publishLinkedInTextPost(
    text: string,
    visibility: LinkedInVisibility
): Promise<{ restLiId: string | null; rawBody: string }> {
    const token = await getLinkedInAccessToken();
    const author = await getLinkedInPersonUrn();

    const payload = {
        author,
        lifecycleState: 'PUBLISHED',
        specificContent: {
            'com.linkedin.ugc.ShareContent': {
                shareCommentary: { text },
                shareMediaCategory: 'NONE',
            },
        },
        visibility: {
            'com.linkedin.ugc.MemberNetworkVisibility': visibility,
        },
    };

    const res = await fetch(UGC_POSTS_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'X-Restli-Protocol-Version': '2.0.0',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    const restLiId = res.headers.get('x-restli-id');
    const rawBody = await res.text();

    if (!res.ok) {
        throw new Error(
            `LinkedIn ugcPosts ${res.status}: ${rawBody.slice(0, 800)}`
        );
    }

    return { restLiId, rawBody: rawBody.slice(0, 500) };
}
