import { getMeta, setMeta } from '../../core/memory';

export const STYLE_RECIPES_META_KEY = 'content_style_recipes';

/**
 * Una "receta de estilo" destila el FORMATO de un vídeo que le gusta al usuario
 * (no copia el contenido). Sirve para generar contenido nuevo imitando la estructura.
 */
export interface StyleRecipe {
    id: number;
    name: string;
    /** Plataforma de origen: tiktok | youtube | instagram | otro */
    platform: string;
    sourceUrl?: string;
    /** Gancho/hook de los primeros segundos (qué hace que enganche). */
    hook: string;
    /** Estructura por bloques (ej: "hook 3s → problema → 3 tips → CTA"). */
    structure: string;
    /** Tono y voz (cercano, técnico, enérgico, didáctico...). */
    tone: string;
    /** Ritmo/edición (cortes rápidos, texto en pantalla, b-roll...). */
    pacing: string;
    /** Llamada a la acción típica. */
    cta: string;
    /** Hashtags sugeridos. */
    hashtags: string[];
    /** Duración objetivo en segundos. */
    durationSec: number;
    /** Notas libres del análisis. */
    notes?: string;
    createdAt: number;
}

export async function loadStyleRecipes(): Promise<StyleRecipe[]> {
    const raw = await getMeta(STYLE_RECIPES_META_KEY);
    if (!raw) return [];
    try { return JSON.parse(raw) as StyleRecipe[]; } catch { return []; }
}

export async function saveStyleRecipes(rows: StyleRecipe[]): Promise<void> {
    await setMeta(STYLE_RECIPES_META_KEY, JSON.stringify(rows.slice(-50)));
}

export type NewStyleRecipe = Omit<StyleRecipe, 'id' | 'createdAt'>;

export async function insertStyleRecipe(recipe: NewStyleRecipe): Promise<StyleRecipe> {
    const rows = await loadStyleRecipes();
    const id = rows.length > 0 ? Math.max(...rows.map(r => r.id)) + 1 : 1;
    const full: StyleRecipe = { ...recipe, id, createdAt: Date.now() };
    rows.push(full);
    await saveStyleRecipes(rows);
    return full;
}

export async function getStyleRecipe(idOrName: number | string): Promise<StyleRecipe | undefined> {
    const rows = await loadStyleRecipes();
    if (typeof idOrName === 'number') return rows.find(r => r.id === idOrName);
    const q = idOrName.trim().toLowerCase();
    return rows.find(r => r.name.toLowerCase() === q)
        ?? rows.find(r => r.name.toLowerCase().includes(q));
}

export async function deleteStyleRecipe(id: number): Promise<boolean> {
    const rows = await loadStyleRecipes();
    const next = rows.filter(r => r.id !== id);
    if (next.length === rows.length) return false;
    await saveStyleRecipes(next);
    return true;
}

/** Detecta la plataforma a partir de la URL. */
export function detectPlatform(url: string): 'tiktok' | 'youtube' | 'instagram' | 'otro' {
    const u = url.toLowerCase();
    if (u.includes('tiktok.com')) return 'tiktok';
    if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
    if (u.includes('instagram.com')) return 'instagram';
    return 'otro';
}
