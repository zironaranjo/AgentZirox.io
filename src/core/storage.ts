import { createClient } from '@supabase/supabase-js';

const BUCKET = 'whatsapp-media';

function getClient() {
    const url = process.env.SUPABASE_URL?.trim();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configurados');
    return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export interface MediaRecord {
    id?: number;
    chat_id: string;
    sender_name: string;
    sender_number: string;
    public_url: string;
    bucket_path: string;
    mime_type: string;
    caption: string;
    vision_description: string;
    created_at?: string;
}

export async function uploadImageToStorage(
    base64: string,
    mimeType: string,
    chatId: string,
    senderNumber: string,
    senderName: string,
    caption: string,
    visionDescription: string
): Promise<{ publicUrl: string; record: MediaRecord }> {
    const supabase = getClient();

    const ext = mimeType.includes('png') ? 'png' : mimeType.includes('gif') ? 'gif' : 'jpg';
    const path = `${chatId}/${Date.now()}_${senderNumber}.${ext}`;
    const buffer = Buffer.from(base64, 'base64');

    const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, buffer, { contentType: mimeType, upsert: false });

    if (uploadError) throw new Error(`Error subiendo imagen: ${uploadError.message}`);

    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path);

    const record: MediaRecord = {
        chat_id: chatId,
        sender_name: senderName,
        sender_number: senderNumber,
        public_url: publicUrl,
        bucket_path: path,
        mime_type: mimeType,
        caption,
        vision_description: visionDescription,
    };

    const { error: dbError } = await supabase.from('media').insert(record);
    if (dbError) throw new Error(`Error guardando metadata: ${dbError.message}`);

    return { publicUrl, record };
}

export async function deleteMedia(id: number): Promise<{ bucketPath: string }> {
    const supabase = getClient();
    const { data, error } = await supabase
        .from('media')
        .select('bucket_path')
        .eq('id', id)
        .single();
    if (error || !data) throw new Error(`Imagen #${id} no encontrada`);
    const { error: storageErr } = await supabase.storage
        .from(BUCKET)
        .remove([data.bucket_path]);
    if (storageErr) throw new Error(`Error eliminando archivo: ${storageErr.message}`);
    const { error: dbErr } = await supabase.from('media').delete().eq('id', id);
    if (dbErr) throw new Error(`Error eliminando metadata: ${dbErr.message}`);
    return { bucketPath: data.bucket_path };
}

const INFOGRAPHIC_BUCKET_PREFIX = 'infographics';

export async function uploadNotebooklmAudio(
    buffer: Buffer,
    chatId: string,
    slug: string,
    mimeType: string,
    ext: 'mp3' | 'mp4'
): Promise<{ publicUrl: string; bucketPath: string }> {
    const supabase = getClient();
    const safeSlug = slug.replace(/[^a-z0-9-]/gi, '-').slice(0, 48) || 'audio';
    const path = `notebooklm-audio/${chatId}/${safeSlug}-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, buffer, { contentType: mimeType, upsert: false });

    if (uploadError) throw new Error(`Error subiendo audio NotebookLM: ${uploadError.message}`);

    const {
        data: { publicUrl },
    } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return { publicUrl, bucketPath: path };
}

export async function uploadInfographicPng(
    buffer: Buffer,
    chatId: string,
    slug: string
): Promise<{ publicUrl: string; bucketPath: string }> {
    const supabase = getClient();
    const safeSlug = slug.replace(/[^a-z0-9-]/gi, '-').slice(0, 48) || 'infografia';
    const path = `${INFOGRAPHIC_BUCKET_PREFIX}/${chatId}/${safeSlug}-${Date.now()}.png`;

    const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, buffer, { contentType: 'image/png', upsert: false });

    if (uploadError) throw new Error(`Error subiendo infografía: ${uploadError.message}`);

    const {
        data: { publicUrl },
    } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return { publicUrl, bucketPath: path };
}

export async function updateInfographicJobPng(jobId: number, pngUrl: string): Promise<void> {
    const supabase = getClient();
    const { error } = await supabase
        .from('infographic_jobs')
        .update({ png_url: pngUrl, status: 'delivered' })
        .eq('id', jobId);
    if (error) throw new Error(`Error actualizando job #${jobId}: ${error.message}`);
}

export async function listInfographicJobs(chatId?: string, limit = 12): Promise<
    Array<{ id: number; title: string; png_url: string | null; created_at: string; status: string }>
> {
    const supabase = getClient();
    let query = supabase
        .from('infographic_jobs')
        .select('id, title, png_url, created_at, status')
        .order('created_at', { ascending: false })
        .limit(limit);
    if (chatId) query = query.eq('chat_id', chatId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{
        id: number;
        title: string;
        png_url: string | null;
        created_at: string;
        status: string;
    }>;
}

export async function listMedia(chatId?: string, limit = 20): Promise<MediaRecord[]> {
    const supabase = getClient();
    let query = supabase
        .from('media')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
    if (chatId) query = query.eq('chat_id', chatId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []) as MediaRecord[];
}

export async function uploadAudioToStorage(
    buffer: Buffer,
    mimeType: string,
    chatId: string,
    title: string,
    description: string,
    opts?: { voice?: string; source?: string }
): Promise<{ publicUrl: string; id: number }> {
    const supabase = getClient();
    const ext = mimeType.includes('mp4') ? 'mp4' : 'mp3';
    const safeSlug = title.toLowerCase().replace(/[^a-z0-9-]/gi, '-').slice(0, 48) || 'audio';
    const path = `saved-audio/${chatId}/${safeSlug}-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, buffer, { contentType: mimeType, upsert: false });

    if (uploadError) throw new Error(`Error subiendo audio: ${uploadError.message}`);

    const {
        data: { publicUrl },
    } = supabase.storage.from(BUCKET).getPublicUrl(path);

    const record = {
        chat_id: chatId,
        sender_name: opts?.source ?? 'tts',
        sender_number: opts?.voice ?? '',
        public_url: publicUrl,
        bucket_path: path,
        mime_type: mimeType,
        caption: title.slice(0, 200),
        vision_description: description.slice(0, 2000),
    };

    const { data, error: dbError } = await supabase.from('media').insert(record).select('id').single();
    if (dbError) throw new Error(`Error guardando metadata de audio: ${dbError.message}`);

    return { publicUrl, id: Number(data.id) };
}

export async function listAudioMedia(chatId?: string, limit = 20): Promise<MediaRecord[]> {
    const supabase = getClient();
    let query = supabase
        .from('media')
        .select('*')
        .like('mime_type', 'audio%')
        .order('created_at', { ascending: false })
        .limit(limit);
    if (chatId) query = query.eq('chat_id', chatId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []) as MediaRecord[];
}
