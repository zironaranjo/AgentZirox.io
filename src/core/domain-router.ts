// Domain classification — filters tool list so the LLM sees only relevant tools.
// Reduces hallucination and speeds up responses vs exposing 35+ tools unconditionally.

export type Domain =
    | 'media'        // image generation/storage, TTS, YouTube
    | 'comms'        // email, WhatsApp
    | 'linkedin'     // social media drafts & posting
    | 'tiktok'       // TikTok video publishing
    | 'productivity' // local files, calendar, tasks, Sheets, notes
    | 'drive'        // Google Drive archiving
    | 'research'     // web search, URLs, prices
    | 'knowledge'    // internal knowledge base CRUD
    | 'memory'       // user profile / remember_about_user
    | 'general';     // ambiguous / cross-domain → expose all tools

// Tools shown exclusively for each domain (augmented with CORE_TOOLS at runtime).
// 'general' is empty by convention — the caller exposes all tools when empty.
export const DOMAIN_TOOLS: Record<Domain, readonly string[]> = {
    media: [
        'generate_image',
        'generate_video',
        'save_image', 'list_images', 'delete_image', 'get_saved_image',
        'tts_generate',
        'youtube_transcript',
    ],
    comms: [
        'send_email', 'read_inbox',
        'send_whatsapp', 'send_whatsapp_voice',
    ],
    linkedin: [
        'linkedin_save_draft', 'linkedin_propose_post', 'linkedin_list_drafts',
        'approve_linkedin_post', 'reject_linkedin_post',
        'generate_image',
        'web_search',
    ],
    tiktok: [
        'generate_video',
        'tiktok_propose_video', 'approve_tiktok_video', 'reject_tiktok_video', 'tiktok_list_pending',
    ],
    productivity: [
        'schedule_task', 'list_scheduled_tasks', 'cancel_scheduled_task',
        'google_calendar_list_events', 'google_calendar_create_event',
        'google_sheets_quick_note', 'google_sheets_create', 'google_sheets_read', 'google_sheets_write',
        'create_folder', 'write_file', 'read_file', 'list_files', 'append_file',
        'capture_note', 'create_client_workspace',
    ],
    drive: [
        'drive_create_folder', 'drive_save_important_emails', 'drive_archive_important_emails',
        'read_inbox',
    ],
    research: [
        'web_search', 'fetch_url', 'get_price', 'youtube_transcript',
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
]);

/**
 * Classifies the user message into a domain using keyword matching (no LLM call).
 * Returns 'general' when the domain is ambiguous or cross-domain.
 */
export function classifyDomain(msg: string): Domain {
    const t = msg.toLowerCase();

    if (/\b(tiktok|tik\s*tok|sube.*video|publica.*video|video.*tiktok|short[s]?|genera.*video.*tiktok|crea.*video.*tiktok)\b/.test(t)) return 'tiktok';

    if (/\b(linkedin|post de linkedin|publicaci[oó]n|draft|borrador|redacta.*post|escribir.*post|crea.*post|haz.*post|escrib[ei].*post|\bpost\s+(sobre|de|con|para|acerca|en linkedin))\b/.test(t)) return 'linkedin';

    if (/\b(imagen|foto|genera|genera[r]|diseña|ilustr|dall.e|stable.diffusion|midjourney|audio|voz|tts|generar\s+voz|generar?\s+video|crea[r]?\s+video|video.*veo|veo\s*3|youtube\.com|youtu\.be|transcripci[oó]n)\b/.test(t)) return 'media';

    if (/\b(email|correo|inbox|bandeja|whatsapp|mensaje.*whats|nota\s+de\s+voz)\b/.test(t) ||
        /\b(manda|env[ií]a)\s+(un\s+)?(correo|email|mensaje|whatsapp|nota|foto|archivo)\b/.test(t)) return 'comms';

    if (/\b(google\s+drive|drive|archiva.*email|emails?\s+importantes?|guardar.*email)\b/.test(t)) return 'drive';

    if (/\b(calendario|agenda|evento|recordatorio|tarea|task|cita|horario|sheets?|hoja\s+de\s+c[aá]lculo|carpeta|directorio|archivo\s+(nuevo|crear)|escrib[ei]r\s+archivo|nota|apunte|workspace|recuérdame|recuerdame|av[ií]same|en\s+\d+\s+(minutos?|horas?)|mañana\s+a\s+las|esta\s+tarde\s+a\s+las)\b/.test(t)) return 'productivity';

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
