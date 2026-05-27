import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registerTool } from '../core/dispatcher';
import { getToolContext } from '../core/tool-context';
import { setPendingTelegramImagePath } from './generate-image';

const execFileAsync = promisify(execFile);

function playwrightCliBin(): string {
    // Prefer local node_modules, fall back to global
    const local = path.resolve(process.cwd(), 'node_modules/.bin/playwright-cli');
    return local;
}

async function runPwCli(session: string, ...args: string[]): Promise<string> {
    const bin = playwrightCliBin();
    try {
        const { stdout } = await execFileAsync(bin, ['-s', session, ...args], {
            timeout: 30_000,
            env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
        });
        return stdout;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`playwright-cli: ${msg.slice(0, 300)}`);
    }
}

registerTool({
    name: 'browser_screenshot',
    description:
        'Abre una URL en un navegador real y toma un screenshot que se envía como imagen al usuario. Útil para ver cómo se ve una web, verificar diseños, o capturar páginas que requieren JavaScript.',
    parameters: {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'URL completa a capturar (https://...)' },
        },
        required: ['url'],
    },
    timeoutMs: 45_000,
    handler: async (args) => {
        const url = String((args as { url?: string }).url ?? '').trim();
        if (!url.startsWith('http')) throw new Error('URL debe empezar por https://');

        const session = `agent-${Date.now()}`;
        const screenshotPath = path.join(tmpdir(), `screenshot-${Date.now()}.png`);

        try {
            await runPwCli(session, 'open', url);
            await runPwCli(session, 'screenshot', `--filename=${screenshotPath}`);
        } finally {
            await runPwCli(session, 'close').catch(() => {});
        }

        const ctx = getToolContext();
        if (ctx?.chatId) {
            setPendingTelegramImagePath(ctx.chatId, screenshotPath);
        }

        return `📸 Screenshot de ${url} capturado.`;
    },
});
