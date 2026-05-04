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

const ACTION_PHRASES = [
    '/li_approve', 'li_approve', 'encolado', 'cola de publicación', 'cola de publicacion',
    'pendiente de aprobación', 'pendiente de aprobacion', 'schedule_task', 'programado',
    'tarea programada', 'recordatorio programado',
    'publicando el post', 'publicando en linkedin', 'publicando ahora', 'voy a publicar',
    'estoy publicando', 'he publicado', 'publicaré', 'ya está publicado',
];

// Tools whose results must be shown verbatim — LLM rewrite drops critical info (e.g. post ID)
const DIRECT_RESULT_TOOLS = new Set(['linkedin_propose_post']);

async function processMessageInner(chatId: string, userMessage: string): Promise<string> {
    await saveMessage(chatId, 'user', userMessage);

    const history = (await getHistory(chatId, 20)) as ChatMessage[];

    // Fast path: bare approval phrase right after a LinkedIn post was proposed
    // The LLM is unreliable at calling approve_linkedin_post so we bypass it.
    const isSimpleApproval = /^(si|sí|sip|dale|adelante|aprueba|aprobad[oa]|aprovad[oa]|hazlo|publícalo|publicalo|ok|okey|venga|vamos|perfecto|listo|aprobado|aprovado|aprobada|aprovada)[\s.!?]*$/i.test(userMessage.trim());
    if (isSimpleApproval) {
        let lastBotContent = '';
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].role === 'assistant') { lastBotContent = history[i].content; break; }
        }
        const liApproveMatch = lastBotContent.match(/\/li_approve\s+(\d+)/);
        if (liApproveMatch) {
            const postId = parseInt(liApproveMatch[1], 10);
            logger.info(`[agent] Fast-path approval for LinkedIn post #${postId}`);
            const result = await executeTool('approve_linkedin_post', { post_id: postId });
            await saveMessage(chatId, 'assistant', result);
            return result;
        }
    }

    const conversation: ChatMessage[] = [...history];
    const tools = getToolDefinitions();
    const toolNames = tools.map((t) => t.name);

    let response = await callLLM(conversation, tools);

    let iterations = 0;
    const MAX_ITERATIONS = 8;
    const executedToolResults: string[] = [];
    const executedToolNames: string[] = [];
    let hallucinationRetried = false;

    // Unified loop: executes tools, detects and recovers from hallucinations, then continues.
    // The old separate retry block was replaced here so that tools called in a retry response
    // (e.g. generate_image) continue to the next iteration and can call more tools
    // (e.g. linkedin_propose_post) rather than being cut off by an ignored finalRetry call.
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
            response = await callLLM(conversation, tools);

        } else {
            // No tool calls in this response.
            // Detect hallucination on the first text response (before any tools ran).
            // Only retry once to avoid infinite loops.
            const content = response.content ?? '';
            if (!hallucinationRetried && executedToolResults.length === 0) {
                const claimedToolUse =
                    toolNames.some((name) => content.includes(name)) ||
                    ACTION_PHRASES.some((phrase) => content.toLowerCase().includes(phrase));

                if (claimedToolUse) {
                    logger.warn('[agent] LLM described tool usage in text without calling it — retrying');
                    hallucinationRetried = true;
                    conversation.push({ role: 'assistant', content });
                    conversation.push({
                        role: 'user',
                        content: 'SISTEMA: Describiste en texto que usaste una herramienta pero no la llamaste realmente mediante tool_calls. Debes LLAMAR la herramienta usando el mecanismo estructurado. Inténtalo de nuevo ahora.',
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

    // Return critical tool results verbatim (never let LLM rewrite post IDs, etc.)
    const directIdx = executedToolNames.findIndex((n) => DIRECT_RESULT_TOOLS.has(n));
    if (directIdx !== -1 && executedToolResults[directIdx]) {
        finalContent = executedToolResults[directIdx];
    }

    await saveMessage(chatId, 'assistant', finalContent);
    return finalContent;
}

function applyImageUrlFix(
    tc: { name: string; arguments: Record<string, unknown> },
    executedToolNames: string[],
    executedToolResults: string[],
    conversation: ChatMessage[]
): void {
    if (tc.name !== 'linkedin_propose_post' || !tc.arguments.image_url) return;

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
        const currentUrl = String(tc.arguments.image_url).trim();
        if (currentUrl !== realImageUrl) {
            logger.warn(`[agent] Corrigiendo image_url "${currentUrl.slice(0, 60)}" → "${realImageUrl.slice(0, 60)}"`);
            tc.arguments = { ...tc.arguments, image_url: realImageUrl };
        }
    } else {
        // No generate_image result — validate and drop invalid URLs to avoid ENOTFOUND at publish
        const rawUrl = String(tc.arguments.image_url).trim();
        let isValidHttps = false;
        try { isValidHttps = new URL(rawUrl).protocol === 'https:'; } catch { /* invalid */ }
        if (!isValidHttps) {
            logger.warn('[agent] image_url inválida sin generate_image de respaldo; se omite imagen');
            const { image_url: _drop, ...rest } = tc.arguments;
            tc.arguments = rest;
        }
    }
}
