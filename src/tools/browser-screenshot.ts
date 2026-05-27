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

async function takeScreenshotDirect(url: string, screenshotPath: string): Promise<void> {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
        const context = await browser.newContext({
            viewport: { width: 1440, height: 2200 },
        });
        const page = await context.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35_000 });
        await page.waitForTimeout(1200);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        await context.close();
    } finally {
        await browser.close();
    }
}

function normalizeUrl(input: string): string {
    let raw = input.trim().replace(/^["'`]+|["'`]+$/g, '');
    // El usuario suele dictar "triadak.io/explore" sin esquema.
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
    let u: URL;
    try {
        u = new URL(raw);
    } catch {
        throw new Error(`URL inválida: "${input}"`);
    }
    // Limpia comillas residuales o espacios codificados en el path.
    u.pathname = u.pathname.replace(/["'`]+$/g, '').replace(/\s+$/g, '');
    return u.toString();
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
        const urlRaw = String((args as { url?: string }).url ?? '').trim();
        if (!urlRaw) throw new Error('URL vacía');
        const url = normalizeUrl(urlRaw);

        const session = `agent-${Date.now()}`;
        const screenshotPath = path.join(tmpdir(), `screenshot-${Date.now()}.png`);

        try {
            // Ruta principal: Playwright oficial (más estable en contenedor).
            await takeScreenshotDirect(url, screenshotPath);
        } catch (directErr) {
            // Fallback: playwright-cli por si hay entornos legacy.
            try {
                await runPwCli(session, 'open', url);
                await runPwCli(session, 'screenshot', `--filename=${screenshotPath}`);
            } catch (cliErr) {
                const dmsg = directErr instanceof Error ? directErr.message : String(directErr);
                const cmsg = cliErr instanceof Error ? cliErr.message : String(cliErr);
                throw new Error(`screenshot falló (playwright + cli): ${dmsg.slice(0, 180)} | ${cmsg.slice(0, 180)}`);
            }
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
