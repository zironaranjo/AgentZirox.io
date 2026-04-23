import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { registerTool } from '../core/dispatcher';
import { getWorkspaceBaseDir, resolveSafeWorkspacePath } from './workspace-utils';

registerTool({
    name: 'capture_note',
    description:
        'Quickly capture an idea or reminder into workspace inbox files. Ideal for messages like "anota esto".',
    parameters: {
        type: 'object',
        properties: {
            note: {
                type: 'string',
                description: 'The note text to capture',
            },
            bucket: {
                type: 'string',
                description: 'Optional inbox bucket name, e.g. ideas, clientes, contenido',
            },
            source: {
                type: 'string',
                description: 'Optional source channel, e.g. telegram or instagram',
            },
        },
        required: ['note'],
    },
    handler: async (args) => {
        const { note, bucket, source } = args as {
            note: string;
            bucket?: string;
            source?: string;
        };

        const safeBucket = (bucket ?? 'ideas').trim().toLowerCase().replace(/\s+/g, '-');
        const filePathRelative = `capturas/${safeBucket}.md`;
        const target = resolveSafeWorkspacePath(filePathRelative);
        await mkdir(path.dirname(target), { recursive: true });

        const now = new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
        const from = source?.trim() ? source.trim() : 'chat';
        const line = `- [${now}] (${from}) ${note.trim()}\n`;
        await appendFile(target, line, 'utf8');

        return [
            '✅ Nota capturada correctamente.',
            `📁 Base: ${getWorkspaceBaseDir()}`,
            `🗂️ Bandeja: ${safeBucket}`,
            `📄 Archivo: ${filePathRelative}`,
        ].join('\n');
    },
});
