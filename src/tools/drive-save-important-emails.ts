import { registerTool } from '../core/dispatcher';
import { saveImportantEmailsToDrive } from '../integrations/google/google';

registerTool({
    name: 'drive_save_important_emails',
    description:
        'Save recent important Gmail emails into markdown files inside a Google Drive folder.',
    parameters: {
        type: 'object',
        properties: {
            folderId: {
                type: 'string',
                description: 'Target Google Drive folder ID',
            },
            limit: {
                type: 'string',
                description: 'How many important emails to save (default: 5, max: 20)',
            },
        },
        required: ['folderId'],
    },
    handler: async (args) => {
        const folderId = String(args.folderId ?? '').trim();
        const parsedLimit = Number(args.limit ?? 5);
        const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 20) : 5;

        if (!folderId) throw new Error('folderId es obligatorio');

        const result = await saveImportantEmailsToDrive(folderId, limit);
        if (result.total === 0) {
            return 'ℹ️ No se encontraron correos importantes para guardar.';
        }

        return [
            `✅ Correos importantes guardados en Drive: ${result.total}`,
            ...result.files.map((fileName) => `• ${fileName}`),
        ].join('\n');
    },
});
