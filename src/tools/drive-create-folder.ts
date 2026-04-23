import { registerTool } from '../core/dispatcher';
import { createDriveFolder } from '../integrations/google/google';

registerTool({
    name: 'drive_create_folder',
    description: 'Create a folder in Google Drive using configured OAuth credentials.',
    parameters: {
        type: 'object',
        properties: {
            name: {
                type: 'string',
                description: 'Folder name to create in Google Drive',
            },
            parentFolderId: {
                type: 'string',
                description: 'Optional parent folder ID in Google Drive',
            },
        },
        required: ['name'],
    },
    handler: async (args) => {
        const name = String(args.name ?? '').trim();
        const parentFolderId = String(args.parentFolderId ?? '').trim() || undefined;
        if (!name) throw new Error('name es obligatorio');

        const folder = await createDriveFolder(name, parentFolderId);
        return [
            '✅ Carpeta creada en Google Drive.',
            `📁 Nombre: ${folder.name}`,
            `🆔 ID: ${folder.id}`,
        ].join('\n');
    },
});
