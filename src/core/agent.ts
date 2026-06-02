import { callLLM, type ChatMessage } from './llm';
import { saveMessage, getSmartContext } from './memory';
import { getToolDefinitions, executeTool } from './dispatcher';
import { logger } from './logger';
import { runWithToolContext } from './tool-context';
import { routeIntent } from './intent-router';
import { classifyDomain, getDomainToolSet, type Domain } from './domain-router';
import { detectTaskHallucination, requiresTaskAction, taskActionRetryHint } from './task-intent';
import { isDailyInfographicTask } from './search-locale';
import { startTrace, endTrace, incLlmCalls, incHallucinationRetries, setDomain, setIntent } from './tracer';

// Bootstrap all tools on first import
import '../tools/index';
import { loadPendingData } from '../tools/agent-tasks';
import { buildDuplicateReport, buildListDailyPending } from './pending-format';

/**
 * Main agent loop: processes a user message and returns the assistant's response.
 * Handles multi-step tool calling automatically.
 */
export async function processMessage(chatId: string, userMessage: string): Promise<string> {
    const traceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    return runWithToolContext({ chatId, traceId }, () => processMessageInner(chatId, userMessage, traceId));
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
    // Schedule/reminder claims (only unambiguous hallucination phrases — avoid tool output text)
    'te he recordado', 'ya lo programé', 'ya lo agendé',
    'ha sido programada', 'ha sido programado', 'está programada', 'esta programada',
    'ya está programada', 'ya esta programada', 'programada correctamente',
    'apuntada correctamente', 'mismo id', 'ya existía', 'ya existia',
    'en mi lista de tareas programadas',
];

// Tools whose results must be returned verbatim — LLM rewrite drops critical info (e.g. post ID).
const DIRECT_RESULT_TOOLS = new Set([
    'linkedin_propose_post', 'save_image', 'list_images', 'get_saved_audio', 'obsidian_read', 'obsidian_search', 'obsidian_write',
    'schedule_task', 'save_agent_task', 'create_infographic', 'create_infographic_notebooklm',
    'create_notebooklm_audio',
    'tts_generate',
]);

// After these tools execute, stop the agent loop immediately.
// linkedin_propose_post: result contains "/li_approve" — triggers hallucination detector → auto-approve.
// schedule_task / save_agent_task: stop immediately to prevent duplicate task creation — hallucination
// detector retries would call them again, creating the same reminder multiple times in the DB.
const STOP_AFTER_TOOLS = new Set(['save_image', 'list_images', 'get_saved_audio', 'linkedin_propose_post', 'tiktok_propose_video', 'generate_video', 'approve_tiktok_video', 'reject_tiktok_video', 'obsidian_read', 'obsidian_search', 'obsidian_write', 'schedule_task', 'save_agent_task', 'create_infographic', 'create_infographic_notebooklm', 'create_notebooklm_audio', 'tts_generate']);

// Tools excluded when processing an incoming photo — prevents proactive saves/generation.
const IMAGE_RECEIVAL_EXCLUDED_TOOLS = new Set(['save_image', 'list_images', 'generate_image']);

// Tools excluded when a scheduled task fires — prevents re-scheduling and re-saving the same task.
const SCHEDULED_EXEC_EXCLUDED_TOOLS = new Set(['schedule_task', 'list_scheduled_tasks', 'cancel_scheduled_task', 'save_agent_task', 'list_agent_tasks']);

function shouldStopAfterTool(
    toolName: string,
    userMessage: string,
    executedToolNames: string[]
): boolean {
    if (!STOP_AFTER_TOOLS.has(toolName)) return false;
    // Infografía + LinkedIn (manual o programada): no parar hasta linkedin_propose_post
    if (isDailyInfographicTask(userMessage)) {
        if (
            (toolName === 'create_infographic_notebooklm' || toolName === 'create_infographic') &&
            !executedToolNames.includes('linkedin_propose_post')
        ) {
            return false;
        }
        if (toolName === 'web_search') return false;
    }
    return true;
}

function extractPngUrlFromToolResult(result: string): string | null {
    const m = result.match(/🔗\s*(?:PNG:\s*)?(https:\/\/\S+)/);
    return m?.[1] ?? null;
}

async function processMessageInner(chatId: string, userMessage: string, traceId: string): Promise<string> {
    logger.info(`[trace:${traceId}] chatId=${chatId} msg="${userMessage.slice(0, 80)}"`);
    startTrace(traceId, chatId, userMessage);

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
    setIntent(traceId, intent.type);

    try {
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
        case 'list_audios': {
            const result = await executeTool('list_audios', intent.limit ? { limit: intent.limit } : {});
            await saveMessage(chatId, 'assistant', result);
            return result;
        }
        case 'get_saved_audio': {
            logger.info(`[agent] get_saved_audio query="${intent.query}"`);
            const result = await executeTool('get_saved_audio', { query: intent.query });
            await saveMessage(chatId, 'assistant', result);
            return result;
        }
        case 'list_all_pending': {
            const result = await executeTool('list_all_pending', {});
            await saveMessage(chatId, 'assistant', result);
            return result;
        }
        case 'list_daily_pending': {
            const { scheduled } = await loadPendingData(chatId);
            const result = buildListDailyPending(scheduled);
            await saveMessage(chatId, 'assistant', result);
            return result;
        }
        case 'check_duplicate_pending': {
            const { scheduled, agentTasks } = await loadPendingData(chatId);
            const result = buildDuplicateReport(scheduled, agentTasks);
            await saveMessage(chatId, 'assistant', result);
            return result;
        }
        case 'fetch_url': {
            const rawUrl = intent.url.trim();
            let parsed: URL;
            try {
                parsed = new URL(rawUrl);
            } catch {
                const msg = `El enlace parece incompleto o inválido: "${rawUrl}". Pásame la URL completa (https://...) y te la resumo.`;
                await saveMessage(chatId, 'assistant', msg);
                return msg;
            }
            if (!parsed.hostname || parsed.pathname === '/' || parsed.pathname.length < 3) {
                const msg = `El enlace parece incompleto: "${rawUrl}". Pásame la URL completa del artículo y te lo resumo.`;
                await saveMessage(chatId, 'assistant', msg);
                return msg;
            }
            const result = await executeTool('fetch_url', { url: rawUrl, max_chars: 5000 });
            await saveMessage(chatId, 'assistant', result);
            return result;
        }
        case 'browser_screenshot': {
            const rawUrl = intent.url.trim().replace(/^["'`]+|["'`]+$/g, '');
            const withScheme = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
            const result = await executeTool('browser_screenshot', { url: withScheme });
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
        case 'approve_tiktok': {
            logger.info(`[agent] approve_tiktok${intent.postId ? ` postId=${intent.postId}` : ''}`);
            const args = intent.postId ? { post_id: intent.postId } : {};
            const result = await executeTool('approve_tiktok_video', args);
            await saveMessage(chatId, 'assistant', result);
            return result;
        }
        // 'llm' falls through to the agent loop below
    }

    // ── LLM path ──────────────────────────────────────────────────────────────
    const { isImageReceival, cachedImageExists } = intent; // intent.type === 'llm'

    const conversation: ChatMessage[] = [...history];

    const allTools = getToolDefinitions();

    // ── Domain routing — filter tools to the relevant subset ─────────────────
    // isImageReceival overrides domain (strongest signal).
    // 'general' domain → null toolSet → expose all tools (backward-compatible).
    const isScheduledTaskFire = userMessage.startsWith('⏰ **Tarea programada**');
    const isScheduledInfographic = isScheduledTaskFire && isDailyInfographicTask(userMessage);
    let tools: typeof allTools;
    let activeDomain: Domain = 'general';
    if (isImageReceival) {
        tools = allTools.filter(t => !IMAGE_RECEIVAL_EXCLUDED_TOOLS.has(t.name));
    } else if (isScheduledInfographic) {
        // Flujo multi-paso: búsqueda + infografía + LinkedIn — no filtrar por dominio notes
        tools = allTools;
        activeDomain = 'linkedin';
    } else {
        activeDomain = classifyDomain(userMessage);
        setDomain(traceId, activeDomain);
        const domainToolSet = getDomainToolSet(activeDomain);
        tools = domainToolSet
            ? allTools.filter(t => domainToolSet.has(t.name))
            : allTools;
        if (activeDomain !== 'general') {
            logger.info(`[trace:${traceId}] domain=${activeDomain} tools=${tools.map(t => t.name).join(',')}`);
        }
    }
    // Scheduled task execution: strip scheduling tools to prevent re-schedule loops.
    if (isScheduledTaskFire) {
        tools = tools.filter(t => !SCHEDULED_EXEC_EXCLUDED_TOOLS.has(t.name));
        logger.info(`[trace:${traceId}] scheduled-exec: excluded schedule tools`);
    }

    const toolNames = tools.map((t) => t.name);

    // Warn the LLM when a cached photo exists — prevents it from calling generate_image
    if (cachedImageExists && !isImageReceival) {
        conversation.push({
            role: 'system',
            content: '[SISTEMA] Hay una imagen del usuario disponible en caché. Si quiere guardarla, usa save_image. NO llames generate_image — la imagen ya existe.',
        });
    }

    const taskActionRequired = requiresTaskAction(userMessage);
    if (taskActionRequired) {
        conversation.push({
            role: 'system',
            content: `[SISTEMA] ${taskActionRetryHint(userMessage)} Responde SOLO llamando la tool; no texto afirmando que ya lo hiciste.`,
        });
    }

    const wantsTts =
        /\b(convierte|convertir|lee|leer|pasa|pasar|genera|haz)\b/i.test(userMessage) &&
        /\b(audio|voz|mp3|voz alta)\b/i.test(userMessage);
    if (wantsTts && !isScheduledTaskFire) {
        conversation.push({
            role: 'system',
            content:
                '[SISTEMA] El usuario pide TTS. DEBES llamar tts_generate con el texto completo (voz jorge por defecto). ' +
                'El MP3 se envía solo por Telegram. Tras la tool, no añadas párrafos extra.',
        });
    }

    const wantsInfographicLinkedIn = isDailyInfographicTask(userMessage);

    if (isScheduledTaskFire) {
        if (isScheduledInfographic || wantsInfographicLinkedIn) {
            conversation.push({
                role: 'system',
                content:
                    '[SISTEMA] Infografía + LinkedIn en este turno. OBLIGATORIO: ' +
                    '1) web_search (noticias IA español), 2) create_infographic_notebooklm (o create_infographic si falla NotebookLM), ' +
                    '3) linkedin_propose_post con image_url del PNG. NO pares tras la infografía. ' +
                    'NO uses schedule_task ni save_agent_task.',
            });
        } else {
            conversation.push({
                role: 'system',
                content:
                    '[SISTEMA] Recordatorio automático. Responde en 1–3 frases cortas (máx 300 caracteres). ' +
                    'Sin preguntas al final. NO uses obsidian_read ni otras tools salvo que la instrucción lo pida explícitamente.',
            });
        }
    } else if (wantsInfographicLinkedIn) {
        conversation.push({
            role: 'system',
            content:
                '[SISTEMA] El usuario pide infografía + LinkedIn ahora. OBLIGATORIO: web_search → create_infographic_notebooklm → linkedin_propose_post con image_url del PNG. NO pares tras la infografía.',
        });
    }

    let response = await callLLM(conversation, tools, activeDomain);
    incLlmCalls(traceId);

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
            if (
                response.toolCalls.some((tc) =>
                    shouldStopAfterTool(tc.name, userMessage, executedToolNames)
                )
            ) {
                break agentLoop;
            }

            hallucinationRetries = 0;
            // Prevent calling generate_image more than once per request (expensive + confusing).
            if (executedToolNames.includes('generate_image')) {
                tools = tools.filter(t => t.name !== 'generate_image');
            }
            response = await callLLM(conversation, tools, activeDomain);
            incLlmCalls(traceId);

        } else {
            // No tool calls — detect hallucination and retry up to MAX_HALLUCINATION_RETRIES.
            const content = response.content ?? '';
            if (hallucinationRetries < MAX_HALLUCINATION_RETRIES) {
                const pendingTools = toolNames.filter((n) => !executedToolNames.includes(n));
                const claimedToolUse =
                    pendingTools.some((name) => content.includes(name)) ||
                    ACTION_PHRASES.some((phrase) => content.toLowerCase().includes(phrase)) ||
                    detectTaskHallucination(userMessage, content, executedToolNames);

                if (claimedToolUse) {
                    hallucinationRetries++;
                    incHallucinationRetries(traceId);
                    logger.warn(`[agent] LLM described tool usage without calling it — retry ${hallucinationRetries}/${MAX_HALLUCINATION_RETRIES}`);
                    const taskHint = requiresTaskAction(userMessage) ? ` ${taskActionRetryHint(userMessage)}` : '';
                    const hint = pendingTools.length > 0
                        ? ` Las herramientas disponibles que AÚN NO has llamado incluyen: ${pendingTools.slice(0, 6).join(', ')}.`
                        : '';
                    conversation.push({ role: 'assistant', content });
                    conversation.push({
                        role: 'user',
                        content: `SISTEMA: PROHIBIDO describir herramientas en texto. Describiste que usaste una herramienta pero NO la llamaste mediante tool_calls.${hint}${taskHint} DEBES llamarla AHORA usando el mecanismo estructurado de tool_calls. NO escribas más texto explicativo — llama la herramienta directamente. PROHIBIDO inventar IDs de tareas.`,
                    });
                    response = await callLLM(conversation, tools, activeDomain);
                    incLlmCalls(traceId);
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
    } finally {
        endTrace(traceId);
    }
}

function applyImageUrlFix(
    tc: { name: string; arguments: Record<string, unknown> },
    executedToolNames: string[],
    executedToolResults: string[],
    conversation: ChatMessage[]
): void {
    if (tc.name !== 'linkedin_propose_post') return;

    let realImageUrl: string | null = null;

    const imageTools = ['generate_image', 'create_infographic_notebooklm', 'create_infographic'] as const;
    for (const toolName of imageTools) {
        const idx = executedToolNames.lastIndexOf(toolName);
        if (idx !== -1) {
            realImageUrl = extractPngUrlFromToolResult(executedToolResults[idx]);
            if (realImageUrl) break;
        }
    }

    if (!realImageUrl) {
        for (let i = conversation.length - 1; i >= 0; i--) {
            const msg = conversation[i];
            if (msg.role !== 'user' || !msg.content.includes('[Tool Result:')) continue;
            if (!imageTools.some((t) => msg.content.includes(`[Tool Result: ${t}]`))) continue;
            realImageUrl = extractPngUrlFromToolResult(msg.content);
            if (realImageUrl) break;
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
