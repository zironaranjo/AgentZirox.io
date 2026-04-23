import { registerTool, listTools } from '../core/dispatcher';

registerTool({
    name: 'list_tools',
    description: 'List all available tools that AgenteZirox can use.',
    parameters: {
        type: 'object',
        properties: {},
        required: [],
    },
    handler: async () => {
        const tools = listTools();
        return `🔧 Herramientas disponibles:\n${tools.map((t) => `• ${t}`).join('\n')}`;
    },
});
