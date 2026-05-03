import { callLLM, type ChatMessage } from './llm';
import { getHistory, saveMessage } from './memory';
import { getToolDefinitions, executeTool } from './dispatcher';
import { logger } from './logger';
import { runWithToolContext } from './tool-context';

// Bootstrap all tools on first import
import '../tools/index';

/**
 * Main agent loop: processes a user message and returns the assistant's response.
 * Handles multi-step tool calling automatically.
 */
export async function processMessage(chatId: string, userMessage: string): Promise<string> {
    return runWithToolContext({ chatId }, () => processMessageInner(chatId, userMessage));
}

async function processMessageInner(chatId: string, userMessage: string): Promise<string> {
    // Persist the user message
    await saveMessage(chatId, 'user', userMessage);

    // Build context from recent history
    const history = (await getHistory(chatId, 20)) as ChatMessage[];
    const conversation: ChatMessage[] = [...history];
    const tools = getToolDefinitions();

    // First LLM call
    let response = await callLLM(conversation, tools);

    // Agentic loop: keep calling tools until LLM produces a final text response
    let iterations = 0;
    const MAX_ITERATIONS = 5;
    const executedToolResults: string[] = [];
    const executedToolNames: string[] = [];

    // Tools whose results must be shown verbatim — LLM rewrite tends to drop critical info (e.g. post ID)
    const DIRECT_RESULT_TOOLS = new Set(['linkedin_propose_post']);

    while (response.toolCalls && response.toolCalls.length > 0 && iterations < MAX_ITERATIONS) {
        iterations++;

        // Save assistant's tool-call intent
        if (response.content) {
            await saveMessage(chatId, 'assistant', response.content);
            conversation.push({ role: 'assistant', content: response.content });
        }

        // Execute each tool call and collect results
        const toolResults: ChatMessage[] = [];
        for (const tc of response.toolCalls) {
            // Auto-fix: the LLM frequently invents image URLs for linkedin_propose_post.
            // Always prefer the URL from generate_image — search current turn AND conversation history.
            if (tc.name === 'linkedin_propose_post' && tc.arguments.image_url) {
                let realImageUrl: string | null = null;

                // 1. Current turn results
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
                    const currentUrl = String(tc.arguments.image_url).trim();
                    if (currentUrl !== realImageUrl) {
                        logger.warn(`[agent] Corrigiendo image_url "${currentUrl.slice(0, 60)}" → "${realImageUrl.slice(0, 60)}"`);
                        tc.arguments = { ...tc.arguments, image_url: realImageUrl };
                    }
                } else {
                    // No generate_image result found; validate the URL and drop if invalid
                    const rawUrl = String(tc.arguments.image_url).trim();
                    let isValidHttps = false;
                    try { isValidHttps = new URL(rawUrl).protocol === 'https:'; } catch { /* invalid */ }
                    if (!isValidHttps) {
                        logger.warn(`[agent] image_url inválida sin generate_image de respaldo; se omite imagen`);
                        const { image_url: _drop, ...rest } = tc.arguments;
                        tc.arguments = rest;
                    }
                }
            }
            const result = await executeTool(tc.name, tc.arguments);
            logger.info(`🔧 Tool [${tc.name}] result:`, result.substring(0, 200));
            executedToolResults.push(result);
            executedToolNames.push(tc.name);
            // Add tool result back into conversation context
            toolResults.push({
                role: 'user',
                content: `[Tool Result: ${tc.name}]\n${result}`,
            });
        }

        // Continue the conversation with tool results
        conversation.push(...toolResults);
        response = await callLLM(conversation, tools);
    }

    let finalContent =
        response.content?.trim() ||
        (executedToolResults.length > 0 ? executedToolResults[executedToolResults.length - 1] : '') ||
        '✅ Hecho.';

    // Detect if the LLM described calling a tool in text without actually calling it.
    // Groq Llama sometimes writes about tool results instead of making real tool calls.
    if (executedToolResults.length === 0 && iterations === 0 && finalContent) {
        const toolNames = tools.map((t) => t.name);
        // Check tool name mentions OR action phrases that imply a tool was used
        const actionPhrases = [
            '/li_approve', 'li_approve', 'encolado', 'cola de publicación', 'cola de publicacion',
            'pendiente de aprobación', 'pendiente de aprobacion', 'schedule_task', 'programado',
            'tarea programada', 'recordatorio programado',
            // LinkedIn approval hallucination patterns
            'publicando el post', 'publicando en linkedin', 'publicando ahora', 'voy a publicar',
            'estoy publicando', 'he publicado', 'publicaré', 'ya está publicado',
        ];
        const claimedToolUse =
            toolNames.some((name) => finalContent.includes(name)) ||
            actionPhrases.some((phrase) => finalContent.toLowerCase().includes(phrase));
        if (claimedToolUse) {
            logger.warn('[agent] LLM described tool usage in text without calling it — retrying with correction');
            conversation.push({ role: 'assistant', content: finalContent });
            conversation.push({
                role: 'user',
                content:
                    'SISTEMA: Describiste en texto que usaste una herramienta pero no la llamaste realmente mediante tool_calls. Debes LLAMAR la herramienta usando el mecanismo estructurado. Inténtalo de nuevo ahora.',
            });
            const retryResponse = await callLLM(conversation, tools);
            if (retryResponse.toolCalls && retryResponse.toolCalls.length > 0) {
                for (const tc of retryResponse.toolCalls) {
                    // Same image URL fix as main loop — retry path is equally vulnerable to invented URLs
                    if (tc.name === 'linkedin_propose_post' && tc.arguments.image_url) {
                        let realImageUrl: string | null = null;
                        const genIdx = executedToolNames.indexOf('generate_image');
                        if (genIdx !== -1) {
                            const m = executedToolResults[genIdx].match(/🔗\s*(https:\/\/\S+)/);
                            if (m) realImageUrl = m[1];
                        }
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
                            const currentUrl = String(tc.arguments.image_url).trim();
                            if (currentUrl !== realImageUrl) {
                                logger.warn(`[agent] (retry) Corrigiendo image_url "${currentUrl.slice(0, 60)}" → "${realImageUrl.slice(0, 60)}"`);
                                tc.arguments = { ...tc.arguments, image_url: realImageUrl };
                            }
                        } else {
                            const rawUrl = String(tc.arguments.image_url).trim();
                            let isValidHttps = false;
                            try { isValidHttps = new URL(rawUrl).protocol === 'https:'; } catch { /* invalid */ }
                            if (!isValidHttps) {
                                logger.warn(`[agent] (retry) image_url inválida sin generate_image de respaldo; se omite imagen`);
                                const { image_url: _drop, ...rest } = tc.arguments;
                                tc.arguments = rest;
                            }
                        }
                    }
                    const result = await executeTool(tc.name, tc.arguments);
                    logger.info(`🔧 Tool (retry) [${tc.name}] result:`, result.substring(0, 200));
                    executedToolResults.push(result);
                    executedToolNames.push(tc.name);
                    conversation.push({ role: 'user', content: `[Tool Result: ${tc.name}]\n${result}` });
                }
                const finalRetry = await callLLM(conversation, tools);
                finalContent = finalRetry.content?.trim() || executedToolResults[executedToolResults.length - 1] || '✅ Hecho.';
            }
        }
    }

    // For tools that carry critical structured data (post ID, etc.), bypass LLM rewrite
    // and return the tool result directly so the user always sees the exact ID and commands.
    const directIdx = executedToolNames.findIndex((n) => DIRECT_RESULT_TOOLS.has(n));
    if (directIdx !== -1 && executedToolResults[directIdx]) {
        finalContent = executedToolResults[directIdx];
    }

    await saveMessage(chatId, 'assistant', finalContent);
    return finalContent;
}

