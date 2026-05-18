import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { resolveSafeWorkspacePath, getWorkspaceBaseDir } from '../workspace-utils';

const execAsync = promisify(exec);

export function isDesktopControlEnabled(): boolean {
    return process.env.DESKTOP_CONTROL_ENABLED === 'true' && process.platform === 'win32';
}

export function assertDesktopControl(): void {
    if (!isDesktopControlEnabled()) {
        throw new Error(
            'Control de escritorio desactivado. En tu PC local pon DESKTOP_CONTROL_ENABLED=true en .env y reinicia el agente. ' +
            'Si el agente corre en un VPS/servidor, las acciones se ejecutan allí, no en tu ordenador — usa npm run dev en local.'
        );
    }
}

export async function openUrl(url: string): Promise<void> {
    const safe = url.replace(/"/g, '');
    await execAsync(`start "" "${safe}"`, { shell: 'cmd.exe', windowsHide: true });
}

const FOLDER_ALIASES: Record<string, () => string> = {
    escritorio: () => path.join(os.homedir(), 'Desktop'),
    desktop: () => path.join(os.homedir(), 'Desktop'),
    documentos: () => path.join(os.homedir(), 'Documents'),
    documents: () => path.join(os.homedir(), 'Documents'),
    descargas: () => path.join(os.homedir(), 'Downloads'),
    downloads: () => path.join(os.homedir(), 'Downloads'),
    workspace: () => getWorkspaceBaseDir(),
    inicio: () => os.homedir(),
    home: () => os.homedir(),
};

/** Resuelve carpeta: alias, ruta relativa al workspace, ~ o ruta absoluta bajo el perfil del usuario. */
export function resolveOpenPath(input: string): string {
    const raw = input.trim();
    if (!raw) throw new Error('Indica qué carpeta abrir.');

    const aliasKey = raw.toLowerCase().replace(/[\\/]+$/, '');
    if (FOLDER_ALIASES[aliasKey]) return FOLDER_ALIASES[aliasKey]();

    const expanded = raw.replace(/^~(?=$|[\\/])/, os.homedir());

    if (!path.isAbsolute(expanded) && !/^[a-zA-Z]:[\\/]/.test(expanded)) {
        return resolveSafeWorkspacePath(expanded);
    }

    const resolved = path.resolve(expanded);
    if (process.env.DESKTOP_CONTROL_ALLOW_ANY_PATH === 'true') return resolved;

    const home = os.homedir();
    const rel = path.relative(home, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(
            `Ruta no permitida: ${raw}. Usa escritorio, documentos, descargas, workspace, rutas bajo tu usuario ` +
            'o DESKTOP_CONTROL_ALLOW_ANY_PATH=true para rutas absolutas fuera del perfil.'
        );
    }
    return resolved;
}

export async function openInExplorer(folderPath: string): Promise<void> {
    const normalized = folderPath.replace(/"/g, '');
    await execAsync(`explorer "${normalized}"`, { windowsHide: true });
}

const APP_LAUNCH: Record<string, string> = {
    spotify: 'spotify:',
    chrome: 'chrome',
    'google chrome': 'chrome',
    edge: 'msedge',
    firefox: 'firefox',
    notepad: 'notepad',
    bloc: 'notepad',
    calculadora: 'calc',
    calculator: 'calc',
    calc: 'calc',
    explorador: 'explorer',
    explorer: 'explorer',
    cmd: 'cmd',
    terminal: 'wt',
    'windows terminal': 'wt',
    vscode: 'code',
    'visual studio code': 'code',
    telegram: 'telegram',
    whatsapp: 'whatsapp:',
};

export async function launchApplication(appName: string): Promise<void> {
    const key = appName.toLowerCase().trim();
    const target = APP_LAUNCH[key] ?? appName.trim();
    if (!target) throw new Error('Indica qué aplicación abrir.');

    if (target.includes(':') && !target.includes(' ')) {
        await openUrl(target);
        return;
    }

    await execAsync(`start "" "${target.replace(/"/g, '')}"`, { shell: 'cmd.exe', windowsHide: true });
}

const YT_VIDEO_FILTER = 'EgIQAQ%3D%3D';

export async function findFirstYoutubeVideoUrl(query: string): Promise<string | null> {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=${YT_VIDEO_FILTER}`;
    try {
        const res = await fetch(searchUrl, {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept-Language': 'es-ES,es;q=0.9',
            },
            signal: AbortSignal.timeout(12_000),
        });
        if (!res.ok) return null;
        const html = await res.text();
        const ids = [...html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)].map((m) => m[1]);
        const seen = new Set<string>();
        for (const id of ids) {
            if (seen.has(id)) continue;
            seen.add(id);
            if (html.includes(`/shorts/${id}`)) continue;
            return `https://www.youtube.com/watch?v=${id}`;
        }
    } catch {
        /* fallback a búsqueda */
    }
    return null;
}

export function youtubeSearchFallbackUrl(query: string): string {
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=${YT_VIDEO_FILTER}`;
}

/** Volumen Windows vía teclas multimedia (requiere sesión de escritorio activa). */
export async function sendVolumeKey(key: 'up' | 'down' | 'mute'): Promise<void> {
    const charCode = key === 'up' ? 175 : key === 'down' ? 174 : 173;
    const ps = `powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]${charCode})"`;
    await execAsync(ps, { windowsHide: true });
}

export async function sendVolumeKeys(key: 'up' | 'down', steps: number): Promise<void> {
    const n = Math.min(Math.max(steps, 1), 20);
    for (let i = 0; i < n; i++) await sendVolumeKey(key);
}
