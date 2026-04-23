import { readdir } from 'node:fs/promises';
import { registerTool } from '../core/dispatcher';
import { getWorkspaceBaseDir, resolveSafeWorkspacePath } from './workspace-utils';

registerTool({
    name: 'list_files',
    description:
        'List files and folders inside WORKSPACE_BASE_DIR. Use path "." to list the workspace root.',
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'Relative folder path inside workspace. Use "." for root',
            },
        },
        required: ['path'],
    },
    handler: async (args) => {
        const { path } = args as { path: string };
        const relativePath = path === '.' ? '' : path;
        const target = resolveSafeWorkspacePath(relativePath);
        const entries = await readdir(target, { withFileTypes: true });

        const lines = entries.map((entry) => `${entry.isDirectory() ? '📁' : '📄'} ${entry.name}`);
        return [
            '✅ Listado de contenido:',
            `📁 Base: ${getWorkspaceBaseDir()}`,
            `📂 Ruta consultada: ${path}`,
            lines.length > 0 ? lines.join('\n') : '(sin elementos)',
        ].join('\n');
    },
});
