import path from 'node:path';
import { tmpdir } from 'node:os';
import { logger } from '../core/logger';

const ENTRY_POINT = path.resolve(process.cwd(), 'remotion/index.tsx');

// Cache the bundle URL across requests — rebuilding webpack takes ~20-30s
let bundleCache: string | null = null;

async function getBundle(): Promise<string> {
    if (bundleCache) return bundleCache;
    logger.info('[remotion] building bundle (first time ~20-30s)...');
    const { bundle } = await import('@remotion/bundler');
    bundleCache = await bundle({
        entryPoint: ENTRY_POINT,
        onProgress: (p) => {
            if (p % 25 === 0) logger.info(`[remotion] bundle ${p}%`);
        },
    });
    logger.info('[remotion] bundle ready');
    return bundleCache;
}

function findChromePath(): string | undefined {
    // Try Playwright's Chromium (already installed in container)
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { chromium } = require('playwright-core') as typeof import('playwright-core');
        const p = chromium.executablePath();
        if (p) return p;
    } catch { /* not available */ }
    return undefined;
}

export interface RenderOptions {
    compositionId: string;
    props: Record<string, unknown>;
    /** Output filename (no extension). Defaults to a temp file. */
    outputName?: string;
    /** Frames per second. Defaults to composition default. */
    fps?: number;
    concurrency?: number;
}

export interface RenderResult {
    outputPath: string;
    durationSec: number;
}

export async function renderRemotionVideo(opts: RenderOptions): Promise<RenderResult> {
    const { renderMedia, selectComposition } = await import('@remotion/renderer');

    const serveUrl  = await getBundle();
    const outputPath = opts.outputName
        ? path.join(tmpdir(), `${opts.outputName}-${Date.now()}.mp4`)
        : path.join(tmpdir(), `remotion-${Date.now()}.mp4`);

    const chromePath = findChromePath();
    if (chromePath) logger.info(`[remotion] using chrome: ${chromePath}`);

    const composition = await selectComposition({
        serveUrl,
        id: opts.compositionId,
        inputProps: opts.props,
    });

    logger.info(`[remotion] rendering "${opts.compositionId}" — ${composition.durationInFrames} frames @ ${composition.fps}fps`);

    await renderMedia({
        composition,
        serveUrl,
        codec: 'h264',
        outputLocation: outputPath,
        inputProps: opts.props,
        concurrency: opts.concurrency ?? 2,
        chromiumOptions: {
            disableWebSecurity: true,
            gl: 'angle',
            ...(chromePath ? { executablePath: chromePath } : {}),
        },
        onProgress: ({ progress }) => {
            const pct = Math.round(progress * 100);
            if (pct % 20 === 0) logger.info(`[remotion] render ${pct}%`);
        },
    });

    const durationSec = composition.durationInFrames / composition.fps;
    logger.info(`[remotion] done — ${outputPath} (${durationSec.toFixed(1)}s)`);

    return { outputPath, durationSec };
}
