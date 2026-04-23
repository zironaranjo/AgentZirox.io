import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { registerTool } from '../core/dispatcher';
import { getWorkspaceBaseDir, resolveSafeWorkspacePath } from './workspace-utils';

registerTool({
    name: 'append_file',
    description:
        'Append text content into a file inside WORKSPACE_BASE_DIR. Creates parent folders automatically.',
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'Relative file path inside workspace, e.g. clientes/acme/tareas.md',
            },
            content: {
                type: 'string',
                description: 'Text content to append into the file',
            },
        },
        required: ['path', 'content'],
    },
    handler: async (args) => {
        const { path: relativePath, content } = args as { path: string; content: string };
        const target = resolveSafeWorkspacePath(relativePath);
        await mkdir(path.dirname(target), { recursive: true });
        await appendFile(target, `${content}\n`, 'utf8');

        return [
            '✅ Contenido agregado correctamente.',
            `📁 Base: ${getWorkspaceBaseDir()}`,
            `📄 Ruta relativa: ${relativePath}`,
            `🧭 Ruta completa: ${target}`,
        ].join('\n');
    },
});
