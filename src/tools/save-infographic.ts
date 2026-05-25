import { registerTool } from '../core/dispatcher';
import { logger } from '../core/logger';
import { getToolContext } from '../core/tool-context';
import { listInfographicJobs } from '../core/storage';

const GH_BASE = 'https://api.github.com';
export const INFOGRAPHIC_NEURONA_PATH = 'proyectos/AgentZirox - Neurona Infografias.md';

function getConfig() {
    const token = process.env.OBSIDIAN_GITHUB_TOKEN?.trim();
    const repo = process.env.OBSIDIAN_GITHUB_REPO?.trim();
    const branch = process.env.OBSIDIAN_GITHUB_BRANCH?.trim() || 'main';
    if (!token || !repo) {
        throw new Error('Falta OBSIDIAN_GITHUB_TOKEN o OBSIDIAN_GITHUB_REPO en las variables de entorno.');
    }
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

function encodePath(p: string): string {
    return p.split('/').map((seg) => encodeURIComponent(seg)).join('/');
}

async function readNeuronaContent(): Promise<string> {
    const { token, repo, branch } = getConfig();
    const res = await fetch(
        `${GH_BASE}/repos/${repo}/contents/${encodePath(INFOGRAPHIC_NEURONA_PATH)}?ref=${encodeURIComponent(branch)}`,
        { headers: ghHeaders(token) }
    );
    if (res.status === 404) throw new Error(`No existe la neurona: ${INFOGRAPHIC_NEURONA_PATH}`);
    if (!res.ok) throw new Error(`GitHub read failed (${res.status})`);
    const data = (await res.json()) as { content?: string };
    if (!data.content) throw new Error('Neurona infografías vacía');
    return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8');
}

async function writeNeuronaContent(content: string, message: string): Promise<void> {
    const { token, repo, branch } = getConfig();
    const checkRes = await fetch(
        `${GH_BASE}/repos/${repo}/contents/${encodePath(INFOGRAPHIC_NEURONA_PATH)}?ref=${encodeURIComponent(branch)}`,
        { headers: ghHeaders(token) }
    );
    const existing = checkRes.ok ? ((await checkRes.json()) as { sha?: string }) : null;
    const body: Record<string, unknown> = {
        message,
        content: Buffer.from(content, 'utf-8').toString('base64'),
        branch,
    };
    if (existing?.sha) body.sha = existing.sha;
    const putRes = await fetch(`${GH_BASE}/repos/${repo}/contents/${encodePath(INFOGRAPHIC_NEURONA_PATH)}`, {
        method: 'PUT',
        headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!putRes.ok) {
        const err = (await putRes.json()) as { message?: string };
        throw new Error(`GitHub write failed (${putRes.status}): ${err.message ?? 'unknown'}`);
    }
}

function escapeCell(s: string): string {
    return s.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

function nextRowNumber(content: string): number {
    const nums = [...content.matchAll(/^\| (\d+) \|/gm)].map((m) => parseInt(m[1], 10));
    return nums.length ? Math.max(...nums) + 1 : 1;
}

function appendInfographicRow(
    content: string,
    row: { designUrl: string; pngUrl: string; description: string; origin: string }
): string {
    const fecha = new Date().toISOString().slice(0, 10);
    const line = `| ${nextRowNumber(content)} | ${escapeCell(row.designUrl)} | ${escapeCell(row.pngUrl)} | ${escapeCell(row.description)} | ${fecha} | ${escapeCell(row.origin)} |`;

    const emptySlot = content.match(/^\| (\d+) \| \| \| \| \| \|/m);
    if (emptySlot) {
        return content.replace(
            emptySlot[0],
            `| ${emptySlot[1]} | ${escapeCell(row.designUrl)} | ${escapeCell(row.pngUrl)} | ${escapeCell(row.description)} | ${fecha} | ${escapeCell(row.origin)} |`
        );
    }

    const tableEnd = content.indexOf('\n---\n\n## Flujo completo');
    if (tableEnd === -1) {
        return content + '\n' + line;
    }
    return content.slice(0, tableEnd) + '\n' + line + content.slice(tableEnd);
}

function parseInfographicTable(content: string): Array<{
    num: string;
    designUrl: string;
    pngUrl: string;
    description: string;
    fecha: string;
    origin: string;
}> {
    const rows: Array<{
        num: string;
        designUrl: string;
        pngUrl: string;
        description: string;
        fecha: string;
        origin: string;
    }> = [];
    const section = content.split('## Biblioteca de infografías')[1]?.split('---')[0] ?? '';
    for (const line of section.split('\n')) {
        const m = line.match(/^\| (\d+) \| ([^|]*) \| ([^|]*) \| ([^|]*) \| ([^|]*) \| ([^|]*) \|$/);
        if (!m) continue;
        const [, num, designUrl, pngUrl, description, fecha, origin] = m;
        if (!designUrl.trim() && !pngUrl.trim() && !description.trim()) continue;
        rows.push({
            num,
            designUrl: designUrl.trim(),
            pngUrl: pngUrl.trim(),
            description: description.trim(),
            fecha: fecha.trim(),
            origin: origin.trim(),
        });
    }
    return rows;
}

registerTool({
    name: 'save_infographic',
    description:
        'Guarda una infografía en la neurona Obsidian del agente (proyectos/AgentZirox - Neurona Infografias.md). ' +
        'Usar cuando el usuario tenga URL de Canva, PNG exportado, o quiera archivar un diseño. Requiere OBSIDIAN_GITHUB_TOKEN.',
    parameters: {
        type: 'object',
        properties: {
            description: {
                type: 'string',
                description: 'Descripción corta de la infografía (1 línea)',
            },
            design_url: {
                type: 'string',
                description: 'Enlace al diseño en Canva (view/edit)',
            },
            export_png_url: {
                type: 'string',
                description: 'URL pública del PNG exportado (opcional)',
            },
            origin: {
                type: 'string',
                description: 'Origen: Canva MCP, manual, LinkedIn, etc.',
            },
        },
        required: ['description'],
    },
    handler: async (args) => {
        const a = args as {
            description?: string;
            design_url?: string;
            export_png_url?: string;
            origin?: string;
        };
        const description = String(a.description ?? '').trim();
        if (!description) throw new Error('description vacía');
        const designUrl = String(a.design_url ?? '').trim();
        const pngUrl = String(a.export_png_url ?? '').trim();
        if (!designUrl && !pngUrl) {
            throw new Error('Indica al menos design_url (Canva) o export_png_url');
        }

        let content = await readNeuronaContent();
        content = appendInfographicRow(content, {
            designUrl,
            pngUrl,
            description,
            origin: String(a.origin ?? 'AgentZirox').trim(),
        });
        await writeNeuronaContent(content, `save_infographic: ${description.slice(0, 60)}`);
        logger.info(`[save_infographic] ${description.slice(0, 80)}`);

        const lines = [
            '✅ Infografía guardada en la neurona.',
            `📌 ${description}`,
        ];
        if (designUrl) lines.push(`🔗 Diseño: ${designUrl}`);
        if (pngUrl) lines.push(`🖼 PNG: ${pngUrl}`);
        return lines.join('\n');
    },
});

registerTool({
    name: 'list_infographics',
    description:
        'Lista infografías guardadas en la neurona Obsidian (AgentZirox - Neurona Infografias). ' +
        'Usar cuando el usuario pregunte qué infografías hay, busque una anterior, o quiera reutilizar assets.',
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Filtro opcional por palabra en la descripción',
            },
        },
        required: [],
    },
    handler: async (args) => {
        const query = String((args as { query?: string }).query ?? '')
            .trim()
            .toLowerCase();
        const ctx = getToolContext();
        const lines: string[] = [];

        try {
            const jobs = await listInfographicJobs(ctx?.chatId, 15);
            const filtered = query
                ? jobs.filter((j) => j.title.toLowerCase().includes(query))
                : jobs;
            if (filtered.length > 0) {
                lines.push('**Recientes (Supabase):**');
                for (const j of filtered) {
                    lines.push(`• #${j.id} — ${j.title}`);
                    if (j.png_url) lines.push(`  PNG: ${j.png_url}`);
                }
            }
        } catch {
            /* Postgres opcional */
        }

        try {
            const content = await readNeuronaContent();
            let rows = parseInfographicTable(content);
            if (query) {
                rows = rows.filter(
                    (r) =>
                        r.description.toLowerCase().includes(query) ||
                        r.origin.toLowerCase().includes(query)
                );
            }
            if (rows.length > 0) {
                if (lines.length) lines.push('');
                lines.push('**Biblioteca Obsidian:**');
                for (const r of rows) {
                    lines.push(`• #${r.num} — ${r.description} (${r.fecha})`);
                    if (r.pngUrl) lines.push(`  PNG: ${r.pngUrl}`);
                }
            }
        } catch {
            /* GitHub neurona opcional */
        }

        if (lines.length === 0) {
            return query
                ? `No hay infografías que coincidan con "${query}".`
                : 'No hay infografías guardadas. Usa create_infographic para crear una.';
        }
        return `📊 Infografías:\n\n${lines.join('\n')}`;
    },
});
