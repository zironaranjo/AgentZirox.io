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

// ── Lazy clients — created on first use so missing keys don't crash startup ──
let _groqClient: Groq | null = null;
let _openRouterClient: OpenAI | null = null;
let _hermesClient: OpenAI | null = null;

function getGroqClient(): Groq {
    if (!_groqClient) {
        _groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY ?? '' });
    }
    return _groqClient;
}

function getOpenRouterClient(): OpenAI {
    if (!_openRouterClient) {
        _openRouterClient = new OpenAI({
            apiKey: process.env.OPENROUTER_API_KEY ?? '',
            baseURL: 'https://openrouter.ai/api/v1',
            defaultHeaders: {
                'HTTP-Referer': 'https://agentezirox.io',
                'X-Title': 'AgenteZirox',
            },
        });
    }
    return _openRouterClient;
}

function getHermesClient(): OpenAI {
    if (!_hermesClient) {
        _hermesClient = new OpenAI({
            apiKey: process.env.HERMES_API_KEY ?? '',
            baseURL: process.env.HERMES_BASE_URL ?? 'http://localhost:11434/v1',
        });
    }
    return _hermesClient;
}


type Provider = 'groq' | 'openrouter' | 'hermes';

function getProvider(): Provider {
    const p = (process.env.LLM_PROVIDER ?? 'groq').toLowerCase();
    if (p === 'hermes') return 'hermes';
    if (p === 'openrouter') return 'openrouter';
    return 'groq';
}

const SYSTEM_PROMPT = `Eres AgenteZirox, un agente de IA personal altamente capaz.
Tienes acceso a herramientas para enviar emails, llamar APIs externas, buscar en tu memoria y más.
Cuando el usuario pida "anota esto", "guarda esta idea", "recuerda esto" o similar, usa la tool capture_note.
En Telegram SI puedes procesar audios/notas de voz porque el sistema los transcribe automaticamente antes de llegar a ti.
Si el usuario pregunta por audios, responde que si puedes entenderlos por transcripcion automatica y ofrece ayudar con resumen, tareas o guardado.
No digas que "no puedes procesar audio directamente" en este proyecto.
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
    } else if (provider === 'hermes') {
        return callHermes(fullMessages, tools);
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

    const res = await getGroqClient().chat.completions.create(params);
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
    const hasTools = Boolean(tools && tools.length > 0);
    const chatModel = process.env.OPENROUTER_MODEL ?? 'anthropic/claude-3.5-sonnet';
    const toolsModel = process.env.OPENROUTER_TOOLS_MODEL ?? chatModel;
    const model = hasTools ? toolsModel : chatModel;

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

    try {
        const res = await getOpenRouterClient().chat.completions.create(params);
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
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('No endpoints found that support tool use')) {
            throw new Error(
                `El modelo "${model}" no soporta tools en OpenRouter. Configura OPENROUTER_TOOLS_MODEL con uno compatible (ej: anthropic/claude-3.5-sonnet).`
            );
        }
        throw err;
    }
}

async function callHermes(messages: ChatMessage[], tools?: LLMTool[]): Promise<LLMResponse> {
    const model = process.env.HERMES_MODEL ?? 'hermes-3-llama-3.1-70b';

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

    const res = await getHermesClient().chat.completions.create(params);
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
