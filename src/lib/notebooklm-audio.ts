import { spawn } from 'node:child_process';
import path from 'node:path';

import { logger } from '../core/logger';
import { isNotebooklmEnabled } from './notebooklm-infographic';

export type NotebooklmAudioInput = {
    title: string;
    brief?: string;
    topics?: string[];
    sources?: string[];
    instructions?: string;
    language?: string;
    audio_format?: 'deep_dive' | 'brief' | 'critique' | 'debate';
    audio_length?: 'short' | 'default' | 'long';
    timeout_sec?: number;
};

type NotebooklmAudioScriptResult = {
    success?: boolean;
    error?: string;
    audio_base64?: string;
    mime_type?: string;
    notebook_id?: string;
    task_id?: string;
    bytes?: number;
};

function pythonBin(): string {
    return (process.env.NOTEBOOKLM_PYTHON ?? 'python3').trim() || 'python3';
}

function scriptPath(): string {
    return (
        process.env.NOTEBOOKLM_AUDIO_SCRIPT_PATH?.trim() ||
        path.join(process.cwd(), 'scripts', 'notebooklm-generate-audio.py')
    );
}

function runPythonScript(jsonInput: string, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(pythonBin(), [scriptPath()], {
            env: { ...process.env },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer | string) => {
            stdout += String(chunk);
        });
        child.stderr.on('data', (chunk: Buffer | string) => {
            stderr += String(chunk);
        });

        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`NotebookLM audio timeout (${timeoutMs}ms)`));
        }, timeoutMs);

        child.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });

        child.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) {
                resolve({ stdout, stderr });
                return;
            }
            reject(new Error(stderr.trim() || stdout.trim() || `Script NotebookLM audio exit ${code}`));
        });

        child.stdin.write(jsonInput);
        child.stdin.end();
    });
}

export async function runNotebooklmAudio(
    input: NotebooklmAudioInput
): Promise<{ audioBuffer: Buffer; mimeType: string; notebookId?: string; taskId?: string }> {
    if (!isNotebooklmEnabled()) {
        throw new Error(
            'NotebookLM desactivado. Activa NOTEBOOKLM_ENABLED=true y ejecuta notebooklm login en el VPS.'
        );
    }

    const timeoutMs = Math.min(
        Math.max(Number(process.env.NOTEBOOKLM_AUDIO_TIMEOUT_MS ?? process.env.NOTEBOOKLM_TIMEOUT_MS ?? 900_000), 180_000),
        1_200_000
    );

    const payload = {
        ...input,
        timeout_sec: input.timeout_sec ?? Math.floor(timeoutMs / 1000),
    };

    logger.info('[notebooklm] Generando resumen en audio (puede tardar 5–15 min)…');

    const { stdout, stderr } = await runPythonScript(JSON.stringify(payload), timeoutMs);

    if (stderr?.trim()) {
        logger.warn('[notebooklm] audio stderr:', stderr.slice(0, 400));
    }

    const text = stdout.trim();
    if (!text) throw new Error('Script NotebookLM audio sin salida');

    let data: NotebooklmAudioScriptResult;
    try {
        data = JSON.parse(text) as NotebooklmAudioScriptResult;
    } catch {
        throw new Error(`Respuesta inválida del script NotebookLM audio: ${text.slice(0, 300)}`);
    }

    if (!data.success || !data.audio_base64) {
        throw new Error(data.error ?? 'Error desconocido en NotebookLM audio');
    }

    return {
        audioBuffer: Buffer.from(data.audio_base64, 'base64'),
        mimeType: data.mime_type ?? 'audio/mpeg',
        notebookId: data.notebook_id,
        taskId: data.task_id,
    };
}
