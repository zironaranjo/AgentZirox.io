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
