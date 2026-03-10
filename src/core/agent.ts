import { callLLM, type ChatMessage } from './llm.js';
import { getHistory, saveMessage } from './memory.js';
import { getToolDefinitions, executeTool } from './dispatcher.js';
import { logger } from './logger.js';

// Bootstrap all tools on first import
import '../tools/index.js';

/**
 * Main agent loop: processes a user message and returns the assistant's response.
 * Handles multi-step tool calling automatically.
 */
export async function processMessage(chatId: string, userMessage: string): Promise<string> {
    // Persist the user message
    saveMessage(chatId, 'user', userMessage);

    // Build context from recent history
    const history = getHistory(chatId, 20) as ChatMessage[];
    const tools = getToolDefinitions();

    // First LLM call
    let response = await callLLM(history, tools);

    // Agentic loop: keep calling tools until LLM produces a final text response
    let iterations = 0;
    const MAX_ITERATIONS = 5;

    while (response.toolCalls && response.toolCalls.length > 0 && iterations < MAX_ITERATIONS) {
        iterations++;

        // Save assistant's tool-call intent
        if (response.content) {
            saveMessage(chatId, 'assistant', response.content);
        }

        // Execute each tool call and collect results
        const toolResults: ChatMessage[] = [];
        for (const tc of response.toolCalls) {
            const result = await executeTool(tc.name, tc.arguments);
            logger.info(`🔧 Tool [${tc.name}] result:`, result.substring(0, 200));
            // Add tool result back into conversation context
            toolResults.push({
                role: 'user',
                content: `[Tool Result: ${tc.name}]\n${result}`,
            });
        }

        // Continue the conversation with tool results
        const updatedHistory = getHistory(chatId, 20) as ChatMessage[];
        response = await callLLM([...updatedHistory, ...toolResults], tools);
    }

    const finalContent = response.content || '✅ Hecho.';
    saveMessage(chatId, 'assistant', finalContent);
    return finalContent;
}
