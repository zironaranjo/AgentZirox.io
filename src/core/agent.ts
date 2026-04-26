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
            const result = await executeTool(tc.name, tc.arguments);
            logger.info(`🔧 Tool [${tc.name}] result:`, result.substring(0, 200));
            executedToolResults.push(result);
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

    const finalContent =
        response.content?.trim() ||
        (executedToolResults.length > 0 ? executedToolResults[executedToolResults.length - 1] : '') ||
        '✅ Hecho.';
    await saveMessage(chatId, 'assistant', finalContent);
    return finalContent;
}

