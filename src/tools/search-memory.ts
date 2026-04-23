import { registerTool } from '../core/dispatcher';
import { getHistory } from '../core/memory';

registerTool({
    name: 'search_memory',
    description: 'Search recent conversation history for a keyword or topic.',
    parameters: {
        type: 'object',
        properties: {
            chat_id: { type: 'string', description: 'The chat ID to search in' },
            query: { type: 'string', description: 'Keyword or phrase to search for in history' },
        },
        required: ['chat_id', 'query'],
    },
    handler: async (args) => {
        const { chat_id, query } = args as { chat_id: string; query: string };
        const history = getHistory(chat_id, 100);
        const lq = query.toLowerCase();
        const matches = history.filter((m) => m.content.toLowerCase().includes(lq));
        if (matches.length === 0) return `No se encontraron mensajes que contengan: "${query}"`;
        return matches.map((m) => `[${m.role}]: ${m.content}`).join('\n---\n');
    },
});
