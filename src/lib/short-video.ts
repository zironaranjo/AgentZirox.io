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

/** Limpia texto para ASS: sin llaves de override ni saltos crudos. */
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
        // Fuente grande, blanca, borde negro grueso, centrada vertical (an5)
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

export interface ShortVideoResult {
    buffer: Buffer;
    durationSec: number;
}

/**
 * Monta un vídeo vertical 1080x1920 a partir de:
 *  - segments: frases del guion en orden (cada una será una línea de subtítulo y un trozo de voz)
 *  - bgImagePath: imagen de fondo local
 *  - voiceKey: voz Edge TTS (jorge, alvaro, elvira, dalia)
 * Genera voz por segmento (para sincronizar subtítulos), concatena, quema subtítulos y exporta MP4.
 */
export async function buildShortVideo(opts: {
    segments: string[];
    bgImagePath: string;
    voiceKey?: string;
}): Promise<ShortVideoResult> {
    const segments = opts.segments.map((s) => s.trim()).filter(Boolean);
    if (segments.length === 0) throw new Error('buildShortVideo: no hay segmentos de guion');

    const workDir = await fs.mkdtemp(path.join(tmpdir(), 'short-video-'));
    try {
        // 1) Sintetizar voz por segmento + medir duración
        const timed: Array<{ text: string; start: number; end: number; file: string }> = [];
        let cursor = 0;
        for (let i = 0; i < segments.length; i++) {
            const mp3 = await synthesizeSpeech(segments[i], opts.voiceKey ?? 'jorge');
            const file = path.join(workDir, `seg${i}.mp3`);
            await fs.writeFile(file, mp3);
            let dur = await probeDurationSec(file);
            if (dur <= 0) dur = Math.max(1.5, segments[i].length / 14); // fallback aproximado
            timed.push({ text: segments[i], start: cursor, end: cursor + dur, file });
            cursor += dur;
        }
        const totalDuration = cursor;

        // 2) Concatenar audios → voice.mp3 (re-encode para evitar problemas de timestamps)
        const listFile = path.join(workDir, 'list.txt');
        await fs.writeFile(listFile, timed.map((t) => `file '${path.basename(t.file)}'`).join('\n'));
        const voiceFile = path.join(workDir, 'voice.mp3');
        const concat = await run(FFMPEG, [
            '-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt',
            '-c:a', 'libmp3lame', '-q:a', '4', 'voice.mp3',
        ], workDir);
        if (concat.code !== 0) {
            logger.error(`[short-video] concat ffmpeg falló: ${concat.stderr.slice(-500)}`);
            throw new Error('Fallo al concatenar la voz (ffmpeg).');
        }

        // 3) Subtítulos .ass
        const assFile = path.join(workDir, 'subs.ass');
        await fs.writeFile(assFile, buildAss(timed));

        // 4) Copiar imagen de fondo al workdir
        const bgExt = path.extname(opts.bgImagePath) || '.jpg';
        const bgLocal = path.join(workDir, `bg${bgExt}`);
        await fs.copyFile(opts.bgImagePath, bgLocal);

        // 5) Montaje final 9:16
        const outFile = path.join(workDir, 'out.mp4');
        const vf = [
            'scale=1080:1920:force_original_aspect_ratio=increase',
            'crop=1080:1920',
            `ass=${path.basename(assFile)}`,
            'format=yuv420p',
        ].join(',');
        const assemble = await run(FFMPEG, [
            '-y',
            '-loop', '1', '-i', path.basename(bgLocal),
            '-i', 'voice.mp3',
            '-vf', vf,
            '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage',
            '-c:a', 'aac', '-b:a', '128k',
            '-pix_fmt', 'yuv420p',
            '-r', '30',
            '-shortest',
            'out.mp4',
        ], workDir);
        if (assemble.code !== 0) {
            logger.error(`[short-video] assemble ffmpeg falló: ${assemble.stderr.slice(-800)}`);
            throw new Error('Fallo al montar el vídeo (ffmpeg).');
        }

        const buffer = await fs.readFile(outFile);
        return { buffer, durationSec: totalDuration };
    } finally {
        await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
}
