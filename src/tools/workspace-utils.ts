import path from 'node:path';

export function getWorkspaceBaseDir(): string {
    return process.env.WORKSPACE_BASE_DIR ?? '/opt/zirox-workspace';
}

export function resolveSafeWorkspacePath(relativePath: string): string {
    const normalized = relativePath.replace(/\\/g, '/').trim();
    if (!normalized) return path.resolve(getWorkspaceBaseDir());
    if (normalized.includes('..')) {
        throw new Error('path invalido: no se permite ".."');
    }

    const base = path.resolve(getWorkspaceBaseDir());
    const full = path.resolve(base, normalized);
    const relative = path.relative(base, full);

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('path fuera de WORKSPACE_BASE_DIR');
    }

    return full;
}
