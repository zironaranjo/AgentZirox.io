# Activación NotebookLM en VPS (Dokploy + Docker)
#
# Flujo recomendado:
#   1. Login Google en tu PC (Windows) → scripts/setup-notebooklm-auth.ps1
#   2. Copiar storage_state.json al VPS
#   3. Variables en Dokploy + volumen persistente
#   4. Redeploy + deploy workflow n8n
#
# ─────────────────────────────────────────────────────────────
# PASO 1 — Login en tu PC (Windows, una sola vez)
# ─────────────────────────────────────────────────────────────
#   powershell -ExecutionPolicy Bypass -File scripts/setup-notebooklm-auth.ps1
#
# Genera: %USERPROFILE%\.notebooklm\profiles\default\storage_state.json
#
# ─────────────────────────────────────────────────────────────
# PASO 2 — Copiar auth al VPS (SSH)
# ─────────────────────────────────────────────────────────────
#   ssh root@TU_VPS_IP
#   mkdir -p /opt/zirox/notebooklm/profiles/default
#   exit
#
# Desde tu PC:
#   scp "$env:USERPROFILE\.notebooklm\profiles\default\storage_state.json" root@TU_VPS_IP:/opt/zirox/notebooklm/profiles/default/
#
# ─────────────────────────────────────────────────────────────
# PASO 3 — Dokploy: volumen + variables
# ─────────────────────────────────────────────────────────────
# Volumen (Advanced → Mounts):
#   Host:  /opt/zirox/notebooklm
#   Container: /app/.notebooklm
#
# Variables de entorno (añadir o actualizar):
#   NOTEBOOKLM_ENABLED=true
#   NOTEBOOKLM_HOME=/app/.notebooklm
#   NOTEBOOKLM_STYLE=editorial
#   NOTEBOOKLM_TIMEOUT_MS=660000
#   N8N_NOTEBOOKLM_INFOGRAPHIC_ENABLED=true
#   N8N_CREATE_INFOGRAPHIC_ENABLED=true
#   INFOGRAPHIC_STYLE=pro
#
# Build Args (obligatorio en cada deploy con cambios):
#   CACHEBUST=<timestamp>
#
# Alternativa sin volumen (auth en env, JSON grande):
#   NOTEBOOKLM_AUTH_JSON={"cookies":[...]}
#   (generar con scripts/export-notebooklm-auth.ps1)
#
# ─────────────────────────────────────────────────────────────
# PASO 4 — Deploy n8n workflow
# ─────────────────────────────────────────────────────────────
#   N8N_API_KEY=tu_clave node scripts/deploy-notebooklm-n8n.mjs
#
# ─────────────────────────────────────────────────────────────
# PASO 5 — Verificar dentro del contenedor
# ─────────────────────────────────────────────────────────────
#   docker ps
#   docker exec -it <container_id> bash scripts/check-notebooklm-vps.sh
#
# ─────────────────────────────────────────────────────────────
# PASO 6 — Probar por Telegram
# ─────────────────────────────────────────────────────────────
#   "Infografía estilo NotebookLM sobre [tema] con 3 pasos y 3 beneficios"
#
# ─────────────────────────────────────────────────────────────
# Refresh auth (cron semanal recomendado en el VPS host)
# ─────────────────────────────────────────────────────────────
#   0 3 * * 0 cd /opt/zirox && notebooklm auth refresh && cp ~/.notebooklm/profiles/default/storage_state.json /opt/zirox/notebooklm/profiles/default/
