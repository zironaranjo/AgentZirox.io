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
    // LinkedIn
    '/li_approve', 'li_approve', 'encolado', 'cola de publicación', 'cola de publicacion',
    'pendiente de aprobación', 'pendiente de aprobacion',
    'publicando el post', 'publicando en linkedin', 'publicando ahora', 'voy a publicar',
    'estoy publicando', 'he publicado', 'publicaré', 'ya está publicado',
    // Email
    'acabo de enviar', 'he enviado', 'correo enviado', 'email enviado',
    'ya envié', 'ya mandé', 'acabo de mandar', 'envié el correo', 'mandé el correo',
    'acabo de escribir', 'mensaje enviado',
    // Acciones genéricas reclamadas sin tool call
    'acabo de buscar', 'acabo de leer', 'acabo de crear', 'acabo de guardar',
    // Guardado de imágenes / archivos
    'he guardado', 'guardé', 'imagen guardada', 'la imagen fue guardada',
    'imagen ha sido guardada', 'guardada en supabase', 'guardada en storage',
    'url pública', 'url publica', 'storage.googleapis', 'supabase.co/storage',
];

// Tools whose results must be shown verbatim — LLM rewrite drops critical info (e.g. post ID)
const DIRECT_RESULT_TOOLS = new Set(['linkedin_propose_post', 'save_image', 'list_images']);

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

    // Fast path: explicit save-image request — LLM is unreliable calling save_image
    const isSaveImageRequest = /\b(guarda|archiva|salva|guarde|guardar)\b.{0,30}\b(imagen|foto|photo|picture)\b|\b(imagen|foto|photo|picture)\b.{0,30}\b(guarda|archiva|salva|guardar)\b/i.test(userMessage);
    if (isSaveImageRequest) {
        const labelMatch = userMessage.match(/(?:como|con etiqueta|etiqueta[:]?)\s+(.+)/i);
        const label = labelMatch ? labelMatch[1].trim() : '';
        logger.info(`[agent] Fast-path save_image${label ? ` label="${label}"` : ''}`);
        const result = await executeTool('save_image', label ? { label } : {});
        await saveMessage(chatId, 'assistant', result);
        return result;
    }

    const conversation: ChatMessage[] = [...history];
    const tools = getToolDefinitions();
    const toolNames = tools.map((t) => t.name);

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
            // Reset per tool-batch so generate_image → linkedin_propose_post chain gets retries.
            // Exception: after linkedin_propose_post we must NOT reset — the loop should end there
            // to avoid the LLM auto-approving the post without user confirmation.
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
                    logger.warn(`[agent] LLM described tool usage in text without calling it — retry ${hallucinationRetries}/${MAX_HALLUCINATION_RETRIES}`);
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

    // Return critical tool results verbatim — use LAST occurrence so that if the agent
    // retried and generated a new proposal (e.g. with image), that one wins over an earlier
    // imageless attempt.
    let directIdx = -1;
    for (let i = executedToolNames.length - 1; i >= 0; i--) {
        if (DIRECT_RESULT_TOOLS.has(executedToolNames[i])) { directIdx = i; break; }
    }
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
    if (tc.name !== 'linkedin_propose_post') return;

    let realImageUrl: string | null = null;

    // 1. Current turn results (generate_image already executed this iteration)
    const genIdx = executedToolNames.indexOf('generate_image');
    if (genIdx !== -1) {
        const m = executedToolResults[genIdx].match(/🔗\s*(https:\/\/\S+)/);
        if (m) realImageUrl = m[1];
    }

    // 2. Conversation history (image generated in a previous turn, e.g. LLM did two-step confirm)
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
        // Inject or correct — covers both missing image_url AND wrong URL cases
        const currentUrl = tc.arguments.image_url ? String(tc.arguments.image_url).trim() : null;
        if (currentUrl !== realImageUrl) {
            logger.warn(`[agent] ${currentUrl ? 'Corrigiendo' : 'Inyectando'} image_url → "${realImageUrl.slice(0, 60)}"`);
            tc.arguments = { ...tc.arguments, image_url: realImageUrl };
        }
        return;
    }

    // No generate_image result — validate existing URL if any, drop invalid ones
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
