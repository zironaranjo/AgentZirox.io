import { getCachedImage } from './image-cache';

// ── Intent types ──────────────────────────────────────────────────────────────

export interface IntentSaveImage {
    type: 'save_image';
    label?: string;
}

export interface IntentListImages {
    type: 'list_images';
    limit?: number;
}

export interface IntentDeleteImage {
    type: 'delete_image';
    id: number;
}

export interface IntentGetSavedImage {
    type: 'get_saved_image';
    query: string;
}

export interface IntentGetSavedAudio {
    type: 'get_saved_audio';
    query: string;
}

export interface IntentListAudios {
    type: 'list_audios';
    limit?: number;
}

export interface IntentListAllPending {
    type: 'list_all_pending';
}

export interface IntentFetchUrl {
    type: 'fetch_url';
    url: string;
}

export interface IntentApproveLinkedIn {
    type: 'approve_linkedin';
    postId?: number;
}

/** Fallthrough to LLM — carries context that agent.ts uses to filter tools */
export interface IntentLLM {
    type: 'llm';
    isImageReceival: boolean;
    cachedImageExists: boolean;
}

export interface IntentApproveTikTok {
    type: 'approve_tiktok';
    postId?: number;
}

export type Intent =
    | IntentSaveImage
    | IntentListImages
    | IntentDeleteImage
    | IntentGetSavedImage
    | IntentGetSavedAudio
    | IntentListAudios
    | IntentListAllPending
    | IntentFetchUrl
    | IntentApproveLinkedIn
    | IntentApproveTikTok
    | IntentLLM;

// ── Router ────────────────────────────────────────────────────────────────────

/**
 * Classifies a user message into a typed Intent without calling the LLM.
 * Returns IntentLLM as fallthrough for anything that requires the full agent loop.
 */
export function routeIntent(
    userMessage: string,
    lastBotContent: string,
    chatId: string
): Intent {
    const msg = userMessage.trim();

    // [IMAGEN RECIBIDA] is a synthetic message from the photo handler — always LLM
    if (msg.startsWith('[IMAGEN RECIBIDA]')) {
        return { type: 'llm', isImageReceival: true, cachedImageExists: false };
    }

    // ── 0. Direct slash commands ─────────────────────────────────────────────
    const liApproveCmd = msg.match(/^\/li_approve\s+(\d+)/i);
    if (liApproveCmd) return { type: 'approve_linkedin', postId: parseInt(liApproveCmd[1], 10) };

    const ttApproveCmd = msg.match(/^\/tt_approve(?:\s+(\d+))?/i);
    if (ttApproveCmd) return { type: 'approve_tiktok', postId: ttApproveCmd[1] ? parseInt(ttApproveCmd[1], 10) : undefined };

    const cachedImg = getCachedImage(chatId);
    const cachedImageExists = Boolean(cachedImg);

    // ── 1. Simple approval ────────────────────────────────────────────────────
    const isApproval = /^(si|sí|sip|dale|adelante|aprueba|aprobad[oa]|aprovad[oa]|hazlo|publícalo|publicalo|ok|okey|venga|vamos|perfecto|listo|aprobado|aprovado|aprobada|aprovada)[\s.!?]*$/i.test(msg);

    if (isApproval) {
        const botAskedSave = /guarda[r]?\s*(esta\s*)?(imagen|foto)|¿quieres\s*que\s*guarde/i.test(lastBotContent);
        if (botAskedSave) return { type: 'save_image' };

        const liMatch = lastBotContent.match(/\/li_approve\s+(\d+)/);
        if (liMatch) return { type: 'approve_linkedin', postId: parseInt(liMatch[1], 10) };
    }

    // ── 2. Save image — explicit ("imagen"/"foto" in message) ─────────────────
    const hasSaveVerb = /\b(guarda|archiva|salva|guarde|guardar)\b/i.test(msg);
    const hasImageNoun = /\b(imagen|foto|photo|picture)\b/i.test(msg);

    if (hasSaveVerb && hasImageNoun) {
        const label = extractLabel(msg);
        return { type: 'save_image', label };
    }

    // ── 3. Save image — cached photo + any save verb (no "imagen" needed) ─────
    if (cachedImageExists && hasSaveVerb) {
        const isNonImageTarget = /\b(archivo|nota|texto|calendar|tarea|idea|recuerda|pensamiento)\b/i.test(msg);
        if (!isNonImageTarget) {
            const label = extractLabel(msg);
            return { type: 'save_image', label };
        }
    }

    // ── 4. List images ────────────────────────────────────────────────────────
    if (
        /\b(lista|listar|ver|muestra|cuántas|cuantas|tengo)\b.{0,30}\b(imágenes|imagenes|fotos)\b/i.test(msg) ||
        /\b(imágenes|imagenes|fotos)\b.{0,20}\b(guard|almacen)/i.test(msg)
    ) {
        const limitMatch = msg.match(/(\d+)\s*(imágenes|imagenes|fotos)/i);
        const limit = limitMatch ? parseInt(limitMatch[1], 10) : undefined;
        return { type: 'list_images', limit };
    }

    // ── 5. Delete image — by numeric ID ──────────────────────────────────────
    const deleteByIdMatch =
        msg.match(/\b(borra|elimina|borrar|eliminar|quita|quitar|delete)\b.{0,40}#(\d+)/i) ||
        msg.match(/#(\d+).{0,20}\b(borra|elimina|borrar|eliminar|delete)\b/i);

    if (deleteByIdMatch) {
        const rawId = deleteByIdMatch[2] ?? deleteByIdMatch[1];
        const id = parseInt(rawId, 10);
        if (!isNaN(id)) return { type: 'delete_image', id };
    }

    // ── 6. Delete image — by text description (needs LLM to resolve ID) ──────
    // Handled by LLM with only media tools, not intercepted here for now.

    // ── 7. Get/retrieve saved image ───────────────────────────────────────────
    if (
        /\b(muéstrame|muestrame|dame|envíame|enviame|tráeme|traeme|ver|muestra|ponme)\b.{0,30}\b(imagen|foto|picture|guardad)\b/i.test(msg) ||
        /\b(imagen|foto)\b.{0,20}\b(del|de la|que dice|llamad)\b/i.test(msg)
    ) {
        const queryMatch =
            msg.match(/(?:imagen|foto|picture)\s+(?:del?\s+|de\s+la\s+|que\s+(?:dice|es|muestra)\s+|llamad[ao]\s+)?(.+)/i) ||
            msg.match(/(?:muéstrame|muestrame|dame|tráeme|traeme|envíame|enviame|ponme)\s+(.+)/i);
        const query = queryMatch?.[1]?.trim() ?? msg;
        return { type: 'get_saved_image', query };
    }

    // ── 8. List saved audios ──────────────────────────────────────────────────
    if (
        /\b(lista|listar|ver|muestra|cuántos|cuantos|tengo)\b.{0,30}\b(audios|mp3)\b/i.test(msg) ||
        /\b(audios|mp3)\b.{0,20}\b(guard|biblioteca)/i.test(msg)
    ) {
        const limitMatch = msg.match(/(\d+)\s*(audios|mp3)/i);
        const limit = limitMatch ? parseInt(limitMatch[1], 10) : undefined;
        return { type: 'list_audios', limit };
    }

    // ── 9. Get/retrieve saved audio ───────────────────────────────────────────
    if (
        /\b(ponme|muéstrame|muestrame|dame|envíame|enviame|tráeme|traeme|reproduce|escucha|quiero)\b.{0,30}\b(audio|mp3)\b/i.test(msg) ||
        /\b(audio|mp3)\b.{0,20}\b(de|del|llamad)\b/i.test(msg)
    ) {
        const queryMatch =
            msg.match(/(?:audio|mp3)\s+(?:de(?:l)?\s+|llamad[ao]\s+)?["']?([^"']+)["']?/i) ||
            msg.match(/(?:ponme|muéstrame|muestrame|dame|tráeme|traeme|envíame|enviame)\s+(?:el\s+)?(?:audio|mp3)\s+(?:de\s+)?["']?([^"']+)["']?/i);
        const query = (queryMatch?.[1] ?? msg).replace(/["'.!?]+$/g, '').trim();
        return { type: 'get_saved_audio', query };
    }

    // ── 10. Lista unificada de pendientes (programados + sin fecha) ──────────
    if (
        /\b(lista|listar|muestra|ver|ens[eé]ñame|dime)\b.{0,30}\b(pendientes|tareas|recordatorios)\b/i.test(msg) ||
        /\b(qu[eé]|que)\b.{0,24}\b(tengo)\b.{0,24}\b(pendiente|pendientes|recordatorios?)\b/i.test(msg) ||
        /^lista\s+pendientes[\s.!?]*$/i.test(msg)
    ) {
        return { type: 'list_all_pending' };
    }

    // ── 11. Resumir/leer URL — ruta directa a fetch_url ─────────────────────
    if (/\b(resume|resumir|lee|leer|analiza|explica)\b.{0,30}\b(p[aá]gina|enlace|url|art[ií]culo)\b/i.test(msg)) {
        const m = msg.match(/https?:\/\/[^\s"')\]]+/i);
        if (m?.[0]) {
            return { type: 'fetch_url', url: m[0].trim() };
        }
    }

    // ── Default: LLM ─────────────────────────────────────────────────────────
    return { type: 'llm', isImageReceival: false, cachedImageExists };
}

function extractLabel(msg: string): string | undefined {
    const m = msg.match(/\b(?:como|con etiqueta|etiqueta[:]?)\s+(.+)/i);
    return m?.[1]?.trim();
}
