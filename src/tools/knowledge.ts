import { registerTool } from '../core/dispatcher';
import { addKnowledge, deleteKnowledge, listKnowledge, searchKnowledge } from '../core/memory';
import { embeddingAvailable, generateEmbedding } from '../core/embeddings';

registerTool({
    name: 'add_knowledge',
    description:
        'Añade o actualiza un documento en la base de conocimiento del agente (servicios, precios, FAQs, info de clientes, políticas, etc.). Úsalo cuando el usuario quiera que recuerdes información importante de forma permanente y estructurada.',
    parameters: {
        type: 'object',
        properties: {
            title: { type: 'string', description: 'Título corto del documento (ej: "Precios servicios 2026")' },
            content: { type: 'string', description: 'Contenido completo del documento' },
            tags: {
                type: 'string',
                description: 'Etiquetas opcionales separadas por comas (ej: "precios, servicios")',
            },
        },
        required: ['title', 'content'],
    },
    handler: async (args) => {
        const a = args as { title?: string; content?: string; tags?: string[] };
        const title = String(a.title ?? '').trim();
        const content = String(a.content ?? '').trim();
        const tagsRaw = String(a.tags ?? '').trim();
        const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];
        if (!title) throw new Error('title es obligatorio');
        if (!content) throw new Error('content es obligatorio');

        let embedding: number[] | null = null;
        if (embeddingAvailable()) {
            embedding = await generateEmbedding(`${title}\n\n${content}`);
        }

        const id = await addKnowledge(title, content, tags, embedding);
        return `✅ Documento guardado en la base de conocimiento.\n🆔 id: ${id}\n📄 "${title}"${tags.length ? `\n🏷️ Tags: ${tags.join(', ')}` : ''}${!embeddingAvailable() ? '\n⚠️ Sin embeddings (OPENAI_API_KEY no configurada) — la búsqueda será por palabras clave.' : ''}`;
    },
});

registerTool({
    name: 'search_knowledge',
    description:
        'Busca documentos relevantes en la base de conocimiento. Úsalo cuando necesites contexto sobre servicios, precios, políticas o cualquier información que el usuario haya guardado previamente.',
    parameters: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Pregunta o tema a buscar' },
            limit: { type: 'number', description: 'Máximo de resultados (1-10, por defecto 5)' },
        },
        required: ['query'],
    },
    handler: async (args) => {
        const a = args as { query?: string; limit?: number };
        const query = String(a.query ?? '').trim();
        const limit = Math.min(10, Math.max(1, Number(a.limit ?? 5)));
        if (!query) throw new Error('query es obligatorio');

        let embedding: number[] | null = null;
        if (embeddingAvailable()) {
            embedding = await generateEmbedding(query);
        }

        const results = await searchKnowledge(embedding, query, limit);
        if (results.length === 0) return 'No se encontraron documentos relevantes para esa búsqueda.';

        const lines = results.map((r, i) => {
            const tags = r.tags.length ? ` [${r.tags.join(', ')}]` : '';
            return `### ${i + 1}. ${r.title}${tags}\n${r.content}`;
        });
        return lines.join('\n\n---\n\n');
    },
});

registerTool({
    name: 'list_knowledge',
    description: 'Lista todos los documentos guardados en la base de conocimiento (solo títulos e IDs).',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: async () => {
        const docs = await listKnowledge();
        if (docs.length === 0) return 'La base de conocimiento está vacía. Usa add_knowledge para añadir documentos.';
        const lines = docs.map((d) => {
            const tags = d.tags.length ? ` [${d.tags.join(', ')}]` : '';
            return `• #${d.id} — ${d.title}${tags}`;
        });
        return `📚 Base de conocimiento (${docs.length} documentos):\n\n${lines.join('\n')}`;
    },
});

registerTool({
    name: 'delete_knowledge',
    description: 'Elimina un documento de la base de conocimiento por su ID.',
    parameters: {
        type: 'object',
        properties: {
            id: { type: 'number', description: 'ID del documento a eliminar' },
        },
        required: ['id'],
    },
    handler: async (args) => {
        const id = Number((args as { id?: unknown }).id);
        if (!Number.isFinite(id)) throw new Error('id inválido');
        const ok = await deleteKnowledge(id);
        return ok ? `✅ Documento #${id} eliminado.` : `No se encontró el documento #${id}.`;
    },
});
