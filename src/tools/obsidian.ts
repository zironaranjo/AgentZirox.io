import { registerTool } from '../core/dispatcher';
import { logger } from '../core/logger';

const GH_BASE = 'https://api.github.com';

function getConfig() {
    const token = process.env.OBSIDIAN_GITHUB_TOKEN?.trim();
    const repo = process.env.OBSIDIAN_GITHUB_REPO?.trim(); // "owner/repo"
    const branch = process.env.OBSIDIAN_GITHUB_BRANCH?.trim() || 'main';
    if (!token || !repo) throw new Error('Falta OBSIDIAN_GITHUB_TOKEN o OBSIDIAN_GITHUB_REPO en las variables de entorno.');
    return { token, repo, branch };
}

function ghHeaders(token: string): Record<string, string> {
    return {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'AgentZirox',
    };
}

// Encode path preserving slashes (GitHub API expects segments encoded, not the whole path).
function encodePath(p: string): string {
    return p.split('/').map(seg => encodeURIComponent(seg)).join('/');
}

// ── Search notes ─────────────────────────────────────────────────────────────
registerTool({
    name: 'obsidian_search',
    description:
        'Busca notas en el vault de Obsidian del usuario (sincronizado con GitHub). ' +
        'Busca por palabras clave en el título o contenido de las notas. ' +
        'Requiere OBSIDIAN_GITHUB_TOKEN y OBSIDIAN_GITHUB_REPO.',
    parameters: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Palabras clave para buscar en notas' },
            limit: { type: 'number', description: 'Máximo de resultados (default 5, max 10)' },
        },
        required: ['query'],
    },
    handler: async (args) => {
        const { query, limit = 5 } = args as { query: string; limit?: number };
        const { token, repo } = getConfig();
        const cap = Math.min(Number(limit) || 5, 10);

        const url = `${GH_BASE}/search/code?q=${encodeURIComponent(query)}+repo:${repo}&per_page=${cap}`;
        const res = await fetch(url, {
            headers: { ...ghHeaders(token), Accept: 'application/vnd.github.text-match+json' },
        });

        if (res.status === 403) {
            const msg = await res.text();
            logger.warn(`[obsidian_search] GitHub 403: ${msg.slice(0, 200)}`);
            throw new Error('GitHub rate limit alcanzado o token sin acceso al repositorio.');
        }

        const data = await res.json() as {
            total_count?: number;
            items?: Array<{ path: string; html_url: string; text_matches?: Array<{ fragment: string }> }>;
            message?: string;
        };

        if (data.message) throw new Error(`GitHub error: ${data.message}`);
        if (!data.items?.length) return `No encontré notas con "${query}" en tu vault de Obsidian.`;

        const lines = data.items.slice(0, cap).map(item => {
            const fragment = item.text_matches?.[0]?.fragment?.slice(0, 120).replace(/\n/g, ' ') ?? '';
            return `📄 **${item.path}**${fragment ? `\n   _${fragment}_` : ''}`;
        });

        return `Encontré ${data.total_count ?? data.items.length} nota(s) para "${query}":\n\n${lines.join('\n\n')}`;
    },
});

// ── Read a note ───────────────────────────────────────────────────────────────
registerTool({
    name: 'obsidian_read',
    description:
        'Lee el contenido completo de una nota de Obsidian por su ruta en el vault. ' +
        'La ruta es relativa a la raíz del vault, p.ej. "Daily/2026-05-16.md" o "Proyectos/AgentZirox.md". ' +
        'Usa obsidian_search primero si no sabes el nombre exacto.',
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'Ruta relativa de la nota en el vault, incluyendo .md. Ej: "Ideas/mi-idea.md"',
            },
        },
        required: ['path'],
    },
    handler: async (args) => {
        const { path } = args as { path: string };
        const { token, repo, branch } = getConfig();

        const res = await fetch(
            `${GH_BASE}/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`,
            { headers: ghHeaders(token) }
        );

        if (res.status === 404) return `No se encontró la nota: \`${path}\``;
        if (!res.ok) throw new Error(`GitHub error ${res.status} al leer ${path}`);

        const data = await res.json() as { content?: string; size?: number };
        if (!data.content) return `La nota existe pero está vacía: \`${path}\``;

        const content = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8');
        return `📓 **${path}**\n\n${content}`;
    },
});

// ── Write (create or update) a note ──────────────────────────────────────────
registerTool({
    name: 'obsidian_write',
    description:
        'Crea o actualiza una nota en el vault de Obsidian del usuario. ' +
        'La nota se sube a GitHub y Obsidian Git la sincronizará automáticamente en el próximo pull. ' +
        'Usa rutas claras, p.ej. "Ideas/nueva-idea.md" o "Daily/2026-05-16.md".',
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'Ruta relativa de la nota en el vault (incluye .md). Ej: "Ideas/nueva-idea.md"',
            },
            content: {
                type: 'string',
                description: 'Contenido completo de la nota en formato Markdown.',
            },
            commit_message: {
                type: 'string',
                description: 'Mensaje del commit en GitHub (opcional, se genera automáticamente si no se pone).',
            },
        },
        required: ['path', 'content'],
    },
    handler: async (args) => {
        const { path, content, commit_message } = args as {
            path: string; content: string; commit_message?: string;
        };
        const { token, repo, branch } = getConfig();

        // Check if file exists to get its SHA (required for updates).
        const checkRes = await fetch(
            `${GH_BASE}/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`,
            { headers: ghHeaders(token) }
        );
        const existing = checkRes.ok ? await checkRes.json() as { sha?: string } : null;

        const isUpdate = Boolean(existing?.sha);
        const body: Record<string, unknown> = {
            message: commit_message ?? `${isUpdate ? 'Update' : 'Create'} ${path} via AgentZirox`,
            content: Buffer.from(content, 'utf-8').toString('base64'),
            branch,
        };
        if (existing?.sha) body.sha = existing.sha;

        const putRes = await fetch(
            `${GH_BASE}/repos/${repo}/contents/${encodePath(path)}`,
            {
                method: 'PUT',
                headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }
        );

        if (!putRes.ok) {
            const err = await putRes.json() as { message?: string };
            throw new Error(`GitHub write failed (${putRes.status}): ${err.message ?? 'unknown error'}`);
        }

        logger.info(`[obsidian_write] ${isUpdate ? 'Updated' : 'Created'} ${path} in ${repo}`);
        return `✅ Nota ${isUpdate ? 'actualizada' : 'creada'}: \`${path}\`\nSe sincronizará con Obsidian en el próximo pull automático de Obsidian Git.`;
    },
});
