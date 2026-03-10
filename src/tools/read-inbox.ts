import { registerTool } from '../core/dispatcher.js';
import { readInbox } from '../integrations/email/imap.js';

registerTool({
    name: 'read_inbox',
    description: 'Read the most recent emails from the configured email inbox.',
    parameters: {
        type: 'object',
        properties: {
            limit: {
                type: 'string',
                description: 'Number of recent emails to fetch (default: 5, max: 20)',
            },
        },
        required: [],
    },
    handler: async (args) => {
        const limit = Math.min(Number(args.limit ?? 5), 20);
        const emails = await readInbox(limit);
        if (emails.length === 0) return '📭 No hay emails en el buzón.';
        return emails
            .map(
                (e, i) =>
                    `📧 **${i + 1}. ${e.subject}**\n` +
                    `De: ${e.from}\n` +
                    `Fecha: ${e.date}\n` +
                    `${e.body}\n`
            )
            .join('\n---\n');
    },
});
