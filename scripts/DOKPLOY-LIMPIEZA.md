# Limpieza de Dokploy + VPS (Zirox)

> Versión corta en repo. **Nota Obsidian completa (wikilinks, historial):** `Brain/limpieza-vps.md`

Guía para dejar el servidor ordenado: **solo lo que usas en producción**, menos disco y menos builds fallidos acumulados.

## Qué deberías tener (referencia)

| App en Dokploy | Repo GitHub | Dominio | Build |
|----------------|-------------|---------|--------|
| **Agente Ziro** | `zironaranjo/AgentZirox.io` | `https://ziro.zirox.io` | Dockerfile raíz |
| **Landing** | `zironaranjo/Zirox` (carpeta raíz = `app-temp` o repo root según cómo lo creaste) | `https://zirox.io` | Dockerfile (Next standalone) |

**n8n** (`ziroxxn8n.ziroxn8n.site`) suele ser **otro servicio** — no lo borres si lo usas para webhooks del agente.

---

## 1. Panel Dokploy — aplicaciones

En **Projects →** cada proyecto:

### Mantener
- Proyecto del **agente** (un solo servicio activo).
- Proyecto de la **landing** (un solo servicio activo).

### Eliminar o archivar
- Apps **duplicadas** del mismo repo (pruebas, “agent-old”, “zirox-test”).
- Servicios que ya no despliegan (Coolify legacy, nginx manual duplicado, etc.).
- Bases de datos **Postgres/MySQL creadas en Dokploy** que no uses (el agente usa **Supabase en la nube**, no hace falta Postgres local salvo que lo hayas añadido tú).

### Por servicio — pestaña Deployments
- Deja el **último deploy exitoso** (verde).
- Borra deploys **fallidos** antiguos (rojo) — solo ocupan historial y a veces caché.
- Si el disco va justo: en configuración del servicio, limita **retención de imágenes** / rebuild limpio.

### Dominios
- **Agente:** solo `ziro.zirox.io` → puerto del contenedor (3000).
- **Landing:** solo `zirox.io` y opcional `www.zirox.io` (redirect a apex si quieres).
- Quita dominios huérfanos que apunten a contenedores borrados.

---

## 2. Variables de entorno — auditoría (agente)

En el servicio **AgentZirox**, revisa que existan las **críticas**:

- `TELEGRAM_BOT_TOKEN`
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
- `OPENROUTER_API_KEY` o `GROQ_API_KEY` (+ `LLM_PROVIDER`)
- `WEB_API_SECRET` (si proteges `/api/chat`)
- `WORKSPACE_BASE_DIR=/opt/zirox-workspace` (o tu ruta)

### Puedes quitar del VPS (no se usan en runtime allí)
- `REMOVE_BG_API_KEY` — solo para script local en tu PC.
- `DESKTOP_CONTROL_*` — control de escritorio es **local Windows**, no VPS.

### Desactivar si no las usas (menos ruido y menos secretos)
- `NOTEBOOKLM_*` si `NOTEBOOKLM_ENABLED=false`
- `TIKTOK_*` si no publicas en TikTok
- `SELF_IMPROVE_*` si `SELF_IMPROVE_ENABLED=false`
- `SCHEDULED_TASKS_*` si usas solo ticker interno con `SCHEDULED_TASKS_ENABLED=true`

Lista completa: `.env.example` en el repo.

### Landing
Solo necesita variables de Next si las tienes (Vapi, webhooks, etc.). **No** pegues claves del agente en la landing.

---

## 3. Build del agente — caché

Si tras un push **no ves cambios**:

1. Dokploy → servicio agente → **Build** / **Environment**
2. **Build Args:** `CACHEBUST=<timestamp>` (número nuevo cada deploy importante)
3. **Redeploy** sin caché si el panel lo ofrece (“Clear build cache” / rebuild)

El `Dockerfile` invalida capas desde `ARG CACHEBUST`.

---

## 4. Volúmenes (no borrar sin mirar)

| Volumen / ruta | Uso |
|----------------|-----|
| `/opt/zirox/notebooklm` o `NOTEBOOKLM_STORAGE_PATH` | Auth NotebookLM — **no borrar** si usas infografías NL |
| `/opt/zirox-workspace` | Archivos del agente en VPS |
| SQLite local | Solo si **no** usas Supabase |

En Dokploy → **Volumes**: elimina solo montajes de apps que ya borraste.

---

## 5. Limpieza Docker en el VPS (SSH)

Conéctate al VPS (`ssh root@TU_IP`) y ejecuta primero en **modo simulación**:

```bash
# Ver espacio
df -h /
docker system df

# Simulación (no borra)
docker system prune -a --volumes -f --filter "until=24h"  # cuidado con --volumes
```

Script del repo (recomendado):

```bash
cd /ruta/al/repo/AgentZirox.io/scripts
chmod +x dokploy-vps-prune.sh
./dokploy-vps-prune.sh          # dry-run
./dokploy-vps-prune.sh --apply  # ejecuta limpieza segura
```

**Seguro por defecto:** borra contenedores parados, redes no usadas e imágenes **dangling** (<none>).  
**No** borra volúmenes nombrados ni imágenes de contenedores **en ejecución**.

### Si necesitas más espacio (agresivo — leer antes)

```bash
# Imágenes no usadas por ningún contenedor (libera mucho disco)
docker image prune -a -f

# Solo si estás seguro de que no hay volúmenes importantes huérfanos
docker volume prune -f
```

---

## 6. Dokploy — limpieza desde la UI

Según versión de Dokploy:

- **Settings → Docker** → “Prune” / limpiar sistema  
- **Monitoring** → revisar CPU/RAM/disco  
- Reiniciar solo el **servicio** afectado, no todo Dokploy, salvo mantenimiento

---

## 7. Checklist rápido (15 min)

- [ ] Solo 2 apps web activas: agente + landing  
- [ ] Dominios correctos y SSL verde  
- [ ] Deploys fallidos antiguos eliminados  
- [ ] Env del agente sin claves locales (`REMOVE_BG`, `DESKTOP_CONTROL`)  
- [ ] `CACHEBUST` actualizado si el build “no cambia”  
- [ ] `docker system df` — disco &lt; 85% en `/`  
- [ ] Volúmenes NotebookLM/workspace intactos si los usas  
- [ ] Probar: `https://zirox.io` y `https://ziro.zirox.io`

---

## 8. Si algo se rompe tras limpiar

1. Dokploy → servicio → **Redeploy** último commit de `main`  
2. Revisar logs del contenedor (build + runtime)  
3. Agente: debe arrancar con `node dist-server/server.js` (no solo `next start`)  
4. Landing: `node server.js` en imagen standalone  

---

*Última actualización: mayo 2026 — repos AgentZirox.io + Zirox (landing).*
