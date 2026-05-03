import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { registerTool } from '../core/dispatcher';
import {
    insertLinkedInPendingPost,
    getLinkedInPendingPostForChat,
    listLinkedInPendingPostsForChat,
    setLinkedInPendingPublished,
    setLinkedInPendingFailed,
} from '../core/memory';
import { getToolContext } from '../core/tool-context';
import {
    isLinkedInOAuthConfigured,
    publishLinkedInFeedPost,
} from '../integrations/linkedin/linkedin-api';
import { sendTelegramChatMessage } from '../integrations/telegram/send-message';
import { getWorkspaceBaseDir, resolveSafeWorkspacePath } from './workspace-utils';

const DRAFTS_DIR = 'linkedin/drafts';
/** Límite aproximado de caracteres para un post de texto en el feed de LinkedIn. */
const LINKEDIN_POST_MAX_CHARS = 2900;

function assertPublicHttpsImageUrl(raw: string): string {
    const u = raw.trim();
    let url: URL;
    try {
        url = new URL(u);
    } catch {
        throw new Error('image_url no es una URL valida');
    }
    if (url.protocol !== 'https:') {
        throw new Error('image_url debe ser HTTPS (URL publica descargable por el servidor).');
    }
    return u;
}

function slugify(input: string, maxLen: number): string {
    const s = input
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, maxLen);
    return s || 'borrador';
}

registerTool({
    name: 'linkedin_save_draft',
    description:
        'Guardar borrador en el workspace (markdown linkedin/drafts/). NO usar si el usuario pide publicar/subir/compartir en LinkedIn con el agente (en ese caso linkedin_propose_post + /li_approve). Solo cuando quiera archivo en VPS, copia local o revisar antes de publicar el mismo a mano.',
    parameters: {
        type: 'object',
        properties: {
            kind: {
                type: 'string',
                enum: ['post', 'headline', 'about', 'comment', 'connection_message', 'other'],
                description:
                    'Tipo de contenido: post (publicacion), headline (titular), about (seccion Acerca de), comment, connection_message (invitacion), other',
            },
            body: {
                type: 'string',
                description: 'Texto del borrador tal como debe quedar (puede incluir parrafos; el agente ya lo habra pulido si hace falta)',
            },
            title_hint: {
                type: 'string',
                description:
                    'Etiqueta corta opcional para el nombre del archivo, ej. lanzamiento-producto, reflexion-liderazgo',
            },
            context: {
                type: 'string',
                description:
                    'Notas opcionales: publico objetivo, tono, hashtags sugeridos, etc. (se guardan al final del archivo)',
            },
        },
        required: ['kind', 'body'],
    },
    handler: async (args) => {
        const { kind, body, title_hint, context } = args as {
            kind: string;
            body: string;
            title_hint?: string;
            context?: string;
        };

        const text = body.trim();
        if (!text) {
            throw new Error('body vacio');
        }

        const now = new Date();
        const fecha = now.toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
        const fechaArchivo = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
        const hora = now.toLocaleTimeString('sv-SE', {
            timeZone: 'Europe/Madrid',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        });

        const slug = slugify(title_hint?.trim() || text.replace(/\n/g, ' '), 48);
        const relativePath = path.posix.join(DRAFTS_DIR, `${fechaArchivo}_${hora.replace(/:/g, '')}_${kind}_${slug}.md`);
        const target = resolveSafeWorkspacePath(relativePath);
        await mkdir(path.dirname(target), { recursive: true });

        const front = [
            '---',
            `kind: ${kind}`,
            `created_madrid: ${fecha}`,
            'source: agentezirox',
            '---',
            '',
        ].join('\n');

        const tail =
            context?.trim() ?
                ['', '## Contexto / notas', '', context.trim(), ''].join('\n')
            :   '';

        await writeFile(target, `${front}${text}${tail}`, 'utf8');

        return [
            '✅ Borrador de LinkedIn guardado en el workspace.',
            `📁 Base: ${getWorkspaceBaseDir()}`,
            `📄 ${relativePath}`,
            '',
            'Puedes abrir el archivo en el VPS o pedir read_file con esa ruta. Si tienes OAuth LinkedIn configurado, para publicar con tu aprobacion usa linkedin_propose_post y luego /li_approve en Telegram.',
        ].join('\n');
    },
});

registerTool({
    name: 'linkedin_propose_post',
    description:
        'Cola de publicacion en el feed de LinkedIn: usar cuando el usuario quiera publicar, subir o compartir un post (aunque no nombre la tool). Requiere chat vinculado (Telegram). Opcional image_url HTTPS tras generate_image. OBLIGATORIO si piden imagen+post: llamar generate_image antes y pasar su URL aqui. Nunca digas publicado hasta /li_approve. Texto sin markdown Telegram. visibility PUBLIC o CONNECTIONS.',
    parameters: {
        type: 'object',
        properties: {
            post_text: {
                type: 'string',
                description: 'Texto final del post (sin envolver en comillas extras). Maximo ~2900 caracteres.',
            },
            visibility: {
                type: 'string',
                enum: ['PUBLIC', 'CONNECTIONS'],
                description: 'PUBLIC (recomendado para alcance) o CONNECTIONS (solo tu red cercana)',
            },
            image_url: {
                type: 'string',
                description:
                    'Opcional. URL HTTPS publica de la imagen (el servidor la descarga y la sube a LinkedIn). Usar la URL exacta de generate_image u otro hosting directo.',
            },
        },
        required: ['post_text'],
    },
    handler: async (args) => {
        const { post_text, visibility: visRaw, image_url: imageRaw } = args as {
            post_text: string;
            visibility?: string;
            image_url?: string;
        };

        const tctx = getToolContext();
        if (!tctx?.chatId) {
            throw new Error(
                'linkedin_propose_post solo esta disponible cuando hay un chat vinculado (p. ej. Telegram). Desde la web usa linkedin_save_draft.'
            );
        }

        if (!isLinkedInOAuthConfigured()) {
            return [
                '⚠️ LinkedIn OAuth no esta configurado en el servidor.',
                'Configura LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET y LINKEDIN_REFRESH_TOKEN (ver README).',
                'Mientras tanto puedes usar linkedin_save_draft para guardar el texto en el workspace.',
            ].join('\n');
        }

        const text = post_text.trim();
        if (!text) {
            throw new Error('post_text vacio');
        }
        if (text.length > LINKEDIN_POST_MAX_CHARS) {
            throw new Error(
                `Post demasiado largo (${text.length} caracteres). Acorta a ${LINKEDIN_POST_MAX_CHARS} o menos.`
            );
        }

        const visibility = visRaw === 'CONNECTIONS' ? 'CONNECTIONS' : 'PUBLIC';

        // Download image immediately — KIE/GCS URLs expire in seconds, so cache to disk.
        let resolvedImageUrl: string | null = null;
        if (imageRaw?.trim()) {
            const validated = assertPublicHttpsImageUrl(imageRaw);
            try {
                const imgRes = await fetch(validated, { redirect: 'follow' });
                if (imgRes.ok) {
                    const buf = Buffer.from(await imgRes.arrayBuffer());
                    const tmpPath = `/tmp/li_img_${randomUUID()}.bin`;
                    await writeFile(tmpPath, buf);
                    resolvedImageUrl = `file://${tmpPath}`;
                } else {
                    resolvedImageUrl = validated; // fallback, will fail at publish but not silently wrong
                }
            } catch {
                resolvedImageUrl = validated;
            }
        }

        const id = await insertLinkedInPendingPost(tctx.chatId, text, visibility, resolvedImageUrl);

        // Envío directo para que el ID siempre llegue aunque el LLM reescriba la respuesta
        // Sin parse_mode Markdown para evitar que _ en comandos se interprete como cursiva
        sendTelegramChatMessage(
            tctx.chatId,
            `📋 Post LinkedIn en cola — ID: ${id}\nPara publicar: /li_approve ${id}\nPara cancelar: /li_reject ${id}`,
            false
        ).catch(() => {/* no crítico */});

        const preview = text.length > 600 ? `${text.slice(0, 600)}…` : text;

        return [
            `📋 **Publicacion LinkedIn pendiente de tu aprobacion** — id \`${id}\``,
            `Visibilidad: **${visibility}**${resolvedImageUrl ? '\n🖼️ Incluye **imagen** (se adjuntara al publicar).' : ''}`,
            '',
            '---',
            preview,
            '---',
            '',
            'Cuando quieras **publicar de verdad** en LinkedIn, en este chat ejecuta:',
            `\`/li_approve ${id}\``,
            '',
            'Para cancelar:',
            `\`/li_reject ${id}\``,
            '',
            'Para ver todas las pendientes: `/li_pending`',
            '',
            'Hasta que apruebes, **no** se llama a la API de LinkedIn.',
        ].join('\n');
    },
});

registerTool({
    name: 'linkedin_list_drafts',
    description:
        'Listar borradores de LinkedIn guardados en linkedin/drafts/ (mas recientes primero). Usar cuando el usuario pregunte que borradores tiene o quiera revisar los ultimos.',
    parameters: {
        type: 'object',
        properties: {
            limit: {
                type: 'string',
                description: 'Maximo de archivos a mostrar (por defecto 15)',
            },
        },
        required: [],
    },
    handler: async (args) => {
        const raw = (args as { limit?: string }).limit;
        const limit = Math.min(50, Math.max(1, parseInt(raw ?? '15', 10) || 15));

        const dir = resolveSafeWorkspacePath(DRAFTS_DIR);
        let names: string[];
        try {
            names = await readdir(dir);
        } catch {
            return [
                'Todavia no hay borradores en linkedin/drafts/.',
                'Pide al agente que redacte algo para LinkedIn y use linkedin_save_draft para guardarlo.',
            ].join('\n');
        }

        const mdFiles = names.filter((n) => n.endsWith('.md'));
        const withStat = await Promise.all(
            mdFiles.map(async (name) => {
                const full = path.join(dir, name);
                const st = await stat(full);
                return { name, mtime: st.mtimeMs };
            })
        );

        withStat.sort((a, b) => b.mtime - a.mtime);
        const slice = withStat.slice(0, limit);

        if (slice.length === 0) {
            return 'La carpeta linkedin/drafts/ existe pero no hay archivos .md.';
        }

        const lines = slice.map(
            (s, i) => `${i + 1}. \`${path.posix.join(DRAFTS_DIR, s.name)}\` (${new Date(s.mtime).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })})`
        );

        return ['📋 Borradores LinkedIn (mas recientes primero):', '', ...lines].join('\n');
    },
});

registerTool({
    name: 'approve_linkedin_post',
    description:
        'Publicar en LinkedIn un post pendiente de aprobación. Usar cuando el usuario diga "aprueba", "aprobado", "sí publícalo", "dale", "adelante", "publícalo ya" u otras frases de confirmación. Si no se indica id, usa el post pendiente más reciente de este chat.',
    parameters: {
        type: 'object',
        properties: {
            post_id: {
                type: 'number',
                description: 'ID numérico del post a aprobar. Si se omite, se usa el más reciente pendiente.',
            },
        },
        required: [],
    },
    handler: async (args) => {
        const tctx = getToolContext();
        if (!tctx?.chatId) {
            throw new Error('approve_linkedin_post solo está disponible en Telegram.');
        }

        if (!isLinkedInOAuthConfigured()) {
            return '⚠️ LinkedIn OAuth no está configurado. Configura LINKEDIN_* en el servidor.';
        }

        const chatId = tctx.chatId;
        let row;

        if ((args as { post_id?: number }).post_id) {
            const id = Number((args as { post_id?: number }).post_id);
            row = await getLinkedInPendingPostForChat(id, chatId);
            if (!row || (row.status !== 'pending' && row.status !== 'failed')) {
                return `No existe la propuesta #${id} pendiente en este chat.`;
            }
        } else {
            const rows = await listLinkedInPendingPostsForChat(chatId, 1);
            row = rows[0];
            if (!row) {
                return 'No hay posts LinkedIn pendientes de aprobación en este chat.';
            }
        }

        try {
            const result = await publishLinkedInFeedPost(
                row.body,
                row.visibility === 'CONNECTIONS' ? 'CONNECTIONS' : 'PUBLIC',
                row.image_url ?? undefined
            );
            const ref = result.restLiId ?? result.rawBody ?? 'ok';
            await setLinkedInPendingPublished(row.id, ref);
            return result.restLiId
                ? `✅ Publicado en LinkedIn.\nRef: \`${result.restLiId}\``
                : '✅ Publicado en LinkedIn.';
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await setLinkedInPendingFailed(row.id, msg);
            return `❌ Error al publicar: ${msg}`;
        }
    },
});
