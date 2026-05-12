# Feature: Guardado de imágenes en Supabase Storage
**ID:** supabase-image-storage
**Estado:** in_progress (pendiente pasos manuales en Supabase)
**Iniciado:** 2026-05-12

## Plan
1. Cache en memoria de imágenes recibidas por WhatsApp (TTL 10 min)
2. Tool `save_image` — guarda bajo petición explícita del usuario
3. Tool `list_images` — lista imágenes guardadas con URLs públicas
4. Storage en bucket Supabase `whatsapp-media`
5. Metadata en tabla `media` de Supabase

## Implementación
- [x] `src/core/image-cache.ts` — Map con TTL 10min, funciones cacheImage/getCachedImage/clearCachedImage
- [x] `src/core/storage.ts` — uploadImageToStorage, listMedia, interfaz MediaRecord
- [x] `src/tools/save-image.ts` — tools save_image y list_images
- [x] `src/app/api/whatsapp/webhook/route.ts` — cacheImage() llamado tras análisis de vision
- [x] `src/tools/index.ts` — import './save-image' añadido
- [x] `supabase/migrations/003_media_table.sql` — migración creada
- [ ] Bucket `whatsapp-media` creado en Supabase Storage (manual, pendiente usuario)
- [ ] Migración 003 ejecutada en Supabase SQL Editor (manual, pendiente usuario)
- [ ] Deploy en Dokploy (pendiente pasos anteriores)

## Archivos modificados/creados
- `src/core/image-cache.ts` — nuevo
- `src/core/storage.ts` — nuevo
- `src/tools/save-image.ts` — nuevo
- `src/tools/index.ts` — import añadido
- `supabase/migrations/003_media_table.sql` — nuevo
- `src/app/api/whatsapp/webhook/route.ts` — cacheImage() añadido

## Pasos manuales pendientes (usuario)
1. Ir a Supabase → Storage → New bucket
   - Name: `whatsapp-media`
   - Public: ✅ activado
2. Ir a Supabase → SQL Editor → ejecutar:
   ```sql
   CREATE TABLE IF NOT EXISTS media (
       id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
       chat_id TEXT NOT NULL,
       sender_name TEXT NOT NULL DEFAULT '',
       sender_number TEXT NOT NULL DEFAULT '',
       public_url TEXT NOT NULL,
       bucket_path TEXT NOT NULL,
       mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
       caption TEXT NOT NULL DEFAULT '',
       vision_description TEXT NOT NULL DEFAULT '',
       created_at TIMESTAMPTZ DEFAULT NOW()
   );
   ```
3. Deploy en Dokploy (el código ya está en GitHub commit `03eb7ca`)

## Checkpoints
| Checkpoint | Estado | Notas |
|---|---|---|
| C1 — Coherencia de estado | ✅ | feature_list.json actualizado |
| C2 — TypeScript compila | ✅ | Sin errores de compilación |
| C3 — Tool registrada | ✅ | save_image y list_images en index.ts |
| C4 — Env vars documentadas | ✅ | SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya existían |
| C5 — Build pasa | ⏳ | Pendiente deploy post-pasos manuales |

## Notas
- Las imágenes NO se guardan automáticamente — solo cuando el usuario dice explícitamente "guarda esta imagen"
- La imagen vive en memoria (image-cache.ts) ~10 minutos después de recibirla por WhatsApp
- El chatId se pasa a la tool vía AsyncLocalStorage (tool-context.ts)
- El commit en GitHub es `03eb7ca`
