import { logger } from './logger.js';

export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

export interface Tool {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, { type: string; description: string; enum?: string[] }>;
        required?: string[];
    };
    handler: ToolHandler;
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

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = registry.get(name);
    if (!tool) {
        return `❌ Tool "${name}" not found.`;
    }
    try {
        logger.info(`⚙️  Executing tool: ${name}`, args);
        const result = await tool.handler(args);
        return result;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`Tool ${name} failed: ${msg}`);
        return `❌ Error executing tool "${name}": ${msg}`;
    }
}

export function listTools(): string[] {
    return Array.from(registry.keys());
}
