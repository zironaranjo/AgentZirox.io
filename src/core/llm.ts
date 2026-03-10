import Groq from 'groq-sdk';
import OpenAI from 'openai';

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface LLMTool {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

export interface LLMResponse {
    content: string;
    toolCalls?: Array<{
        id: string;
        name: string;
        arguments: Record<string, unknown>;
    }>;
}

// ── Groq client ──────────────────────────────────────────────────────────────
const groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── OpenRouter client (OpenAI-compatible) ────────────────────────────────────
const openRouterClient = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
        'HTTP-Referer': 'https://agentezirox.io',
        'X-Title': 'AgenteZirox',
    },
});

type Provider = 'groq' | 'openrouter';

function getProvider(): Provider {
    const p = (process.env.LLM_PROVIDER ?? 'groq').toLowerCase();
    if (p === 'openrouter') return 'openrouter';
    return 'groq';
}

const SYSTEM_PROMPT = `Eres AgenteZirox, un agente de IA personal altamente capaz.
Tienes acceso a herramientas para enviar emails, llamar APIs externas, buscar en tu memoria y más.
Responde siempre en el idioma del usuario. Sé conciso, útil y proactivo.
Fecha y hora actual: ${new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}`;

/**
 * Call the active LLM provider with messages and optional tools
 */
export async function callLLM(
    messages: ChatMessage[],
    tools?: LLMTool[]
): Promise<LLMResponse> {
    const provider = getProvider();
    const fullMessages: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages,
    ];

    if (provider === 'groq') {
        return callGroq(fullMessages, tools);
    } else {
        return callOpenRouter(fullMessages, tools);
    }
}

async function callGroq(messages: ChatMessage[], tools?: LLMTool[]): Promise<LLMResponse> {
    const model = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile';

    const params: any = {
        model,
        messages: messages as any,
        temperature: 0.7,
        max_tokens: 2048,
    };

    if (tools && tools.length > 0) {
        params.tools = tools.map((t) => ({
            type: 'function' as const,
            function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
            },
        }));
        params.tool_choice = 'auto';
    }

    const res = await groqClient.chat.completions.create(params);
    const choice = res.choices[0];
    const msg = choice.message;

    const toolCalls = msg.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>,
    }));

    return {
        content: msg.content ?? '',
        toolCalls,
    };
}

async function callOpenRouter(messages: ChatMessage[], tools?: LLMTool[]): Promise<LLMResponse> {
    const model = process.env.OPENROUTER_MODEL ?? 'anthropic/claude-3.5-sonnet';

    const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
        model,
        messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
        temperature: 0.7,
        max_tokens: 2048,
    };

    if (tools && tools.length > 0) {
        params.tools = tools.map((t) => ({
            type: 'function' as const,
            function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
            },
        }));
        params.tool_choice = 'auto';
    }

    const res = await openRouterClient.chat.completions.create(params);
    const choice = res.choices[0];
    const msg = choice.message;

    const toolCalls = msg.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>,
    }));

    return {
        content: msg.content ?? '',
        toolCalls,
    };
}
