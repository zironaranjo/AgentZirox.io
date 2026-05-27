import Groq from 'groq-sdk';
import OpenAI from 'openai';
import { getUserProfileBlock, getUserContextBlock, listLinkedInPendingPostsForChat } from './memory';
import { getToolContext } from './tool-context';
import { logger } from './logger';

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

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    const m = msg.toLowerCase();
    return m.includes('429') || m.includes('rate limit') || m.includes('too many requests');
}

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
    const [profile, userContext] = await Promise.all([getUserProfileBlock(), getUserContextBlock()]);
    const now = new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });

    const pendingTasksBlock = '';
    const ctx = getToolContext();

    let pendingLinkedInBlock = '';
    if (ctx?.chatId) {
        try {
            const liPosts = await listLinkedInPendingPostsForChat(ctx.chatId, 5);
            if (liPosts.length > 0) {
                const lines = liPosts.map((p) => `• #${p.id} (${p.visibility}) — ${p.body.slice(0, 80)}…`);
                pendingLinkedInBlock = `\n\n---\n### Posts LinkedIn pendientes de aprobación\n${lines.join('\n')}\nSi el usuario pregunta o confirma uno de estos, dile el ID y el comando /li_approve N. NO los vuelvas a encolar.`;
            }
        } catch {
            /* ignorar */
        }
    }

    const chatId = ctx?.chatId ?? '';
    const isWaGroup = chatId.startsWith('wa_group_');
    const isWa = chatId.startsWith('wa_') && !isWaGroup;
    const channel = isWaGroup ? 'WhatsApp Grupo' : isWa ? 'WhatsApp' : chatId ? 'Telegram' : 'web';

    const channelContext = isWaGroup
        ? `Estás dentro de un grupo de WhatsApp (chat ID: ${chatId}). El historial incluye mensajes de todos los miembros en formato [Nombre]: mensaje. Cuando alguien te mencione con @Zirox, respondes al grupo. Si te preguntan por tareas pendientes, asignaciones o responsabilidades, revisa el historial del chat — ahí están todos los mensajes aunque no te hayan mencionado. Si detectas tareas importantes (quién hace qué, fechas, responsables), usa add_knowledge para guardarlas de forma estructurada con tag "grupo".`
        : isWa
        ? `Estás en WhatsApp. Chat ID: ${chatId}.`
        : chatId
        ? `Chat ID: ${chatId}. Estás hablando DIRECTAMENTE en Telegram — NUNCA digas "revisa Telegram" ni "te llegará un mensaje a Telegram" porque el usuario YA ESTÁ aquí.`
        : 'Estás en la interfaz web. La web tiene entrada de voz por micrófono del navegador (Web Speech API): el usuario puede hablar y la transcripción llega como texto. SI el usuario pregunta si puedes escucharle por el micro de su ordenador/web, dile que SÍ — el orbe reconoce su voz directamente en el navegador y te envía la transcripción.';

    return `Eres AgenteZirox, un agente de IA personal altamente capaz.
Canal actual: ${channel}. ${channelContext}${userContext}
Tienes acceso a herramientas para enviar emails, llamar APIs externas, buscar en tu memoria, buscar en internet (web_search) y más.
Cuando el usuario pida investigar, buscar en la web, datos actuales, correos o telefonos de empresas, o "que dice internet", usa la tool web_search con una consulta clara. NOTICIAS DE IA: consulta SIEMPRE en español (ej. "noticias inteligencia artificial hoy España"); resume en español con titular + por qué importa + enlace; prioriza medios en español.
Si pide crear, generar o dibujar una imagen, ilustracion, banner o logo visual (aunque lo diga en plan simple: "haz una foto de...", "una imagen de un cohete"), usa generate_image con un prompt descriptivo. El usuario no tiene que nombrar la herramienta. Backend: KIE_API_KEY (Kie.ai) o OPENAI_API_KEY; opcional IMAGE_GENERATION_PROVIDER=kie|openai para forzar.
Cuando el usuario pida "anota esto", "guarda esta idea", "recuerda esto" o similar, usa la tool capture_note.
Cuando comparta su nombre, gustos, preferencias de trato o diga "recuerda que...", "llámame...", usa la tool remember_about_user para guardarlo de forma persistente.
Si pide algo para una hora o día futuro (recordatorio, aviso, "mañana a las 8", noticias diarias, etc.), DEBES llamar a schedule_task con instruction clara y run_at_iso (ISO con offset Europa/Madrid). Si pide repetición ("cada día", "todos los lunes", "cada semana"), añade repeat="daily"|"weekly"|"monthly"|"hourly" — la tarea se reprogramará automáticamente tras cada ejecución. NUNCA crees dos schedule_task para la misma tarea recurrente: una sola con repeat es suficiente. Nunca digas que lo harás sin usar esa tool.
REGLA CRITICA — Google Sheets / Drive: Si el mensaje pide crear una hoja, spreadsheet, "Google Sheets", archivo en Drive, o un titulo concreto (ej. "notas") y texto a guardar, DEBES llamar en ese turno a las tools de Sheets. Opciones: (1) Una sola nota con titulo opcional → google_sheets_quick_note con document_title + note_text. (2) Primero crear vacia y luego escribir → google_sheets_create y luego google_sheets_write con el spreadsheet_id devuelto. PROHIBIDO responder solo con un post de LinkedIn, marketing o texto creativo irrelevante cuando el usuario pidio Sheets; las herramientas existen para eso.
Para Google Sheets en general: nota en lenguaje natural en hoja nueva → google_sheets_quick_note. Tablas o rangos explicitos → google_sheets_create, google_sheets_read, google_sheets_write. Calendar: google_calendar_list_events / google_calendar_create_event (OAuth en README).
REGLA CRITICA — LinkedIn / proponer o publicar: Siempre que el usuario pida proponer, redactar, publicar, subir, colgar o compartir algo en LinkedIn — DEBES llamar a linkedin_propose_post con el texto que redactes EN ESE MISMO TURNO. PROHIBIDO hacer dos pasos (mostrar texto y esperar confirmacion): eso corrompe el contenido. Redacta el post y llama linkedin_propose_post en la misma respuesta, sin preguntar si le gusta el texto primero. Si ademas pide imagen: llama generate_image en ese mismo turno y DESPUES linkedin_propose_post con la image_url resultante — todo en UN SOLO TURNO, sin preguntar ni pedir confirmacion del prompt de imagen. APROBAR: cuando el usuario diga "aprueba", "aprobado", "aprovada", "si", "dale", "adelante", "publícalo", "hazlo", "publicalo" u otra frase de confirmacion sobre un post pendiente (ver lista de pendientes en el contexto), INMEDIATAMENTE llama approve_linkedin_post (con post_id si lo menciona, si no usa el mas reciente) — no digas "voy a publicar" ni "publicando", simplemente llama la tool. CANCELAR: si pide cancelar, eliminar o rechazar posts pendientes, llama reject_linkedin_post (con post_id, o sin el para cancelar todos). PROHIBIDO usar cancel_scheduled_task para posts LinkedIn. PROHIBIDO usar linkedin_save_draft como sustituto de propose. Si OAuth no configurado, linkedin_propose_post lo dira. Tras ejecutar cualquier tool LinkedIn, el resultado se muestra directamente — no repitas ni resumas. linkedin_list_drafts para listar borradores .md.
REGLA CRITICA — TAREAS Y RECORDATORIOS: Si el mensaje incluye hora o fecha futura ("mañana a las 9", "a las 7 de la tarde", "en 30 minutos", "el 14 de julio") → OBLIGATORIO schedule_task. Si pide agregar/recordar/apuntar algo SIN mencionar hora ni fecha → OBLIGATORIO save_agent_task (backlog sin fecha). PROHIBIDO inventar una fecha si el usuario no dio ninguna — si no hay fecha, es save_agent_task, nunca schedule_task. PROHIBIDO responder "programada", "apuntada" o mencionar un ID sin haber llamado la tool en ese turno. Si el usuario pregunta qué tiene pendiente, qué recordatorios hay, o pide listar tareas → llama list_all_pending (una sola tool que devuelve todo). OBLIGATORIO mostrar su respuesta TAL CUAL, copiada literalmente sin añadir ni cambiar nada. Si pregunta por tareas DIARIAS → list_all_pending y filtra/menciona solo las que tienen repeat daily o texto "cada día/diaria". Si pregunta si hay REPETIDAS o DUPLICADAS → SOLO listar y comparar pendientes existentes; PROHIBIDO save_agent_task ni schedule_task en esa consulta.
Cuando el usuario comparta un enlace o pida leer/resumir una página web o artículo, usa fetch_url con esa URL.
Cuando el usuario pregunte por precios de criptomonedas (Bitcoin, ETH, SOL...) o acciones/ETFs (AAPL, TSLA...), usa get_price.
Cuando el usuario pida transcribir, resumir o extraer información de un vídeo de YouTube, usa youtube_transcript con la URL o ID del vídeo.
CONTROL DE PC (solo si DESKTOP_CONTROL_ENABLED=true y el agente corre en el Windows del usuario): reproduce canciones/vídeos en YouTube → play_youtube; abre apps (Spotify, Chrome, Notepad…) → open_application; abre carpetas en el Explorador (documentos, escritorio, rutas del workspace) → open_folder; volumen/silencio → system_control. NUNCA digas que abriste algo sin llamar la tool. Si la tool falla por control desactivado, explica que hay que activar DESKTOP_CONTROL_ENABLED en local.
TTS TEXTO→AUDIO: Si piden convertir/leer texto en audio/voz/mp3 → OBLIGATORIO tts_generate con TODO el texto (voz jorge por defecto). Si piden guardarlo con nombre ("guárdalo como oración matutina") usa save_as en tts_generate o save_audio después. RECUPERAR AUDIO GUARDADO ("ponme el audio de X", "dame el mp3 de prueba"): SOLO get_saved_audio — PROHIBIDO tts_generate (no regenerar). BIBLIOTECA: list_audios, save_audio, delete_audio. Tras tts_generate o get_saved_audio el MP3 se adjunta solo en Telegram; no repitas enlaces. Voces: jorge (default), alvaro, elvira, dalia.
Cuando el usuario pida enviar un WhatsApp, usa send_whatsapp con el número en formato internacional sin + (ej: 34612345678).
Cuando alguien (por cualquier canal) pregunte sobre tus servicios, precios, políticas, clientes o cualquier información que puedas tener guardada, usa search_knowledge primero para buscar contexto relevante antes de responder. Si el usuario quiere guardar información estructurada (precios, servicios, FAQs, datos de empresa), usa add_knowledge. Para ver qué hay guardado, usa list_knowledge.
GUIONES YOUTUBE: cuando el usuario pida crear un guión, script o contenido para YouTube, sigue esta plantilla: 1) GANCHO (primeros 30 seg, pregunta o dato impactante), 2) PRESENTACIÓN (de qué va el vídeo y por qué importa), 3) DESARROLLO (3-5 puntos clave con ejemplos), 4) CTA (llamada a la acción: suscribirse, comentar, ver siguiente vídeo), 5) CIERRE. Adapta la duración estimada según lo que pida el usuario.
En Telegram SI puedes procesar audios/notas de voz porque el sistema los transcribe automaticamente antes de llegar a ti. En la web, el navegador transcribe la voz del usuario con el microfono y te llega como texto — el resultado es el mismo. NUNCA digas que no puedes escuchar o procesar audio/voz en este proyecto, ni en Telegram ni en la web.
PERFIL DEL DUEÑO — Cuando alguien pregunte quién es Ziro, quién te creó, quién es el dueño, el fundador, o el creador de este agente o de zirox.io, DEBES llamar obsidian_read con path "zirox/Perfil Profesional - Ziro.md" para obtener su perfil completo antes de responder.
TRIADAK / HIDDEN RETREATS — Triadak (triadak.io) es la plataforma SaaS de gestión de alojamientos de Ziro. Hidden Exclusive Retreats (hiddenretreats.online) es el primer cliente real, empresa suiza de chalets de lujo en los Alpes. Cuando alguien pregunte sobre Triadak, Hidden Retreats, alguna de sus propiedades (MountainHut, Eiger, Seehof, AlpGallery, Grand Lookout, Valley Retreat, Stockhorn, etc.), precios por noche, capacidad, check-in, personal o cualquier aspecto de estos negocios, DEBES llamar obsidian_read con path "triadak/Triadak - Contexto Agente.md" para obtener el contexto completo antes de responder. Si el chatId empieza por "triadak-", el usuario es un visitante de triadak.io — actúa como asistente de soporte del producto.
INFOGRAFIAS — RÁPIDA (AntV, ~30s): create_infographic (title + steps[] + benefits[] strings, máx. 3 por lado). PREMIUM (NotebookLM, 2–8 min, calidad editorial): create_infographic_notebooklm cuando pidan calidad NotebookLM o diseño premium. En create_infographic_notebooklm NO inventes sources[] ni URLs salvo que el usuario las pegue explícitamente. Si create_infographic_notebooklm falla por RateLimitError/cuota, NO uses create_infographic como sustituto: informa que la cuota diaria de NotebookLM está agotada. IMPORTANTE — PLAN vs CREAR: Si el usuario pide un "plan", "estrategia", "calendario", "ideas", "propuesta" o "qué temas" para infografías (sin pedir crear una ahora), responde con texto estructurado SIN llamar ninguna tool de infografía. Solo usa create_infographic o create_infographic_notebooklm cuando pidan CREAR una infografía específica con contenido concreto en ese momento. AUDIO NOTEBOOKLM — create_notebooklm_audio cuando pidan resumen en audio, podcast NotebookLM, audio overview o episodio sobre un tema (5–15 min, dos voces). NO usar tts_generate para eso (tts_generate es voz sintética rápida de un texto corto). En create_notebooklm_audio NO inventes sources[] ni URLs. Si falla por cuota, informa y no sustituyas por tts_generate. GESTIONAR: list_infographics, save_infographic. Tras list_infographics: copia el texto TAL CUAL (URLs intactas). PROHIBIDO inventar URLs o XML invoke. Herramientas: create_infographic, create_infographic_notebooklm, create_notebooklm_audio, list_infographics, save_infographic.
Responde siempre en el idioma del usuario. Sé conciso, útil y proactivo.
Fecha y hora actual: ${now}${profile}${pendingTasksBlock}${pendingLinkedInBlock}`;
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
    const fallbackModel =
        process.env.OPENROUTER_FALLBACK_MODEL?.trim() || 'google/gemini-2.0-flash-001';
    const retries = Math.min(
        4,
        Math.max(0, parseInt(process.env.OPENROUTER_RETRY_ATTEMPTS ?? '2', 10) || 2)
    );
    const models = [model, ...(fallbackModel && fallbackModel !== model ? [fallbackModel] : [])];

    let lastErr: unknown;
    for (const modelName of models) {
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const res = await getOpenRouterClient().chat.completions.create({
                    model: modelName,
                    messages: fullMessages as OpenAI.Chat.ChatCompletionMessageParam[],
                    temperature,
                    max_tokens,
                });
                return (res.choices[0]?.message?.content ?? '').trim();
            } catch (err) {
                lastErr = err;
                if (!isRateLimitError(err)) throw err;
                if (attempt >= retries) break;
                await sleep(700 * (attempt + 1));
            }
        }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
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

    const baseParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
        model,
        messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
        temperature: 0.7,
        max_tokens: 2048,
    };

    if (tools && tools.length > 0) {
        baseParams.tools = tools.map((t) => ({
            type: 'function' as const,
            function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
            },
        }));
        baseParams.tool_choice = 'auto';
    }

    const fallbackModel =
        process.env.OPENROUTER_FALLBACK_MODEL?.trim() || 'google/gemini-2.0-flash-001';
    const retries = Math.min(
        4,
        Math.max(0, parseInt(process.env.OPENROUTER_RETRY_ATTEMPTS ?? '2', 10) || 2)
    );
    const models = [model, ...(fallbackModel && fallbackModel !== model ? [fallbackModel] : [])];

    let lastErr: unknown;
    for (const modelName of models) {
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const res = await getOpenRouterClient().chat.completions.create({
                    ...baseParams,
                    model: modelName,
                });
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
                lastErr = err;
                const msg = err instanceof Error ? err.message : String(err);
                if (msg.includes('No endpoints found that support tool use')) {
                    throw new Error(
                        `El modelo "${modelName}" no soporta tools en OpenRouter. Configura OPENROUTER_TOOLS_MODEL con uno compatible (ej: anthropic/claude-3.5-sonnet).`
                    );
                }
                if (!isRateLimitError(err)) throw err;
                logger.warn(
                    `[llm] OpenRouter 429 en ${modelName} (intento ${attempt + 1}/${retries + 1})`
                );
                if (attempt >= retries) break;
                await sleep(700 * (attempt + 1));
            }
        }
    }

    throw new Error(
        `OpenRouter rate-limited tras reintentos (${models.join(' -> ')}). Prueba en unos segundos o cambia de proveedor/modelo. Detalle: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`
    );
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
