import { readFile } from 'node:fs/promises';
import { registerTool } from '../core/dispatcher';
import { getWorkspaceBaseDir, resolveSafeWorkspacePath } from './workspace-utils';

registerTool({
    name: 'read_file',
    description: 'Read a text file inside WORKSPACE_BASE_DIR for client context and task follow-up.',
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'Relative file path inside workspace, e.g. clientes/acme/brief.md',
            },
        },
        required: ['path'],
    },
    handler: async (args) => {
        const { path: relativePath } = args as { path: string };
        const target = resolveSafeWorkspacePath(relativePath);
        const content = await readFile(target, 'utf8');

        return [
            '✅ Archivo leido correctamente.',
            `📁 Base: ${getWorkspaceBaseDir()}`,
            `📄 Ruta relativa: ${relativePath}`,
            `🧭 Ruta completa: ${target}`,
            '',
            content || '(archivo vacio)',
        ].join('\n');
    },
});
