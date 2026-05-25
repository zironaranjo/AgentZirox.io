import { logger } from '../core/logger';

const GH_BASE = 'https://api.github.com';
export const INFOGRAPHIC_NEURONA_PATH = 'proyectos/AgentZirox - Neurona Infografias.md';

function getConfig() {
    const token = process.env.OBSIDIAN_GITHUB_TOKEN?.trim();
    const repo = process.env.OBSIDIAN_GITHUB_REPO?.trim();
    const branch = process.env.OBSIDIAN_GITHUB_BRANCH?.trim() || 'main';
    if (!token || !repo) return null;
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

async function readNeuronaContent(token: string, repo: string, branch: string): Promise<string> {
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

async function writeNeuronaContent(
    token: string,
    repo: string,
    branch: string,
    content: string,
    message: string
): Promise<void> {
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
    if (tableEnd === -1) return content + '\n' + line;
    return content.slice(0, tableEnd) + '\n' + line + content.slice(tableEnd);
}

/** Archiva en la neurona Obsidian (GitHub). No lanza si faltan credenciales. */
export async function archiveInfographicToNeurona(opts: {
    description: string;
    pngUrl: string;
    designUrl?: string;
    origin?: string;
}): Promise<{ ok: boolean; note: string }> {
    const cfg = getConfig();
    if (!cfg) {
        return { ok: false, note: 'Neurona no actualizada (falta OBSIDIAN_GITHUB_TOKEN/REPO).' };
    }
    try {
        let content = await readNeuronaContent(cfg.token, cfg.repo, cfg.branch);
        content = appendInfographicRow(content, {
            designUrl: opts.designUrl ?? '',
            pngUrl: opts.pngUrl,
            description: opts.description,
            origin: opts.origin ?? 'AgentZirox auto',
        });
        await writeNeuronaContent(
            cfg.token,
            cfg.repo,
            cfg.branch,
            content,
            `create_infographic: ${opts.description.slice(0, 60)}`
        );
        logger.info(`[infographic-neurona] archivada: ${opts.description.slice(0, 80)}`);
        return { ok: true, note: 'Archivada en neurona Obsidian.' };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn('[infographic-neurona] fallo', msg);
        return { ok: false, note: `Neurona no actualizada: ${msg}` };
    }
}
