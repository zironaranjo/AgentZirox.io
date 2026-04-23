import { registerTool } from '../core/dispatcher';
import { archiveImportantEmailsByFolderName } from '../integrations/google/google';

registerTool({
    name: 'drive_archive_important_emails',
    description:
        'Create a Google Drive folder and save recent important Gmail emails into it in one step.',
    parameters: {
        type: 'object',
        properties: {
            folderName: {
                type: 'string',
                description: 'Drive folder name to create, e.g. Clientes-Acme-Emails',
            },
            limit: {
                type: 'string',
                description: 'How many important emails to archive (default: 5, max: 20)',
            },
            parentFolderId: {
                type: 'string',
                description: 'Optional parent Drive folder ID',
            },
        },
        required: ['folderName'],
    },
    handler: async (args) => {
        const folderName = String(args.folderName ?? '').trim();
        const parsedLimit = Number(args.limit ?? 5);
        const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 20) : 5;
        const parentFolderId = String(args.parentFolderId ?? '').trim() || undefined;

        if (!folderName) throw new Error('folderName es obligatorio');

        const result = await archiveImportantEmailsByFolderName(folderName, limit, parentFolderId);

        return [
            '✅ Archivado completado en un solo paso.',
            `📁 Carpeta: ${result.folderName}`,
            `🆔 Folder ID: ${result.folderId}`,
            `📧 Correos guardados: ${result.total}`,
            ...result.files.map((f) => `• ${f}`),
        ].join('\n');
    },
});
