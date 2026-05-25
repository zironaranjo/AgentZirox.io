import { logger } from './logger';

export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

export interface Tool {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<
            string,
            {
                type: string;
                description: string;
                enum?: string[];
                items?: { type: string };
            }
        >;
        required?: string[];
    };
    handler: ToolHandler;
    /** Timeout in ms before the tool call is aborted. Default: 30 000 ms */
    timeoutMs?: number;
    /** Max automatic retries on transient errors. Default: 0 (no retry) */
    retries?: number;
}

const registry = new Map<string, Tool>();

export function registerTool(tool: Tool) {
    registry.set(tool.name, tool);
    logger.debug(`🔧 Tool registered: ${tool.name}`);
}

export function getToolDefinitions() {
    return Array.from(registry.values()).map(({ name, description, parameters }) => ({
        name,
        description,
        parameters,
    }));
}

// ── Tool execution with timeout + retry ───────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;

function isTransientError(err: unknown): boolean {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    return (
        msg.includes('timeout') ||
        msg.includes('econnreset') ||
        msg.includes('econnrefused') ||
        msg.includes('etimedout') ||
        msg.includes('fetch failed') ||
        msg.includes('network') ||
        msg.includes('socket hang up') ||
        msg.includes('rate limit') ||
        msg.includes('429')
    );
}

async function runWithTimeout<T>(promise: Promise<T>, ms: number, toolName: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`Tool "${toolName}" timed out after ${ms}ms`)),
            ms
        );
    });
    try {
        return await Promise.race([promise, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = registry.get(name);
    if (!tool) return `❌ Tool "${name}" not found.`;

    const timeoutMs = tool.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRetries = tool.retries ?? 0;

    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            if (attempt === 0) {
                logger.info(`⚙️  Executing tool: ${name}`, args);
            } else {
                logger.warn(`⚙️  Retrying tool: ${name} (attempt ${attempt + 1}/${maxRetries + 1})`);
            }
            const result = await runWithTimeout(tool.handler(args), timeoutMs, name);
            return result;
        } catch (err) {
            lastErr = err;
            const msg = err instanceof Error ? err.message : String(err);
            if (attempt < maxRetries && isTransientError(err)) {
                logger.warn(`Tool ${name} transient error (will retry): ${msg}`);
                await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
                continue;
            }
            logger.error(`Tool ${name} failed: ${msg}`);
            return `❌ Error en "${name}": ${msg}`;
        }
    }

    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    return `❌ Error en "${name}" tras ${maxRetries + 1} intentos: ${msg}`;
}

export function listTools(): string[] {
    return Array.from(registry.keys());
}
