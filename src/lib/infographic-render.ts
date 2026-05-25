import { logger } from '../core/logger';
import { buildAntvInfographicHtml } from './antv-infographic-dsl';

const WIDTH = 1080;
const HEIGHT = 1350;

/** Renderiza DSL AntV Infographic → PNG (navegador headless o API HCTI). */
export async function renderAntvInfographicToPng(dsl: string): Promise<Buffer> {
    const html = buildAntvInfographicHtml(dsl, WIDTH, HEIGHT);
    return renderInfographicHtmlToPng(html);
}

/** Convierte HTML 1080×1350 a PNG (Playwright o htmlcsstoimage). */
export async function renderInfographicHtmlToPng(html: string): Promise<Buffer> {
    const hctiUser = process.env.HCTI_USER_ID?.trim();
    const hctiKey = process.env.HCTI_API_KEY?.trim();
    if (hctiUser && hctiKey) {
        return renderViaHcti(html, hctiUser, hctiKey);
    }
    return renderViaPlaywrightAntv(html);
}

async function renderViaHcti(html: string, userId: string, apiKey: string): Promise<Buffer> {
    const auth = Buffer.from(`${userId}:${apiKey}`).toString('base64');
    const res = await fetch('https://hcti.io/v1/image', {
        method: 'POST',
        headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            html,
            viewport_width: WIDTH,
            viewport_height: HEIGHT,
            device_scale: 2,
        }),
    });
    const data = (await res.json()) as { url?: string; error?: string };
    if (!res.ok || !data.url) {
        throw new Error(data.error ?? `HCTI HTTP ${res.status}`);
    }
    const imgRes = await fetch(data.url);
    if (!imgRes.ok) throw new Error('No se pudo descargar PNG de HCTI');
    return Buffer.from(await imgRes.arrayBuffer());
}

async function renderViaPlaywrightAntv(html: string): Promise<Buffer> {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
        const page = await browser.newPage({
            viewport: { width: WIDTH, height: HEIGHT },
            deviceScaleFactor: 2,
        });
        await page.setContent(html, { waitUntil: 'networkidle', timeout: 60_000 });

        await page.waitForFunction(
            () => {
                const w = window as Window & {
                    __INFO_READY__?: boolean;
                    __INFO_ERROR__?: string | null;
                    AntVInfographic?: unknown;
                };
                if (w.__INFO_ERROR__) return true;
                return w.__INFO_READY__ === true;
            },
            { timeout: 45_000 }
        );

        const err = await page.evaluate(() => {
            const w = window as Window & { __INFO_ERROR__?: string | null };
            return w.__INFO_ERROR__ ?? null;
        });
        if (err) throw new Error(`AntV Infographic: ${err}`);

        await page.waitForTimeout(1200);

        const buf = await page.screenshot({
            type: 'png',
            clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
        });
        logger.info('[infographic-render] PNG AntV Infographic (Playwright)');
        return buf;
    } finally {
        await browser.close();
    }
}
