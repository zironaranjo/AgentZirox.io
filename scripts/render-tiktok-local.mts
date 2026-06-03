/**
 * Render TikTok locally (no Telegram). Usage:
 *   npx tsx scripts/render-tiktok-local.mts [--motion=kenburns|text]
 */
import 'dotenv/config';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildShortVideo } from '../src/lib/short-video.ts';
import { generateImageUrl } from '../src/tools/generate-image.ts';
import { renderRemotionVideo } from '../src/lib/remotion-render.ts';

const OUT_DIR = path.resolve(process.cwd(), 'output');
const motion = process.argv.find((a) => a.startsWith('--motion='))?.split('=')[1] ?? 'kenburns';

const segments = [
    'Tu cerebro tiene más de ochenta y seis mil millones de neuronas.',
    'Cada neurona puede conectar con miles de otras a la vez.',
    'Esas conexiones crean pensamiento, memoria y emociones.',
    'Cuando aprendes algo nuevo, las rutas se refuerzan.',
    'Dormir ayuda a tu cerebro a ordenar lo vivido en el día.',
    'La mente no es solo el cerebro: es red, cuerpo y experiencia.',
];

const hook = 'Tu mente es una red viva';
const lines = [
    'Más de 86 mil millones de neuronas',
    'Miles de conexiones por neurona',
    'Aprender refuerza esas rutas',
    'Dormir consolida la memoria',
    'Mente = cerebro + hábitos + emoción',
];

async function download(url: string, file: string) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download ${res.status}`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
}

async function renderKenburns(): Promise<string> {
    const imagePrompt =
        'Vertical cinematic 9:16, glowing neural network inside human brain silhouette, deep purple and cyan bioluminescence, microscopic neurons and synapses, dark scientific atmosphere, no text, no watermark, hyper detailed';
    const imageUrl = await generateImageUrl(imagePrompt, '1024x1792');
    const bgPath = path.join(tmpdir(), `tiktok-bg-${Date.now()}.jpg`);
    await download(imageUrl, bgPath);
    try {
        const video = await buildShortVideo({
            segments,
            background: { type: 'kenburns', path: bgPath },
            voiceKey: 'jorge',
        });
        const out = path.join(OUT_DIR, 'tiktok-neuronas-mente.mp4');
        await writeFile(out, video.buffer);
        return out;
    } finally {
        await rm(bgPath, { force: true });
    }
}

async function renderText(): Promise<string> {
    const { outputPath } = await renderRemotionVideo({
        compositionId: 'TikTokTextVideo',
        props: {
            hook,
            lines,
            cta: 'Sigue para más neurociencia 👇',
            accent: '#8b5cf6',
            author: '@zirox.io',
        },
        outputName: 'tiktok-neuronas',
        concurrency: 2,
    });
    const out = path.join(OUT_DIR, 'tiktok-neuronas-mente.mp4');
    await writeFile(out, await readFile(outputPath));
    await rm(outputPath, { force: true });
    return out;
}

async function main() {
    await mkdir(OUT_DIR, { recursive: true });
    console.log(`Rendering (${motion})...`);

    let out: string;
    if (motion === 'text') {
        out = await renderText();
    } else {
        try {
            out = await renderKenburns();
        } catch (e) {
            console.warn('Kenburns/TTS failed, fallback to Remotion text:', e);
            out = await renderText();
        }
    }

    console.log('Done:', out);
    console.log('\nCaption sugerido:\n');
    console.log(
        '🧠 Tu mente es una red de miles de millones de conexiones.\n\n' +
            '#neurociencia #cerebro #neuronas #mente #aprendizaje #curiosidades #ciencia #tiktok #zirox'
    );
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
