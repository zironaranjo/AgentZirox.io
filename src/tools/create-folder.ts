import { mkdir } from 'node:fs/promises';
import { registerTool } from '../core/dispatcher.js';
import { getWorkspaceBaseDir, resolveSafeWorkspacePath } from './workspace-utils.js';

registerTool({
    name: 'create_folder',
    description:
        'Create a folder inside WORKSPACE_BASE_DIR for client management and social media tasks.',
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'Relative folder path inside workspace, e.g. clientes/acme',
            },
        },
        required: ['path'],
    },
    handler: async (args) => {
        const { path } = args as { path: string };
        const target = resolveSafeWorkspacePath(path);
        await mkdir(target, { recursive: true });

        return [
            '✅ Carpeta creada correctamente.',
            `📁 Base: ${getWorkspaceBaseDir()}`,
            `📂 Ruta relativa: ${path}`,
            `🧭 Ruta completa: ${target}`,
        ].join('\n');
    },
});
