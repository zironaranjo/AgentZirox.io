import { spawn } from 'node:child_process';
import path from 'node:path';

import { logger } from '../core/logger';

export type NotebooklmInfographicInput = {
    title: string;
    brief?: string;
    steps?: string[];
    benefits?: string[];
    sources?: string[];
    instructions?: string;
    language?: string;
    orientation?: 'landscape' | 'portrait' | 'square';
    detail?: 'concise' | 'standard' | 'detailed';
    style?: string;
    timeout_sec?: number;
};

type NotebooklmScriptResult = {
    success?: boolean;
    error?: string;
    png_base64?: string;
    notebook_id?: string;
    task_id?: string;
    bytes?: number;
};

function pythonBin(): string {
    return (process.env.NOTEBOOKLM_PYTHON ?? 'python3').trim() || 'python3';
}

function scriptPath(): string {
    return (
        process.env.NOTEBOOKLM_SCRIPT_PATH?.trim() ||
        path.join(process.cwd(), 'scripts', 'notebooklm-generate-infographic.py')
    );
}

export function isNotebooklmEnabled(): boolean {
    const v = (process.env.NOTEBOOKLM_ENABLED ?? 'false').toLowerCase();
    return v === 'true' || v === '1' || v === 'yes';
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
            reject(new Error(`NotebookLM timeout (${timeoutMs}ms)`));
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
            reject(new Error(stderr.trim() || stdout.trim() || `Script NotebookLM exit ${code}`));
        });

        child.stdin.write(jsonInput);
        child.stdin.end();
    });
}

export async function runNotebooklmInfographic(
    input: NotebooklmInfographicInput
): Promise<{ pngBuffer: Buffer; notebookId?: string; taskId?: string }> {
    if (!isNotebooklmEnabled()) {
        throw new Error(
            'NotebookLM desactivado. Activa NOTEBOOKLM_ENABLED=true y ejecuta notebooklm login en el VPS.'
        );
    }

    const timeoutMs = Math.min(
        Math.max(Number(process.env.NOTEBOOKLM_TIMEOUT_MS ?? 660_000), 120_000),
        900_000
    );

    const payload = {
        ...input,
        timeout_sec: input.timeout_sec ?? Math.floor(timeoutMs / 1000),
    };

    logger.info('[notebooklm] Generando infografía (puede tardar varios minutos)…');

    const { stdout, stderr } = await runPythonScript(JSON.stringify(payload), timeoutMs);

    if (stderr?.trim()) {
        logger.warn('[notebooklm] stderr:', stderr.slice(0, 400));
    }

    const text = stdout.trim();
    if (!text) throw new Error('Script NotebookLM sin salida');

    let data: NotebooklmScriptResult;
    try {
        data = JSON.parse(text) as NotebooklmScriptResult;
    } catch {
        throw new Error(`Respuesta inválida del script NotebookLM: ${text.slice(0, 300)}`);
    }

    if (!data.success || !data.png_base64) {
        throw new Error(data.error ?? 'Error desconocido en NotebookLM');
    }

    return {
        pngBuffer: Buffer.from(data.png_base64, 'base64'),
        notebookId: data.notebook_id,
        taskId: data.task_id,
    };
}
