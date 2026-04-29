import Groq from 'groq-sdk';
import OpenAI from 'openai';
import { getUserProfileBlock, listPendingScheduledForChat } from './memory';
import { getToolContext } from './tool-context';

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

export async function buildSystemPrompt(): Promise<string> {
    const profile = await getUserProfileBlock();
    const now = new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });

    let pendingTasksBlock = '';
    const ctx = getToolContext();
    if (ctx?.chatId) {
        try {
            const tasks = await listPendingScheduledForChat(ctx.chatId);
            if (tasks.length > 0) {
                const lines = tasks.map((t) => {
                    const when = new Date(t.run_at_ms).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
                    return `• [id:${t.id}] ${when} → ${t.instruction.slice(0, 150)}${t.instruction.length > 150 ? '…' : ''}`;
                });
                pendingTasksBlock = `\n\n---\n### Tareas programadas pendientes\n${lines.join('\n')}`;
            }
        } catch {
            /* ignorar si la DB no está lista */
        }
    }

    return `Eres AgenteZirox, un agente de IA personal altamente capaz.
Tienes acceso a herramientas para enviar emails, llamar APIs externas, buscar en tu memoria, buscar en internet (web_search) y más.
Cuando el usuario pida investigar, buscar en la web, datos actuales, correos o telefonos de empresas, o "que dice internet", usa la tool web_search con una consulta clara.
Si pide crear, generar o dibujar una imagen, ilustracion, banner o logo visual (aunque lo diga en plan simple: "haz una foto de...", "una imagen de un cohete"), usa generate_image con un prompt descriptivo. El usuario no tiene que nombrar la herramienta. Backend: KIE_API_KEY (Kie.ai) o OPENAI_API_KEY; opcional IMAGE_GENERATION_PROVIDER=kie|openai para forzar.
Cuando el usuario pida "anota esto", "guarda esta idea", "recuerda esto" o similar, usa la tool capture_note.
Cuando comparta su nombre, gustos, preferencias de trato o diga "recuerda que...", "llámame...", usa la tool remember_about_user para guardarlo de forma persistente.
Si pide algo para una hora o día futuro (recordatorio, aviso, "mañana a las 8", noticias diarias, etc.), DEBES llamar a schedule_task con instruction clara y run_at_iso (ISO con offset Europa/Madrid). Nunca digas que lo harás sin usar esa tool.
REGLA CRITICA — Google Sheets / Drive: Si el mensaje pide crear una hoja, spreadsheet, "Google Sheets", archivo en Drive, o un titulo concreto (ej. "notas") y texto a guardar, DEBES llamar en ese turno a las tools de Sheets. Opciones: (1) Una sola nota con titulo opcional → google_sheets_quick_note con document_title + note_text. (2) Primero crear vacia y luego escribir → google_sheets_create y luego google_sheets_write con el spreadsheet_id devuelto. PROHIBIDO responder solo con un post de LinkedIn, marketing o texto creativo irrelevante cuando el usuario pidio Sheets; las herramientas existen para eso.
Para Google Sheets en general: nota en lenguaje natural en hoja nueva → google_sheets_quick_note. Tablas o rangos explicitos → google_sheets_create, google_sheets_read, google_sheets_write. Calendar: google_calendar_list_events / google_calendar_create_event (OAuth en README).
REGLA CRITICA — LinkedIn / publicar: Si el usuario pide publicar, subir, colgar o compartir algo en LinkedIn (incluye coloquial: "subelo a mi linkedin", "ponlo en linkedin", "que salga en mi feed"), DEBES llamar a linkedin_propose_post con el texto del post en ese turno (o en el flujo de tools del mismo mensaje). Si ademas pide imagen, dibujo o foto, PRIMERO generate_image y DESPUES linkedin_propose_post con image_url = URL HTTPS devuelta por generate_image. PROHIBIDO usar linkedin_save_draft como sustituto de eso: linkedin_save_draft es solo cuando el usuario quiere guardar un .md en el VPS para revisar offline o publicar manualmente, sin pedir subir/publicar con el flujo del bot. Si OAuth LinkedIn no esta configurado, linkedin_propose_post lo dira: no sustituyas por guardar borrador. Tras ejecutar linkedin_propose_post, DEBES incluir el ID numerico exacto devuelto por la tool (ej. "ID 12") y el comando exacto /li_approve 12; no digas "revisa Telegram para ver el ID", no ocultes ni omitas el numero. Nunca digas publicado sin /li_approve. linkedin_list_drafts para listar archivos guardados.
Si el usuario pregunta que tareas programadas hay o "que tareas tenemos", usa list_scheduled_tasks (no inventes la lista sin la tool).
En Telegram SI puedes procesar audios/notas de voz porque el sistema los transcribe automaticamente antes de llegar a ti.
Si el usuario pregunta por audios, responde que si puedes entenderlos por transcripcion automatica y ofrece ayudar con resumen, tareas o guardado.
No digas que "no puedes procesar audio directamente" en este proyecto.
Responde siempre en el idioma del usuario. Sé conciso, útil y proactivo.
Fecha y hora actual: ${now}${profile}${pendingTasksBlock}`;
}

/**
 * Call the active LLM provider with messages and optional tools
 */
export async function callLLM(
    messages: ChatMessage[],
    tools?: LLMTool[]
): Promise<LLMResponse> {
    const provider = getProvider();
    const fullMessages: ChatMessage[] = [
        { role: 'system', content: await buildSystemPrompt() },
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

export interface CallLLMSimpleOptions {
    temperature?: number;
    max_tokens?: number;
}

/**
 * Llamada al LLM sin el system prompt del agente ni herramientas (p. ej. extracción, resúmenes).
 */
export async function callLLMSimple(
    systemContent: string,
    messages: ChatMessage[],
    options?: CallLLMSimpleOptions
): Promise<string> {
    const temperature = options?.temperature ?? 0.35;
    const max_tokens = options?.max_tokens ?? 900;
    const fullMessages: ChatMessage[] = [{ role: 'system', content: systemContent }, ...messages];
    const provider = getProvider();

    if (provider === 'groq') {
        const model = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile';
        const res = await getGroqClient().chat.completions.create({
            model,
            messages: fullMessages as any,
            temperature,
            max_tokens,
        });
        return (res.choices[0]?.message?.content ?? '').trim();
    }

    if (provider === 'hermes') {
        const model = process.env.HERMES_MODEL ?? 'hermes-3-llama-3.1-70b';
        const res = await getHermesClient().chat.completions.create({
            model,
            messages: fullMessages as OpenAI.Chat.ChatCompletionMessageParam[],
            temperature,
            max_tokens,
        });
        return (res.choices[0]?.message?.content ?? '').trim();
    }

    const model = process.env.OPENROUTER_MODEL ?? 'anthropic/claude-3.5-sonnet';
    const res = await getOpenRouterClient().chat.completions.create({
        model,
        messages: fullMessages as OpenAI.Chat.ChatCompletionMessageParam[],
        temperature,
        max_tokens,
    });
    return (res.choices[0]?.message?.content ?? '').trim();
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
