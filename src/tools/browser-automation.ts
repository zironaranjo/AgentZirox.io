import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { registerTool } from '../core/dispatcher';
import { getToolContext } from '../core/tool-context';
import { setPendingTelegramImagePath } from './generate-image';

type BrowserSession = {
    browser: Browser;
    context: BrowserContext;
    page: Page;
    createdAt: number;
    lastUsedAt: number;
};

const sessions = new Map<string, BrowserSession>();
const SESSION_TTL_MS = 20 * 60 * 1000; // 20 min

function now(): number {
    return Date.now();
}

function sessionKey(input?: string): string {
    const user = String(input ?? '').trim();
    if (user) return user;
    const chatId = getToolContext()?.chatId ?? 'default';
    return `chat:${chatId}`;
}

async function closeSession(key: string): Promise<boolean> {
    const s = sessions.get(key);
    if (!s) return false;
    sessions.delete(key);
    try {
        await s.context.close().catch(() => {});
        await s.browser.close().catch(() => {});
    } catch {
        // ignore cleanup errors
    }
    return true;
}

async function cleanupExpiredSessions(): Promise<void> {
    const t = now();
    const keys = [...sessions.keys()];
    for (const k of keys) {
        const s = sessions.get(k);
        if (!s) continue;
        if (t - s.lastUsedAt > SESSION_TTL_MS) {
            await closeSession(k);
        }
    }
}

async function ensureSession(key: string): Promise<BrowserSession> {
    await cleanupExpiredSessions();
    const existing = sessions.get(key);
    if (existing) {
        existing.lastUsedAt = now();
        return existing;
    }
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const context = await browser.newContext({
        viewport: { width: 1440, height: 2200 },
    });
    const page = await context.newPage();
    const created: BrowserSession = { browser, context, page, createdAt: now(), lastUsedAt: now() };
    sessions.set(key, created);
    return created;
}

function mustGetSession(key: string): BrowserSession {
    const s = sessions.get(key);
    if (!s) throw new Error(`No hay sesión activa para "${key}". Usa browser_open primero.`);
    s.lastUsedAt = now();
    return s;
}

function normalizeUrl(input: string): string {
    let raw = input.trim().replace(/^["'`]+|["'`]+$/g, '');
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
    const u = new URL(raw);
    u.pathname = u.pathname.replace(/["'`]+$/g, '').replace(/\s+$/g, '');
    return u.toString();
}

registerTool({
    name: 'browser_open',
    description: 'Abre una URL en una sesión de navegador Playwright para automatización (formularios, clicks, etc.).',
    parameters: {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'URL a abrir' },
            session_id: { type: 'string', description: 'ID de sesión opcional para mantener estado entre pasos' },
        },
        required: ['url'],
    },
    timeoutMs: 45_000,
    handler: async (args) => {
        const key = sessionKey((args as { session_id?: string }).session_id);
        const url = normalizeUrl(String((args as { url?: string }).url ?? ''));
        const s = await ensureSession(key);
        await s.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35_000 });
        await s.page.waitForTimeout(900);
        return `🌐 Sesión "${key}" abierta en ${url}.`;
    },
});

registerTool({
    name: 'browser_fill',
    description: 'Rellena un campo de formulario por selector CSS en una sesión Playwright.',
    parameters: {
        type: 'object',
        properties: {
            selector: { type: 'string', description: 'Selector CSS del input/textarea/select' },
            value: { type: 'string', description: 'Valor a escribir' },
            session_id: { type: 'string', description: 'ID de sesión opcional' },
        },
        required: ['selector', 'value'],
    },
    timeoutMs: 30_000,
    handler: async (args) => {
        const key = sessionKey((args as { session_id?: string }).session_id);
        const selector = String((args as { selector?: string }).selector ?? '').trim();
        const value = String((args as { value?: string }).value ?? '');
        if (!selector) throw new Error('selector vacío');
        const s = mustGetSession(key);
        await s.page.locator(selector).first().fill(value, { timeout: 20_000 });
        return `✍️ Campo "${selector}" rellenado en sesión "${key}".`;
    },
});

registerTool({
    name: 'browser_click',
    description: 'Hace click en un elemento por selector CSS en una sesión Playwright.',
    parameters: {
        type: 'object',
        properties: {
            selector: { type: 'string', description: 'Selector CSS del elemento a clicar' },
            session_id: { type: 'string', description: 'ID de sesión opcional' },
        },
        required: ['selector'],
    },
    timeoutMs: 30_000,
    handler: async (args) => {
        const key = sessionKey((args as { session_id?: string }).session_id);
        const selector = String((args as { selector?: string }).selector ?? '').trim();
        if (!selector) throw new Error('selector vacío');
        const s = mustGetSession(key);
        await s.page.locator(selector).first().click({ timeout: 20_000 });
        await s.page.waitForTimeout(700);
        return `🖱️ Click ejecutado en "${selector}" (sesión "${key}").`;
    },
});

registerTool({
    name: 'browser_submit',
    description: 'Envía un formulario en una sesión Playwright (click en botón submit o Enter).',
    parameters: {
        type: 'object',
        properties: {
            selector: { type: 'string', description: 'Selector del botón/enlace de envío (opcional)' },
            session_id: { type: 'string', description: 'ID de sesión opcional' },
        },
        required: [],
    },
    timeoutMs: 40_000,
    handler: async (args) => {
        const key = sessionKey((args as { session_id?: string }).session_id);
        const selector = String((args as { selector?: string }).selector ?? '').trim();
        const s = mustGetSession(key);
        if (selector) {
            await s.page.locator(selector).first().click({ timeout: 20_000 });
        } else {
            await s.page.keyboard.press('Enter');
        }
        await s.page.waitForTimeout(1200);
        const title = await s.page.title();
        return `✅ Formulario enviado en sesión "${key}". Página actual: "${title}".`;
    },
});

registerTool({
    name: 'browser_screenshot_session',
    description: 'Toma screenshot de la página actual de una sesión Playwright y lo envía por Telegram.',
    parameters: {
        type: 'object',
        properties: {
            session_id: { type: 'string', description: 'ID de sesión opcional' },
        },
        required: [],
    },
    timeoutMs: 30_000,
    handler: async (args) => {
        const key = sessionKey((args as { session_id?: string }).session_id);
        const s = mustGetSession(key);
        const screenshotPath = path.join(tmpdir(), `session-screenshot-${Date.now()}.png`);
        await s.page.screenshot({ path: screenshotPath, fullPage: true });
        const stat = await fs.stat(screenshotPath);
        if (stat.size <= 0) throw new Error('No se pudo generar screenshot');
        const chatId = getToolContext()?.chatId;
        if (chatId) setPendingTelegramImagePath(chatId, screenshotPath);
        return `📸 Screenshot de sesión "${key}" capturado.`;
    },
});

registerTool({
    name: 'browser_close',
    description: 'Cierra una sesión Playwright y libera recursos.',
    parameters: {
        type: 'object',
        properties: {
            session_id: { type: 'string', description: 'ID de sesión opcional' },
        },
        required: [],
    },
    timeoutMs: 20_000,
    handler: async (args) => {
        const key = sessionKey((args as { session_id?: string }).session_id);
        const ok = await closeSession(key);
        return ok
            ? `🧹 Sesión "${key}" cerrada.`
            : `ℹ️ No había sesión activa para "${key}".`;
    },
});
