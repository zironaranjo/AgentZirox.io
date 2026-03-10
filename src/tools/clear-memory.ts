import { registerTool } from '../core/dispatcher.js';
import { clearHistory } from '../core/memory.js';

registerTool({
    name: 'clear_memory',
    description: 'Clear the conversation history for this chat. Use when user asks to forget the conversation or start fresh.',
    parameters: {
        type: 'object',
        properties: {
            chat_id: { type: 'string', description: 'The chat ID to clear memory for' },
        },
        required: ['chat_id'],
    },
    handler: async (args) => {
        const { chat_id } = args as { chat_id: string };
        clearHistory(chat_id);
        return '✅ Memoria limpiada. Empezamos de nuevo!';
    },
});
