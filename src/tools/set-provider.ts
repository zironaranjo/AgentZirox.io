import { registerTool } from '../core/dispatcher.js';

registerTool({
    name: 'set_provider',
    description:
        'Switch the active LLM provider at runtime. Options: groq, openrouter, or hermes.',
    parameters: {
        type: 'object',
        properties: {
            provider: {
                type: 'string',
                description: 'LLM provider to activate',
                enum: ['groq', 'openrouter', 'hermes'],
            },
        },
        required: ['provider'],
    },
    handler: async (args) => {
        const { provider } = args as { provider: string };
        process.env.LLM_PROVIDER = provider;
        return `✅ Proveedor LLM cambiado a: **${provider}**`;
    },
});
