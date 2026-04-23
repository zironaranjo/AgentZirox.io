import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { registerTool } from '../core/dispatcher';
import { getWorkspaceBaseDir, resolveSafeWorkspacePath } from './workspace-utils';

registerTool({
    name: 'create_client_workspace',
    description:
        'Create a ready-to-use client workspace with brief, tasks, and content plan templates.',
    parameters: {
        type: 'object',
        properties: {
            client: {
                type: 'string',
                description: 'Client name slug, e.g. acme or zirox-studio',
            },
        },
        required: ['client'],
    },
    handler: async (args) => {
        const { client } = args as { client: string };
        const clientSlug = client.trim().toLowerCase().replace(/\s+/g, '-');
        if (!clientSlug) {
            throw new Error('client no puede estar vacio');
        }

        const clientDirRelative = `clientes/${clientSlug}`;
        const clientDir = resolveSafeWorkspacePath(clientDirRelative);
        await mkdir(clientDir, { recursive: true });

        const briefPath = path.join(clientDir, 'brief.md');
        const tasksPath = path.join(clientDir, 'tareas.md');
        const contentPath = path.join(clientDir, 'contenido.md');

        await writeFile(
            briefPath,
            `# Brief - ${clientSlug}\n\n## Objetivo\n-\n\n## Oferta\n-\n\n## Audiencia\n-\n\n## Canales\n- Instagram\n- TikTok\n- LinkedIn\n`,
            'utf8'
        );
        await writeFile(
            tasksPath,
            '# Tareas\n\n- [ ] Definir propuesta de valor\n- [ ] Crear calendario semanal\n- [ ] Preparar 3 ideas de contenido\n',
            'utf8'
        );
        await writeFile(
            contentPath,
            '# Plan de contenido\n\n## Semana 1\n- Post 1:\n- Post 2:\n- Reel 1:\n\n## Semana 2\n- Post 1:\n- Post 2:\n- Reel 1:\n',
            'utf8'
        );

        return [
            '✅ Workspace de cliente creado.',
            `📁 Base: ${getWorkspaceBaseDir()}`,
            `👤 Cliente: ${clientSlug}`,
            `📂 Carpeta: ${clientDirRelative}`,
            '📄 Archivos: brief.md, tareas.md, contenido.md',
        ].join('\n');
    },
});
