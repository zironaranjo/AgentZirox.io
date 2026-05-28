import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { synthesizeSpeech } from '../tools/tts-generate';
import { logger } from '../core/logger';

const FFMPEG = process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH?.trim() || 'ffprobe';

interface RunResult { code: number; stdout: string; stderr: string; }

function run(cmd: string, args: string[], cwd?: string): Promise<RunResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += d.toString(); });
        child.stderr.on('data', (d) => { stderr += d.toString(); });
        child.on('error', reject);
        child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    });
}

async function probeDurationSec(file: string): Promise<number> {
    const { code, stdout } = await run(FFPROBE, [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        file,
    ]);
    if (code !== 0) return 0;
    const n = parseFloat(stdout.trim());
    return Number.isFinite(n) ? n : 0;
}

function secToAssTime(sec: number): string {
    const cs = Math.max(0, Math.round(sec * 100));
    const centis = cs % 100;
    const totalSec = Math.floor(cs / 100);
    const s = totalSec % 60;
    const m = Math.floor(totalSec / 60) % 60;
    const h = Math.floor(totalSec / 3600);
    const pad = (x: number, n = 2) => String(x).padStart(n, '0');
    return `${h}:${pad(m)}:${pad(s)}.${pad(centis)}`;
}

function sanitizeAss(text: string): string {
    return text.replace(/[{}]/g, '').replace(/\r?\n/g, ' ').trim();
}

function buildAss(segments: Array<{ text: string; start: number; end: number }>): string {
    const header = [
        '[Script Info]',
        'ScriptType: v4.00+',
        'PlayResX: 1080',
        'PlayResY: 1920',
        'WrapStyle: 0',
        'ScaledBorderAndShadow: yes',
        '',
        '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        'Style: Big,DejaVu Sans,86,&H00FFFFFF,&H000000FF,&H00000000,&H78000000,1,0,0,0,100,100,0,0,1,6,3,5,90,90,0,1',
        '',
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ];
    const lines = segments.map(
        (s) => `Dialogue: 0,${secToAssTime(s.start)},${secToAssTime(s.end)},Big,,0,0,0,,${sanitizeAss(s.text)}`
    );
    return [...header, ...lines].join('\n');
}

const SCALE_CROP = 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920';

/** Genera bg.mp4 (solo vídeo) de duración >= total según el tipo de fondo. */
async function makeBackground(
    workDir: string,
    background: BackgroundSpec,
    total: number
): Promise<string> {
    const dur = Math.max(1, total + 0.3);
    const frames = Math.ceil(dur * 30);

    if (background.type === 'image' || background.type === 'kenburns') {
        const bgExt = path.extname(background.path) || '.jpg';
        const bgLocal = path.join(workDir, `src${bgExt}`);
        await fs.copyFile(background.path, bgLocal);

        const vf =
            background.type === 'kenburns'
                ? [
                      'scale=3240:5760',
                      `zoompan=z='min(zoom+0.0006,1.4)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=30`,
                      'format=yuv420p',
                  ].join(',')
                : `${SCALE_CROP},fps=30,format=yuv420p`;

        const r = await run(FFMPEG, [
            '-y', '-loop', '1', '-t', String(dur), '-i', path.basename(bgLocal),
            '-vf', vf,
            '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', '30',
            'bg.mp4',
        ], workDir);
        if (r.code !== 0) {
            logger.error(`[short-video] bg(${background.type}) ffmpeg falló: ${r.stderr.slice(-600)}`);
            throw new Error('Fallo al preparar el fondo del vídeo (ffmpeg).');
        }
        return path.join(workDir, 'bg.mp4');
    }

    // type === 'veo': normalizar clips, medir, repetir secuencia hasta cubrir 'dur', concatenar
    const norm: Array<{ name: string; dur: number }> = [];
    for (let i = 0; i < background.clipPaths.length; i++) {
        const src = path.join(workDir, `clipsrc${i}${path.extname(background.clipPaths[i]) || '.mp4'}`);
        await fs.copyFile(background.clipPaths[i], src);
        const outName = `norm${i}.mp4`;
        const r = await run(FFMPEG, [
            '-y', '-i', path.basename(src), '-an',
            '-vf', `${SCALE_CROP},fps=30,setsar=1,format=yuv420p`,
            '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
            outName,
        ], workDir);
        if (r.code !== 0) {
            logger.error(`[short-video] normalize clip ${i} falló: ${r.stderr.slice(-400)}`);
            continue;
        }
        const d = await probeDurationSec(path.join(workDir, outName));
        norm.push({ name: outName, dur: d > 0 ? d : 8 });
    }
    if (norm.length === 0) throw new Error('No se pudo normalizar ningún clip de vídeo Veo.');

    const seq: string[] = [];
    let acc = 0;
    let i = 0;
    while (acc < dur && seq.length < 200) {
        const clip = norm[i % norm.length];
        seq.push(clip.name);
        acc += clip.dur;
        i++;
    }
    await fs.writeFile(path.join(workDir, 'bglist.txt'), seq.map((n) => `file '${n}'`).join('\n'));
    const r = await run(FFMPEG, [
        '-y', '-f', 'concat', '-safe', '0', '-i', 'bglist.txt', '-c', 'copy', 'bg.mp4',
    ], workDir);
    if (r.code !== 0) {
        // fallback con re-encode si copy falla
        const r2 = await run(FFMPEG, [
            '-y', '-f', 'concat', '-safe', '0', '-i', 'bglist.txt',
            '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', 'bg.mp4',
        ], workDir);
        if (r2.code !== 0) {
            logger.error(`[short-video] concat veo bg falló: ${r2.stderr.slice(-600)}`);
            throw new Error('Fallo al concatenar los clips de vídeo (ffmpeg).');
        }
    }
    return path.join(workDir, 'bg.mp4');
}

export type BackgroundSpec =
    | { type: 'image'; path: string }
    | { type: 'kenburns'; path: string }
    | { type: 'veo'; clipPaths: string[] };

export interface ShortVideoResult {
    buffer: Buffer;
    durationSec: number;
}

/**
 * Monta un vídeo vertical 1080x1920 con voz en off (TTS por segmento, subtítulos
 * sincronizados) sobre un fondo configurable (imagen, Ken Burns o clips Veo).
 */
export async function buildShortVideo(opts: {
    segments: string[];
    background: BackgroundSpec;
    voiceKey?: string;
}): Promise<ShortVideoResult> {
    const segments = opts.segments.map((s) => s.trim()).filter(Boolean);
    if (segments.length === 0) throw new Error('buildShortVideo: no hay segmentos de guion');

    const workDir = await fs.mkdtemp(path.join(tmpdir(), 'short-video-'));
    try {
        // 1) Voz por segmento + duración
        const timed: Array<{ text: string; start: number; end: number; file: string }> = [];
        let cursor = 0;
        for (let i = 0; i < segments.length; i++) {
            const mp3 = await synthesizeSpeech(segments[i], opts.voiceKey ?? 'jorge');
            const file = path.join(workDir, `seg${i}.mp3`);
            await fs.writeFile(file, mp3);
            let dur = await probeDurationSec(file);
            if (dur <= 0) dur = Math.max(1.5, segments[i].length / 14);
            timed.push({ text: segments[i], start: cursor, end: cursor + dur, file });
            cursor += dur;
        }
        const totalDuration = cursor;

        // 2) Concatenar voz
        await fs.writeFile(
            path.join(workDir, 'list.txt'),
            timed.map((t) => `file '${path.basename(t.file)}'`).join('\n')
        );
        const concat = await run(FFMPEG, [
            '-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt',
            '-c:a', 'libmp3lame', '-q:a', '4', 'voice.mp3',
        ], workDir);
        if (concat.code !== 0) {
            logger.error(`[short-video] concat voz falló: ${concat.stderr.slice(-500)}`);
            throw new Error('Fallo al concatenar la voz (ffmpeg).');
        }

        // 3) Subtítulos
        await fs.writeFile(path.join(workDir, 'subs.ass'), buildAss(timed));

        // 4) Fondo (imagen / kenburns / veo)
        await makeBackground(workDir, opts.background, totalDuration);

        // 5) Montaje final: fondo + voz + subtítulos quemados
        const assemble = await run(FFMPEG, [
            '-y',
            '-i', 'bg.mp4',
            '-i', 'voice.mp3',
            '-vf', 'ass=subs.ass,format=yuv420p',
            '-map', '0:v:0', '-map', '1:a:0',
            '-c:v', 'libx264', '-preset', 'veryfast',
            '-c:a', 'aac', '-b:a', '128k',
            '-pix_fmt', 'yuv420p', '-r', '30',
            '-shortest',
            'out.mp4',
        ], workDir);
        if (assemble.code !== 0) {
            logger.error(`[short-video] assemble falló: ${assemble.stderr.slice(-800)}`);
            throw new Error('Fallo al montar el vídeo (ffmpeg).');
        }

        const buffer = await fs.readFile(path.join(workDir, 'out.mp4'));
        return { buffer, durationSec: totalDuration };
    } finally {
        await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
}
