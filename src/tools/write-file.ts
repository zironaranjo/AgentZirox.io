import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { registerTool } from '../core/dispatcher.js';
import { getWorkspaceBaseDir, resolveSafeWorkspacePath } from './workspace-utils.js';

registerTool({
    name: 'write_file',
    description:
        'Write text content into a file inside WORKSPACE_BASE_DIR. Creates parent folders automatically.',
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'Relative file path inside workspace, e.g. clientes/acme/brief.md',
            },
            content: {
                type: 'string',
                description: 'Text content to write into the file',
            },
        },
        required: ['path', 'content'],
    },
    handler: async (args) => {
        const { path: relativePath, content } = args as { path: string; content: string };
        const target = resolveSafeWorkspacePath(relativePath);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, content, 'utf8');

        return [
            '✅ Archivo guardado correctamente.',
            `📁 Base: ${getWorkspaceBaseDir()}`,
            `📄 Ruta relativa: ${relativePath}`,
            `🧭 Ruta completa: ${target}`,
        ].join('\n');
    },
});
