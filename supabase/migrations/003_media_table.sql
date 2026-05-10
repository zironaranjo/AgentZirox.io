-- Tabla para imágenes guardadas desde WhatsApp
CREATE TABLE IF NOT EXISTS media (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    chat_id     TEXT NOT NULL,
    sender_name TEXT NOT NULL DEFAULT '',
    sender_number TEXT NOT NULL DEFAULT '',
    public_url  TEXT NOT NULL,
    bucket_path TEXT NOT NULL,
    mime_type   TEXT NOT NULL DEFAULT 'image/jpeg',
    caption     TEXT NOT NULL DEFAULT '',
    vision_description TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS media_chat_id_idx ON media (chat_id);
CREATE INDEX IF NOT EXISTS media_created_at_idx ON media (created_at DESC);

ALTER TABLE media ENABLE ROW LEVEL SECURITY;
GRANT ALL ON media TO service_role;
GRANT USAGE, SELECT ON SEQUENCE media_id_seq TO service_role;
