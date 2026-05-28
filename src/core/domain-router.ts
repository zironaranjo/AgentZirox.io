// Domain classification — filters tool list so the LLM sees only relevant tools.
// Reduces hallucination and speeds up responses vs exposing 35+ tools unconditionally.

export type Domain =
    | 'desktop'      // PC local: apps, carpetas, YouTube play, volumen
    | 'media'        // image generation/storage, TTS, YouTube
    | 'comms'        // email, WhatsApp
    | 'linkedin'     // social media drafts & posting
    | 'tiktok'       // TikTok video publishing
    | 'productivity' // local files, calendar, tasks, Sheets, notes
    | 'drive'        // Google Drive archiving
    | 'research'     // web search, URLs, prices
    | 'knowledge'    // internal knowledge base CRUD
    | 'memory'       // user profile / remember_about_user
    | 'notes'        // Obsidian vault notes (read/write/search)
    | 'general';     // ambiguous / cross-domain → expose all tools

// Tools shown exclusively for each domain (augmented with CORE_TOOLS at runtime).
// 'general' is empty by convention — the caller exposes all tools when empty.
export const DOMAIN_TOOLS: Record<Domain, readonly string[]> = {
    desktop: [
        'play_youtube',
        'open_application',
        'open_folder',
        'system_control',
        'youtube_transcript',
    ],
    media: [
        'generate_image',
        'generate_video',
        'create_short_video',
        'save_image', 'list_images', 'delete_image', 'get_saved_image',
        'tts_generate',
        'save_audio',
        'list_audios',
        'get_saved_audio',
        'delete_audio',
        'create_notebooklm_audio',
        'youtube_transcript',
        'play_youtube',
    ],
    comms: [
        'send_email', 'read_inbox',
        'send_whatsapp', 'send_whatsapp_voice',
    ],
    linkedin: [
        'linkedin_save_draft', 'linkedin_propose_post', 'linkedin_list_drafts',
        'approve_linkedin_post', 'reject_linkedin_post',
        'generate_image',
        'create_linkedin_video',
        'web_search',
    ],
    tiktok: [
        'generate_video', 'create_short_video',
        'create_tiktok_text_video',
        'tiktok_propose_video', 'approve_tiktok_video', 'reject_tiktok_video', 'tiktok_list_pending',
        'analyze_reference', 'save_style_recipe', 'list_style_recipes', 'create_from_style', 'delete_style_recipe',
        'youtube_transcript', 'generate_image',
    ],
    productivity: [
        'schedule_task', 'list_scheduled_tasks', 'cancel_scheduled_task',
        'save_agent_task', 'list_agent_tasks', 'complete_agent_task', 'cancel_agent_task',
        'list_all_pending',
        'google_calendar_list_events', 'google_calendar_create_event',
        'google_sheets_quick_note', 'google_sheets_create', 'google_sheets_read', 'google_sheets_write',
        'create_folder', 'write_file', 'read_file', 'list_files', 'append_file',
        'capture_note', 'create_client_workspace',
        'obsidian_search', 'obsidian_read', 'obsidian_write',
        'save_infographic', 'list_infographics', 'create_infographic', 'create_infographic_notebooklm',
        'create_notebooklm_audio',
    ],
    notes: [
        'obsidian_search', 'obsidian_read', 'obsidian_write',
        'save_infographic', 'list_infographics', 'create_infographic', 'create_infographic_notebooklm',
        'create_notebooklm_audio',
    ],
    drive: [
        'drive_create_folder', 'drive_save_important_emails', 'drive_archive_important_emails',
        'read_inbox',
    ],
    research: [
        'web_search', 'fetch_url', 'browser_screenshot', 'browser_open', 'browser_fill', 'browser_click', 'browser_submit', 'browser_screenshot_session', 'browser_close', 'get_price', 'youtube_transcript',
    ],
    knowledge: [
        'add_knowledge', 'search_knowledge', 'list_knowledge', 'delete_knowledge',
    ],
    memory: [
        'search_memory', 'remember_about_user', 'update_user_context', 'clear_memory',
    ],
    general: [],
};

// Always injected regardless of domain — cross-cutting tools.
export const CORE_TOOLS = new Set<string>([
    'search_memory',
    'remember_about_user',
    'update_user_context',
    'list_tools',
    'list_all_pending',
]);

/**
 * Classifies the user message into a domain using keyword matching (no LLM call).
 * Returns 'general' when the domain is ambiguous or cross-domain.
 */
export function classifyDomain(msg: string): Domain {
    const t = msg.toLowerCase();

    if (/\b(infograf[ií]a|infographic|canva|diseño\s+para\s+linkedin|post\s+visual)\b/.test(t)) return 'notes';
    if (/\b(obsidian|vault|nota.*obsidian|obsidian.*nota|busca.*nota|buscar.*nota|crea.*nota|escribe.*nota|actualiza.*nota|lee.*nota|leer.*nota|muestra.*nota|abre.*nota|nota\s+en\s+obsidian|apunte.*obsidian)\b/.test(t)) return 'notes';

    if (/\b(tiktok|tik\s*tok|sube.*video|publica.*video|video.*tiktok|short[s]?|reel[s]?|genera.*video.*tiktok|crea.*video.*tiktok)\b/.test(t)) return 'tiktok';
    // Vídeo CON VOZ / guion / subtítulos / modo veo|kenburns → create_short_video (dominio tiktok)
    if (/\b(v[ií]deo|video)\b/.test(t) && /\b(con\s+voz|voz\s+en\s+off|narraci[oó]n|gui[oó]n|guion|subt[ií]tulos|modo\s+veo|modo\s+kenburns|varios\s+clips|\d+\s+clips)\b/.test(t)) return 'tiktok';
    if (/\b(analiza|aprende\s+de|imita|copia\s+el\s+(estilo|formato)|me\s+gusta\s+este|estilo\s+de|receta\s+de\s+estilo)\b/.test(t) && /\b(video|v[ií]deo|tiktok|reel|short|formato|estilo)\b/.test(t)) return 'tiktok';

    if (/\b(linkedin|post de linkedin|publicaci[oó]n|draft|borrador|redacta.*post|escribir.*post|crea.*post|haz.*post|escrib[ei].*post|\bpost\s+(sobre|de|con|para|acerca|en linkedin))\b/.test(t)) return 'linkedin';

    if (
        /\b(abre|abrir|lanza|inicia|pon|ponme|reproduce|reproducir|ejecuta)\s+(la\s+)?(carpeta|app|aplicaci[oó]n|programa|spotify|chrome|explorador|notepad|calculadora)\b/.test(t) ||
        /\b(carpeta|explorador\s+de\s+archivos|escritorio|documentos|descargas)\b/.test(t) && /\b(abre|abrir|muestra|mu[eé]strame|ve\s+a|ir\s+a)\b/.test(t) ||
        /\b(sube|baja|silencia|mute|volumen|más\s+alto|más\s+bajo)\b/.test(t) && /\b(volumen|sonido|audio)\b/.test(t) ||
        /\b(pon|ponme|reproduce|reproducir|escuchar)\b/.test(t) && /\b(canci[oó]n|m[uú]sica|youtube|spotify)\b/.test(t)
    ) return 'desktop';

    if (/\b(imagen|foto|genera|genera[r]|diseña|ilustr|dall.e|stable.diffusion|midjourney|audio|voz|tts|generar\s+voz|generar?\s+video|crea[r]?\s+video|video.*veo|veo\s*3|youtube\.com|youtu\.be|transcripci[oó]n)\b/.test(t)) return 'media';

    if (/\b(email|correo|inbox|bandeja|whatsapp|mensaje.*whats|nota\s+de\s+voz)\b/.test(t) ||
        /\b(manda|env[ií]a)\s+(un\s+)?(correo|email|mensaje|whatsapp|nota|foto|archivo)\b/.test(t)) return 'comms';

    if (/\b(google\s+drive|drive|archiva.*email|emails?\s+importantes?|guardar.*email)\b/.test(t)) return 'drive';

    if (/\b(calendario|agenda|evento|recordatorio|tarea|task|cita|horario|sheets?|hoja\s+de\s+c[aá]lculo|carpeta|directorio|archivo\s+(nuevo|crear)|escrib[ei]r\s+archivo|nota|apunte|workspace|recuérdame|recuerdame|av[ií]same|en\s+\d+\s+(minutos?|horas?)|mañana\s+a\s+las|esta\s+tarde\s+a\s+las|pendiente|lista.*tareas|que\s+tengo\s+pendiente)\b/.test(t)) return 'productivity';
    if (/\b(cancela|cancelar|borra|borrar|elimina|eliminar)\b/.test(t) && /\b(recordatorio|tarea|task|id|pendiente)\b/.test(t)) return 'productivity';

    if (/\b(screenshot|captura\s+(de\s+)?pantalla|captura\s+(la\s+)?web|c[oó]mo\s+se\s+ve|foto\s+de\s+la\s+web|toma\s+una\s+captura)\b/.test(t)) return 'research';
    if (/\b(busca|investiga|precio|cu[aá]nto\s+(cuesta|vale|cuestan)|qu[eé]\s+es|d[oó]nde\s+(est[aá]|comprar)|p[aá]gina\s+web|url|noticias|informaci[oó]n\s+sobre)\b/.test(t)) return 'research';

    if (/\b(añade\s+conocimiento|guarda.*conocimiento|base\s+de\s+conocimiento|aprende|nuevo\s+conocimiento|conocimiento\s+sobre)\b/.test(t)) return 'knowledge';

    if (/\b(recuerd[ae]|olvida|mi\s+perfil|sobre\s+m[ií]|actualiza.*perfil|memoriza|no\s+olvides)\b/.test(t)) return 'memory';

    return 'general';
}

/**
 * Returns the tool name set for a given domain (domain tools + core tools).
 * Returns null for 'general' — caller should expose all tools.
 */
export function getDomainToolSet(domain: Domain): Set<string> | null {
    if (domain === 'general') return null;
    const names = [...DOMAIN_TOOLS[domain], ...CORE_TOOLS];
    return new Set(names);
}
