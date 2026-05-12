import { registerTool } from '../core/dispatcher';
import { searchMessagesSemantic } from '../core/memory';
import { embeddingAvailable } from '../core/embeddings';
import { getToolContext } from '../core/tool-context';

registerTool({
    name: 'search_memory',
    description:
        'Busca en el historial de conversación usando búsqueda semántica (inteligente). Usa esto cuando necesites recordar algo que se dijo antes, buscar por tema o contexto, o verificar información mencionada en conversaciones anteriores.',
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Tema, pregunta o frase a buscar. Puede ser semántico: "cuando hablamos de precios" o "decisiones sobre LinkedIn".',
            },
            limit: {
                type: 'number',
                description: 'Máximo de resultados (default 10, máximo 20)',
            },
        },
        required: ['query'],
    },
    handler: async (args) => {
        const chatId = getToolContext()?.chatId;
        if (!chatId) return 'No se pudo determinar el chat actual.';

        const query = String(args.query ?? '').trim();
        const limit = Math.min(20, Math.max(1, Number(args.limit ?? 10)));

        if (!query) return 'Necesito una consulta para buscar.';

        const results = await searchMessagesSemantic(chatId, query, limit);

        if (results.length === 0) {
            return `No encontré conversaciones relacionadas con: "${query}"`;
        }

        const mode = embeddingAvailable() ? '🔍 Semántica' : '🔤 Keyword';
        const lines = results.map((r) => {
            const tag = r.memory_type && r.memory_type !== 'episodic' ? ` [${r.memory_type}]` : '';
            return `[${r.role}${tag}]: ${r.content}`;
        });

        return `${mode} — ${results.length} resultado(s) para "${query}":\n\n${lines.join('\n---\n')}`;
    },
});
