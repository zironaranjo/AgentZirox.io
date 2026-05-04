import { readFile, unlink } from 'node:fs/promises';
import { getMeta, setMeta } from '../../core/memory';

const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';
const UGC_POSTS_URL = 'https://api.linkedin.com/v2/ugcPosts';
const REGISTER_UPLOAD_URL = 'https://api.linkedin.com/v2/assets?action=registerUpload';
const MAX_LINKEDIN_IMAGE_BYTES = 12 * 1024 * 1024;
const LINKEDIN_TIMEOUT_MS = 30_000;
const LINKEDIN_UPLOAD_TIMEOUT_MS = 90_000;

const META_PERSON_URN = 'linkedin_person_urn';

function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LINKEDIN_TIMEOUT_MS);
    return fetch(url, { ...options, signal: controller.signal }).finally(() =>
        clearTimeout(timer)
    );
}

let accessTokenCache: { token: string; expiresAtMs: number } | null = null;

function parseExpiresAtMsFromEnv(): number | null {
    const raw = process.env.LINKEDIN_ACCESS_TOKEN_EXPIRES_AT_MS?.trim();
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
}

/**
 * OAuth listo si hay access token estático (LinkedIn a veces no devuelve refresh_token)
 * o si hay client_id + secret + refresh_token.
 */
export function isLinkedInOAuthConfigured(): boolean {
    if (process.env.LINKEDIN_ACCESS_TOKEN?.trim()) {
        return true;
    }
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

    const res = await fetchWithTimeout(TOKEN_URL, {
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
    const staticToken = process.env.LINKEDIN_ACCESS_TOKEN?.trim();
    if (staticToken) {
        const exp = parseExpiresAtMsFromEnv();
        if (exp != null && Date.now() >= exp - 120_000) {
            throw new Error(
                'LinkedIn: LINKEDIN_ACCESS_TOKEN caducado. Ejecuta de nuevo el flujo OAuth (code → accessToken) y actualiza .env; ver README.'
            );
        }
        return staticToken;
    }

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
        const cached = await getMeta(META_PERSON_URN);
        if (cached?.startsWith('urn:li:person:')) {
            return cached;
        }
    } catch {
        /* DB no lista */
    }

    const token = await getLinkedInAccessToken();
    const res = await fetchWithTimeout(USERINFO_URL, {
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
        await setMeta(META_PERSON_URN, urn);
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
type RegisterUploadValue = {
    uploadMechanism?: {
        'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'?: {
            uploadUrl?: string;
            headers?: Record<string, string | string[]>;
        };
    };
    asset?: string;
};

async function registerLinkedInFeedImageUpload(
    token: string,
    ownerUrn: string
): Promise<{ uploadUrl: string; asset: string; uploadHeaders: Record<string, string> }> {
    const body = {
        registerUploadRequest: {
            owner: ownerUrn,
            recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
            serviceRelationships: [
                {
                    relationshipType: 'OWNER',
                    identifier: 'urn:li:userGeneratedContent',
                },
            ],
            supportedUploadMechanism: ['SYNCHRONOUS_UPLOAD'],
        },
    };

    const res = await fetchWithTimeout(REGISTER_UPLOAD_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'X-Restli-Protocol-Version': '2.0.0',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    const raw = await res.text();
    if (!res.ok) {
        throw new Error(`LinkedIn registerUpload ${res.status}: ${raw.slice(0, 700)}`);
    }

    let parsed: { value?: RegisterUploadValue };
    try {
        parsed = JSON.parse(raw) as { value?: RegisterUploadValue };
    } catch {
        throw new Error(`registerUpload no JSON: ${raw.slice(0, 300)}`);
    }

    const mech = parsed.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'];
    const uploadUrl = mech?.uploadUrl;
    const asset = parsed.value?.asset;
    if (!uploadUrl || !asset) {
        throw new Error(`registerUpload respuesta incompleta: ${raw.slice(0, 500)}`);
    }

    const uploadHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(mech.headers ?? {})) {
        uploadHeaders[k] = Array.isArray(v) ? v.join(', ') : String(v);
    }

    return { uploadUrl, asset, uploadHeaders };
}

async function putBytesToLinkedInUpload(
    uploadUrl: string,
    uploadHeaders: Record<string, string>,
    bytes: Buffer,
    imageContentType?: string | null
): Promise<void> {
    const h = new Headers();
    for (const [k, v] of Object.entries(uploadHeaders)) {
        h.set(k, v);
    }
    if (!h.has('Content-Type')) {
        const ct = imageContentType?.startsWith('image/') ? imageContentType : null;
        h.set('Content-Type', ct ?? 'application/octet-stream');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LINKEDIN_UPLOAD_TIMEOUT_MS);
    const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: h,
        body: new Uint8Array(bytes),
        signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (!putRes.ok) {
        const t = await putRes.text();
        throw new Error(`LinkedIn PUT imagen ${putRes.status}: ${t.slice(0, 500)}`);
    }
}

async function publishLinkedInPostWithImage(
    text: string,
    visibility: LinkedInVisibility,
    imageUrl: string
): Promise<{ restLiId: string | null; rawBody: string }> {
    const token = await getLinkedInAccessToken();
    const author = await getLinkedInPersonUrn();

    let buf: Buffer;
    let dlCt: string | null = null;

    if (imageUrl.startsWith('file://')) {
        // Image was cached to disk at propose time to avoid URL expiry
        const filePath = imageUrl.slice('file://'.length);
        buf = await readFile(filePath);
        unlink(filePath).catch(() => {});
    } else {
        const imgRes = await fetchWithTimeout(imageUrl, { redirect: 'follow' });
        if (!imgRes.ok) {
            throw new Error(`No se pudo descargar la imagen (${imgRes.status}) desde la URL.`);
        }
        buf = Buffer.from(await imgRes.arrayBuffer());
        dlCt = imgRes.headers.get('content-type')?.split(';')[0]?.trim() ?? null;
    }

    if (buf.length > MAX_LINKEDIN_IMAGE_BYTES) {
        throw new Error(`Imagen demasiado grande (${buf.length} bytes). Max ~12 MB.`);
    }

    const { uploadUrl, asset, uploadHeaders } = await registerLinkedInFeedImageUpload(token, author);
    await putBytesToLinkedInUpload(uploadUrl, uploadHeaders, buf, dlCt);

    const payload = {
        author,
        lifecycleState: 'PUBLISHED',
        specificContent: {
            'com.linkedin.ugc.ShareContent': {
                shareCommentary: { text },
                shareMediaCategory: 'IMAGE',
                media: [
                    {
                        status: 'READY',
                        media: asset,
                    },
                ],
            },
        },
        visibility: {
            'com.linkedin.ugc.MemberNetworkVisibility': visibility,
        },
    };

    const res = await fetchWithTimeout(UGC_POSTS_URL, {
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
        throw new Error(`LinkedIn ugcPosts (imagen) ${res.status}: ${rawBody.slice(0, 800)}`);
    }

    return { restLiId, rawBody: rawBody.slice(0, 500) };
}

/**
 * Publica en el feed: solo texto o texto + imagen (URL publica descargable por el servidor).
 */
export async function publishLinkedInFeedPost(
    text: string,
    visibility: LinkedInVisibility,
    imageUrl?: string | null
): Promise<{ restLiId: string | null; rawBody: string }> {
    if (imageUrl?.trim()) {
        return publishLinkedInPostWithImage(text, visibility, imageUrl.trim());
    }
    return publishLinkedInTextPost(text, visibility);
}

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

    const res = await fetchWithTimeout(UGC_POSTS_URL, {
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
