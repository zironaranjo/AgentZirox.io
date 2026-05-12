import { callLLM, type ChatMessage } from './llm';
import { saveMessage, getSmartContext } from './memory';
import { getToolDefinitions, executeTool } from './dispatcher';
import { logger } from './logger';
import { runWithToolContext } from './tool-context';
import { routeIntent } from './intent-router';

// Bootstrap all tools on first import
import '../tools/index';

/**
 * Main agent loop: processes a user message and returns the assistant's response.
 * Handles multi-step tool calling automatically.
 */
export async function processMessage(chatId: string, userMessage: string): Promise<string> {
    return runWithToolContext({ chatId }, () => processMessageInner(chatId, userMessage));
}

// Phrases the LLM writes when it describes tool usage in text without calling the tool.
// Triggers a retry that forces the LLM to use the structured tool_calls mechanism.
const ACTION_PHRASES = [
    // LinkedIn
    '/li_approve', 'li_approve', 'encolado', 'cola de publicación', 'cola de publicacion',
    'pendiente de aprobación', 'pendiente de aprobacion',
    'publicando el post', 'publicando en linkedin', 'publicando ahora', 'voy a publicar',
    'estoy publicando', 'he publicado', 'publicaré', 'ya está publicado',
    // Email
    'acabo de enviar', 'he enviado', 'correo enviado', 'email enviado',
    'ya envié', 'ya mandé', 'acabo de mandar', 'envié el correo', 'mandé el correo',
    'acabo de escribir', 'mensaje enviado',
    // Generic claimed actions without tool call
    'acabo de buscar', 'acabo de leer', 'acabo de crear', 'acabo de guardar',
    // Image storage
    'he guardado', 'guardé', 'imagen guardada', 'la imagen fue guardada',
    'imagen ha sido guardada', 'guardada en supabase', 'guardada en storage',
    'url pública', 'url publica', 'storage.googleapis', 'supabase.co/storage',
];

// Tools whose results must be returned verbatim — LLM rewrite drops critical info (e.g. post ID).
const DIRECT_RESULT_TOOLS = new Set(['linkedin_propose_post', 'save_image', 'list_images']);

// After these tools execute, stop the agent loop immediately.
// Prevents hallucination-retry from re-calling save_image after cache is cleared (⚠️ double-response).
const STOP_AFTER_TOOLS = new Set(['save_image', 'list_images']);

// Tools excluded when processing an incoming photo — prevents proactive saves/generation.
const IMAGE_RECEIVAL_EXCLUDED_TOOLS = new Set(['save_image', 'list_images', 'generate_image']);

async function processMessageInner(chatId: string, userMessage: string): Promise<string> {
    const traceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    logger.info(`[trace:${traceId}] chatId=${chatId} msg="${userMessage.slice(0, 80)}"`);

    await saveMessage(chatId, 'user', userMessage);

    // Semantic context: ~65% recent messages + ~35% semantically relevant older ones
    const history = (await getSmartContext(chatId, userMessage, 20)) as ChatMessage[];

    // Resolve last assistant message for context-aware intent detection
    let lastBotContent = '';
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role === 'assistant') { lastBotContent = history[i].content; break; }
    }

    // ── Intent classification ─────────────────────────────────────────────────
    const intent = routeIntent(userMessage, lastBotContent, chatId);
    logger.info(`[trace:${traceId}] intent=${intent.type}`);

    // ── Deterministic dispatch (no LLM needed) ────────────────────────────────
    switch (intent.type) {
        case 'save_image': {
            logger.info(`[agent] save_image${intent.label ? ` label="${intent.label}"` : ''}`);
            const result = await executeTool('save_image', intent.label ? { label: intent.label } : {});
            await saveMessage(chatId, 'assistant', result);
            return result;
        }
        case 'list_images': {
            const result = await executeTool('list_images', intent.limit ? { limit: intent.limit } : {});
            await saveMessage(chatId, 'assistant', result);
            return result;
        }
        case 'delete_image': {
            logger.info(`[agent] delete_image id=${intent.id}`);
            const result = await executeTool('delete_image', { id: intent.id });
            await saveMessage(chatId, 'assistant', result);
            return result;
        }
        case 'get_saved_image': {
            logger.info(`[agent] get_saved_image query="${intent.query}"`);
            const result = await executeTool('get_saved_image', { query: intent.query });
            await saveMessage(chatId, 'assistant', result);
            return result;
        }
        case 'approve_linkedin': {
            logger.info(`[agent] approve_linkedin${intent.postId ? ` postId=${intent.postId}` : ''}`);
            const args = intent.postId ? { post_id: intent.postId } : {};
            const result = await executeTool('approve_linkedin_post', args);
            await saveMessage(chatId, 'assistant', result);
            return result;
        }
        // 'llm' falls through to the agent loop below
    }

    // ── LLM path ──────────────────────────────────────────────────────────────
    const { isImageReceival, cachedImageExists } = intent; // intent.type === 'llm'

    const conversation: ChatMessage[] = [...history];

    const allTools = getToolDefinitions();
    const tools = isImageReceival
        ? allTools.filter(t => !IMAGE_RECEIVAL_EXCLUDED_TOOLS.has(t.name))
        : allTools;
    const toolNames = tools.map((t) => t.name);

    // Warn the LLM when a cached photo exists — prevents it from calling generate_image
    if (cachedImageExists && !isImageReceival) {
        conversation.push({
            role: 'system',
            content: '[SISTEMA] Hay una imagen del usuario disponible en caché. Si quiere guardarla, usa save_image. NO llames generate_image — la imagen ya existe.',
        });
    }

    let response = await callLLM(conversation, tools);

    let iterations = 0;
    const MAX_ITERATIONS = 8;
    const MAX_HALLUCINATION_RETRIES = 3;
    const executedToolResults: string[] = [];
    const executedToolNames: string[] = [];
    let hallucinationRetries = 0;

    agentLoop: while (iterations < MAX_ITERATIONS) {
        if (response.toolCalls && response.toolCalls.length > 0) {
            iterations++;

            if (response.content) {
                await saveMessage(chatId, 'assistant', response.content);
                conversation.push({ role: 'assistant', content: response.content });
            }

            const toolResults: ChatMessage[] = [];
            for (const tc of response.toolCalls) {
                applyImageUrlFix(tc, executedToolNames, executedToolResults, conversation);
                const result = await executeTool(tc.name, tc.arguments);
                logger.info(`🔧 Tool [${tc.name}] result:`, result.substring(0, 200));
                executedToolResults.push(result);
                executedToolNames.push(tc.name);
                toolResults.push({ role: 'user', content: `[Tool Result: ${tc.name}]\n${result}` });
            }

            conversation.push(...toolResults);

            // Stop immediately after tools with verbatim output (prevents double-call on retry).
            if (response.toolCalls.some(tc => STOP_AFTER_TOOLS.has(tc.name))) break agentLoop;

            // Reset hallucination counter per tool-batch.
            // Exception: after linkedin_propose_post keep the counter so the loop ends there
            // and prevents the LLM from auto-approving without user confirmation.
            const justProposed = executedToolNames.includes('linkedin_propose_post');
            if (!justProposed) hallucinationRetries = 0;
            response = await callLLM(conversation, tools);

        } else {
            // No tool calls — detect hallucination and retry up to MAX_HALLUCINATION_RETRIES.
            const content = response.content ?? '';
            if (hallucinationRetries < MAX_HALLUCINATION_RETRIES) {
                const pendingTools = toolNames.filter((n) => !executedToolNames.includes(n));
                const claimedToolUse =
                    pendingTools.some((name) => content.includes(name)) ||
                    ACTION_PHRASES.some((phrase) => content.toLowerCase().includes(phrase));

                if (claimedToolUse) {
                    hallucinationRetries++;
                    logger.warn(`[agent] LLM described tool usage without calling it — retry ${hallucinationRetries}/${MAX_HALLUCINATION_RETRIES}`);
                    const hint = pendingTools.length > 0
                        ? ` Las herramientas disponibles que AÚN NO has llamado incluyen: ${pendingTools.slice(0, 6).join(', ')}.`
                        : '';
                    conversation.push({ role: 'assistant', content });
                    conversation.push({
                        role: 'user',
                        content: `SISTEMA: PROHIBIDO describir herramientas en texto. Describiste que usaste una herramienta pero NO la llamaste mediante tool_calls.${hint} DEBES llamarla AHORA usando el mecanismo estructurado de tool_calls. NO escribas más texto explicativo — llama la herramienta directamente.`,
                    });
                    response = await callLLM(conversation, tools);
                    continue agentLoop;
                }
            }

            break agentLoop;
        }
    }

    let finalContent =
        response.content?.trim() ||
        (executedToolResults.length > 0 ? executedToolResults[executedToolResults.length - 1] : '') ||
        '✅ Hecho.';

    // Return critical tool results verbatim — use LAST occurrence so a retry with image
    // wins over an earlier imageless attempt.
    let directIdx = -1;
    for (let i = executedToolNames.length - 1; i >= 0; i--) {
        if (DIRECT_RESULT_TOOLS.has(executedToolNames[i])) { directIdx = i; break; }
    }
    if (directIdx !== -1 && executedToolResults[directIdx]) {
        finalContent = executedToolResults[directIdx];
    }

    logger.info(`[trace:${traceId}] done tools=${executedToolNames.join(',') || 'none'} iter=${iterations}`);
    await saveMessage(chatId, 'assistant', finalContent);
    return finalContent;
}

function applyImageUrlFix(
    tc: { name: string; arguments: Record<string, unknown> },
    executedToolNames: string[],
    executedToolResults: string[],
    conversation: ChatMessage[]
): void {
    if (tc.name !== 'linkedin_propose_post') return;

    let realImageUrl: string | null = null;

    // 1. Current turn results (generate_image already executed this iteration)
    const genIdx = executedToolNames.indexOf('generate_image');
    if (genIdx !== -1) {
        const m = executedToolResults[genIdx].match(/🔗\s*(https:\/\/\S+)/);
        if (m) realImageUrl = m[1];
    }

    // 2. Conversation history (image generated in a previous turn)
    if (!realImageUrl) {
        for (let i = conversation.length - 1; i >= 0; i--) {
            const msg = conversation[i];
            if (msg.role === 'user' && msg.content.includes('[Tool Result: generate_image]')) {
                const m = msg.content.match(/🔗\s*(https:\/\/\S+)/);
                if (m) { realImageUrl = m[1]; break; }
            }
        }
    }

    if (realImageUrl) {
        const currentUrl = tc.arguments.image_url ? String(tc.arguments.image_url).trim() : null;
        if (currentUrl !== realImageUrl) {
            logger.warn(`[agent] ${currentUrl ? 'Corrigiendo' : 'Inyectando'} image_url → "${realImageUrl.slice(0, 60)}"`);
            tc.arguments = { ...tc.arguments, image_url: realImageUrl };
        }
        return;
    }

    // No generate_image result — validate existing URL, drop invalid ones
    if (!tc.arguments.image_url) return;
    const rawUrl = String(tc.arguments.image_url).trim();
    let isValidHttps = false;
    try { isValidHttps = new URL(rawUrl).protocol === 'https:'; } catch { /* invalid */ }
    if (!isValidHttps) {
        logger.warn('[agent] image_url inválida sin generate_image de respaldo; se omite imagen');
        const { image_url: _drop, ...rest } = tc.arguments;
        tc.arguments = rest;
    }
}
