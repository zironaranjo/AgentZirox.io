import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { LinkedInPendingRow, ScheduledTaskRow } from './memory-sqlite';

let client: SupabaseClient | undefined;

function getClient(): SupabaseClient {
    if (!client) throw new Error('Supabase no inicializado. Llama a initSupabaseMemory() primero.');
    return client;
}

function num(n: unknown): number {
    if (typeof n === 'number') return n;
    if (typeof n === 'string') return Number(n);
    return Number(n);
}

export async function initSupabaseMemory(): Promise<void> {
    const url = process.env.SUPABASE_URL?.trim();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !key) {
        throw new Error('SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son obligatorios para memoria Supabase.');
    }
    client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await getClient().from('messages').select('id').limit(1);
    if (error) {
        const msg = error.message ?? String(error);
        if (/relation|does not exist|schema cache/i.test(msg)) {
            throw new Error(
                'Supabase: tablas no encontradas. Ejecuta supabase/migrations/001_agent_memory.sql en el SQL Editor del proyecto.'
            );
        }
        throw new Error(`Supabase: comprobación inicial falló: ${msg}`);
    }
}

export async function supabaseSaveMessage(
    chatId: string,
    role: 'user' | 'assistant' | 'system',
    content: string
): Promise<void> {
    const { error } = await getClient().from('messages').insert({ chat_id: chatId, role, content });
    if (error) throw new Error(`Supabase messages insert: ${error.message}`);
}

export async function supabaseGetHistory(
    chatId: string,
    limit = 20
): Promise<Array<{ role: string; content: string }>> {
    const { data, error } = await getClient()
        .from('messages')
        .select('role, content')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) throw new Error(`Supabase getHistory: ${error.message}`);
    return (data ?? []).reverse() as Array<{ role: string; content: string }>;
}

export async function supabaseGetRecentMessagesAllChats(
    limit: number
): Promise<Array<{ role: string; content: string; created_at: string }>> {
    const { data, error } = await getClient()
        .from('messages')
        .select('role, content, created_at')
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) throw new Error(`Supabase getRecentMessagesAllChats: ${error.message}`);
    const rows = (data ?? []).reverse() as Array<{ role: string; content: string; created_at: string }>;
    return rows.map((r) => ({
        ...r,
        created_at:
            typeof r.created_at === 'string' ? r.created_at : new Date(r.created_at as string).toISOString(),
    }));
}

export async function supabaseClearHistory(chatId: string): Promise<void> {
    const { error } = await getClient().from('messages').delete().eq('chat_id', chatId);
    if (error) throw new Error(`Supabase clearHistory: ${error.message}`);
}

export async function supabaseSetMeta(key: string, value: string): Promise<void> {
    const { error } = await getClient()
        .from('metadata')
        .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw new Error(`Supabase setMeta: ${error.message}`);
}

export async function supabaseGetMeta(key: string): Promise<string | null> {
    const { data, error } = await getClient().from('metadata').select('value').eq('key', key).maybeSingle();
    if (error) throw new Error(`Supabase getMeta: ${error.message}`);
    const row = data as { value: string } | null;
    return row?.value ?? null;
}

export async function supabaseInsertScheduledTask(
    chatId: string,
    instruction: string,
    runAtMs: number
): Promise<number> {
    const { data, error } = await getClient()
        .from('scheduled_tasks')
        .insert({ chat_id: chatId, instruction, run_at_ms: runAtMs, status: 'pending' })
        .select('id')
        .single();
    if (error) throw new Error(`Supabase insertScheduledTask: ${error.message}`);
    return num((data as { id: unknown }).id);
}

export async function supabaseListPendingScheduledForChat(chatId: string): Promise<ScheduledTaskRow[]> {
    const { data, error } = await getClient()
        .from('scheduled_tasks')
        .select('id, chat_id, instruction, run_at_ms, status, created_at')
        .eq('chat_id', chatId)
        .eq('status', 'pending')
        .order('run_at_ms', { ascending: true });
    if (error) throw new Error(`Supabase listPendingScheduled: ${error.message}`);
    return (data ?? []).map(mapScheduledRow);
}

function mapScheduledRow(r: Record<string, unknown>): ScheduledTaskRow {
    return {
        id: num(r.id),
        chat_id: String(r.chat_id),
        instruction: String(r.instruction),
        run_at_ms: num(r.run_at_ms),
        status: String(r.status),
        created_at: isoCreatedAt(r.created_at),
    };
}

function isoCreatedAt(v: unknown): string {
    if (v == null) return new Date().toISOString();
    if (typeof v === 'string') return v;
    return new Date(v as string).toISOString();
}

export async function supabaseClaimNextDueScheduledTask(nowMs: number): Promise<ScheduledTaskRow | null> {
    const { data, error } = await getClient().rpc('claim_next_due_scheduled_task', {
        p_now_ms: nowMs,
    });
    if (error) throw new Error(`Supabase claim_next_due_scheduled_task: ${error.message}`);
    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length === 0) return null;
    return mapScheduledRow(rows[0]);
}

export async function supabaseMarkScheduledTaskDone(id: number): Promise<void> {
    const { error } = await getClient().from('scheduled_tasks').update({ status: 'done' }).eq('id', id);
    if (error) throw new Error(`Supabase markScheduledTaskDone: ${error.message}`);
}

export async function supabaseMarkScheduledTaskFailed(id: number): Promise<void> {
    const { error } = await getClient().from('scheduled_tasks').update({ status: 'failed' }).eq('id', id);
    if (error) throw new Error(`Supabase markScheduledTaskFailed: ${error.message}`);
}

export async function supabaseReleaseStuckRunningTasks(nowMs: number, maxAgeMs: number): Promise<number> {
    const cutoff = nowMs - maxAgeMs;
    const { data, error } = await getClient()
        .from('scheduled_tasks')
        .update({ status: 'pending' })
        .eq('status', 'running')
        .lt('run_at_ms', cutoff)
        .select('id');
    if (error) throw new Error(`Supabase releaseStuckRunningTasks: ${error.message}`);
    return data?.length ?? 0;
}

export async function supabaseCancelScheduledTaskForChat(chatId: string, taskId: number): Promise<boolean> {
    const { data, error } = await getClient()
        .from('scheduled_tasks')
        .delete()
        .eq('id', taskId)
        .eq('chat_id', chatId)
        .eq('status', 'pending')
        .select('id');
    if (error) throw new Error(`Supabase cancelScheduledTask: ${error.message}`);
    return (data?.length ?? 0) === 1;
}

export async function supabaseInsertLinkedInPendingPost(
    chatId: string,
    body: string,
    visibility: 'PUBLIC' | 'CONNECTIONS',
    imageUrl?: string | null
): Promise<number> {
    const { data, error } = await getClient()
        .from('linkedin_pending_posts')
        .insert({
            chat_id: chatId,
            body,
            visibility,
            image_url: imageUrl?.trim() || null,
            status: 'pending',
        })
        .select('id')
        .single();
    if (error) throw new Error(`Supabase insertLinkedInPendingPost: ${error.message}`);
    return num((data as { id: unknown }).id);
}

function mapLinkedInRow(r: Record<string, unknown>): LinkedInPendingRow {
    return {
        id: num(r.id),
        chat_id: String(r.chat_id),
        body: String(r.body),
        visibility: String(r.visibility),
        status: String(r.status),
        linkedin_response: r.linkedin_response != null ? String(r.linkedin_response) : null,
        error: r.error != null ? String(r.error) : null,
        image_url: r.image_url != null ? String(r.image_url) : null,
        created_at: isoCreatedAt(r.created_at),
    };
}

export async function supabaseGetLinkedInPendingPostForChat(
    id: number,
    chatId: string
): Promise<LinkedInPendingRow | null> {
    const { data, error } = await getClient()
        .from('linkedin_pending_posts')
        .select(
            'id, chat_id, body, visibility, status, linkedin_response, error, image_url, created_at'
        )
        .eq('id', id)
        .eq('chat_id', chatId)
        .maybeSingle();
    if (error) throw new Error(`Supabase getLinkedInPendingPost: ${error.message}`);
    if (!data) return null;
    return mapLinkedInRow(data as Record<string, unknown>);
}

export async function supabaseListLinkedInPendingPostsForChat(
    chatId: string,
    limit = 15
): Promise<LinkedInPendingRow[]> {
    const { data, error } = await getClient()
        .from('linkedin_pending_posts')
        .select(
            'id, chat_id, body, visibility, status, linkedin_response, error, image_url, created_at'
        )
        .eq('chat_id', chatId)
        .eq('status', 'pending')
        .order('id', { ascending: false })
        .limit(limit);
    if (error) throw new Error(`Supabase listLinkedInPendingPosts: ${error.message}`);
    return (data ?? []).map((row) => mapLinkedInRow(row as Record<string, unknown>));
}

export async function supabaseSetLinkedInPendingPublished(id: number, response: string): Promise<void> {
    const { error } = await getClient()
        .from('linkedin_pending_posts')
        .update({
            status: 'published',
            linkedin_response: response,
            error: null,
            updated_at: new Date().toISOString(),
        })
        .eq('id', id);
    if (error) throw new Error(`Supabase setLinkedInPendingPublished: ${error.message}`);
}

export async function supabaseSetLinkedInPendingFailed(id: number, err: string): Promise<void> {
    const { error } = await getClient()
        .from('linkedin_pending_posts')
        .update({
            status: 'failed',
            error: err,
            updated_at: new Date().toISOString(),
        })
        .eq('id', id);
    if (error) throw new Error(`Supabase setLinkedInPendingFailed: ${error.message}`);
}

export async function supabaseSetLinkedInPendingRejected(id: number): Promise<void> {
    const { error } = await getClient()
        .from('linkedin_pending_posts')
        .update({
            status: 'rejected',
            updated_at: new Date().toISOString(),
        })
        .eq('id', id);
    if (error) throw new Error(`Supabase setLinkedInPendingRejected: ${error.message}`);
}
