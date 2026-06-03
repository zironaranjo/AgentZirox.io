---
title: Limpieza VPS
aliases:
  - limpieza vps
  - vps
  - dokploy
  - docker
  - mantenimiento vps zirox
tags:
  - agente
  - vps
  - dokploy
  - hostinger
  - docker
  - mantenimiento
fecha: 2026-05-29
servidor: zirox
proveedor: Hostinger
---

# Limpieza VPS

> **← Índice:** [[00 - Agente Ziro]]  
> Servidor de **[[context|Ziro (Agente)]]**.

## Resumen rápido

| Paso | Comando / acción |
|------|------------------|
| 1 | VPS Hostinger → login **`root`** |
| 2 | `docker builder prune -f` (libera caché de builds) |
| 3 | `df -h /` — OK si uso **&lt; 85%** (tú: **22%**) |
| 4 | Dokploy → borrar deploys fallidos; quitar `REMOVE_BG`, `DESKTOP_CONTROL` |

**Cada mes:** `docker builder prune -f` + `df -h /`

> [!note] Detalle abajo
> El resto de esta nota es la guía completa paso a paso.

---

## Enlace con el agente

| Recurso | Rol |
|---------|-----|
| Contenedor `ziro-app-rw0ksv` | App **[[context|AgentZirox.io]]** → https://ziro.zirox.io |
| `WORKSPACE_BASE_DIR` | `/opt/zirox-workspace` — sandbox de archivos del agente |
| `/opt/zirox/notebooklm` | Auth NotebookLM (infografías) — **no borrar** |
| n8n + webhooks | Tareas e infografías del agente |
| Supabase self-hosted (`zirox-supabase-f5cl10-*`) | Stack en VPS (además o en lugar de Supabase cloud) |
| Dokploy | CI/CD: push `main` → rebuild Docker |

---

## Acceso al servidor

### Hostinger (recomendado)

1. **hPanel** → VPS **zirox** → Terminal o SSH.
2. Login en consola: **`root`** (sin `@`, sin email).
3. Contraseña: la de **root** desde hPanel → *Reset root password* si hace falta.

```bash
ssh root@TU_IP_VPS
```

> [!warning] No confundir terminales
> - **VPS Hostinger / SSH `root`** → limpieza Docker ✅  
> - **Terminal de un contenedor en Dokploy** → solo debug dentro de la app ❌ para `prune`

---

## Inventario de contenedores (referencia)

Snapshot tras auditoría — todo lo que estaba **Up**:

| Contenedor | Servicio |
|------------|----------|
| `landingzirox-onhqko...` | Landing https://zirox.io |
| `ziro-app-rw0ksv...` | **Agente** https://ziro.zirox.io |
| `dokploy...` + `dokploy-traefik` | Panel Dokploy + proxy |
| `zirox1-n8n...` + `postgres` | n8n |
| `zirox-supabase-f5cl10-*` | Supabase self-hosted (muchos servicios) |
| `zirox-postgres-ixqsgn...` | Postgres pgvector |
| `triada-*` | Triadak prod + **staging** (opcional apagar) |
| `dokploy-redis`, `dokploy-postgres` | Interno Dokploy |

**No parar** estos stacks sin saber qué haces.

---

## Imágenes Docker ≠ Supabase Storage

> [!info] Aclaración importante
> - **Imágenes Docker** (`docker image prune`) = capas de **aplicaciones** en el VPS. Es lo que limpiamos en terminal.  
> - **Archivos en Supabase Storage** = fotos/PDFs del producto. **No** se limpian con `docker`.  
> - El stack `zirox-supabase-f5cl10-*` es **Supabase instalado en el VPS** (contenedores), no el panel “Storage” de archivos.

---

## Procedimiento paso a paso (terminal)

### Paso 1 — Disco

```bash
df -h /
```

| Métrica | Antes (sesión) | Después |
|---------|----------------|---------|
| Usado | 127 GB (**66%**) | **43 GB (22%)** |
| Libre | 67 GB | **151 GB** |

> Por encima del **85%** conviene limpiar. Por debajo del **30%** vas holgado.

---

### Paso 2 — Resumen Docker

```bash
docker system df
```

Ejemplo **antes** de limpiar:

| TYPE | SIZE | RECLAIMABLE |
|------|------|-------------|
| Images | 23.48 GB | 12.3 GB |
| Build Cache | **83.3 GB** | **83.3 GB** |
| Local Volumes | 1.644 GB | ~964 MB |

El **Build Cache** fue el problema principal.

---

### Paso 3 — Contenedores activos

```bash
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"
```

Comprobar que agente y landing están **Up** antes y después de limpiar.

---

### Paso 4 — Limpieza principal (≈84 GB liberados)

```bash
docker builder prune -f
```

Luego verificar:

```bash
df -h /
docker system df
```

**Resultado esperado:** `Build Cache` → **0 B** (o poco); disco ~**22%** usado.

---

### Paso 5 — Limpieza extra (opcional)

```bash
docker image prune -f
docker container prune -f
docker network prune -f
```

En nuestra sesión `docker image prune -a -f` devolvió **0B** (todas las imágenes en uso por contenedores Up) — **normal**.

---

### Paso 6 — NO ejecutar sin revisar

```bash
# ⚠️ Puede borrar datos de n8n, Supabase, NotebookLM
docker volume prune -f
```

Listar antes:

```bash
docker volume ls
```

---

## Rutina mensual (2 comandos)

```bash
docker builder prune -f
df -h /
```

Repetir cuando `Build Cache` en `docker system df` supere ~**30 GB** otra vez.

Script del repo:

```bash
cd /ruta/AgentZirox.io/scripts
chmod +x dokploy-vps-prune.sh
./dokploy-vps-prune.sh          # simulación
./dokploy-vps-prune.sh --apply  # limpieza conservadora
```

---

## Dokploy (navegador) — después del VPS

### Apps que deben quedar

| Proyecto | Repo | Dominio |
|----------|------|---------|
| Agente | `zironaranjo/AgentZirox.io` | ziro.zirox.io |
| Landing | `zironaranjo/Zirox` | zirox.io |

### Por servicio

1. **Deployments** → borrar historial **fallido** (rojo); conservar último **exitoso** (verde).
2. **Dominios** → sin entradas huérfanas.
3. **Environment (agente `ziro-app`)** → quitar si existen:
   - `REMOVE_BG_API_KEY` (solo PC local)
   - `DESKTOP_CONTROL_*` (solo Windows local)

### Variables críticas del agente (mantener)

- `TELEGRAM_BOT_TOKEN`
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (si usas cloud)
- `OPENROUTER_API_KEY` o `GROQ_API_KEY` + `LLM_PROVIDER`
- `WEB_API_SECRET`
- `WORKSPACE_BASE_DIR=/opt/zirox-workspace`

Lista completa: `.env.example` en el repo.

### Build que no refleja cambios

Dokploy → servicio agente → **Build Args**:

```
CACHEBUST=202605291200
```

(número nuevo cada deploy importante) → **Redeploy**.

Ver [[scripts/DOKPLOY-LIMPIEZA#3. Build del agente — caché]].

### Opcional — ahorrar RAM

- Servicio **Triadak staging** (`triada-frontendtriadastaging`) — parar si no se usa.

---

## Volúmenes protegidos

| Ruta | Uso |
|------|-----|
| `/opt/zirox-workspace` | Archivos del agente |
| `/opt/zirox/notebooklm` | Sesión NotebookLM |
| Volúmenes n8n / Supabase / Dokploy | Datos de producción |

---

## Reinicio del sistema

Si aparece `*** System restart required ***` (actualización kernel):

```bash
reboot
```

Esperar 2–3 min y comprobar:

- https://ziro.zirox.io  
- https://zirox.io  

---

## Checklist rápido

- [ ] `df -h /` — uso **< 85%**
- [ ] `docker builder prune -f` si Build Cache > 30 GB
- [ ] Deploys fallidos borrados en Dokploy
- [ ] Env agente sin `REMOVE_BG` / `DESKTOP_CONTROL`
- [ ] `CACHEBUST` actualizado si el build no cambia
- [ ] Webs OK tras limpieza
- [ ] **No** `docker volume prune` sin revisar lista

---

## Si algo falla tras limpiar

1. Dokploy → servicio → **Redeploy** último `main`.
2. Logs del contenedor (build + runtime).
3. Agente debe arrancar: `node dist-server/server.js` (no solo `next start`).
4. Landing: `node server.js` (Next standalone).

---

## Historial de esta limpieza

| Fecha | Acción | Resultado |
|-------|--------|-----------|
| 2026-05-29 | `docker builder prune -f` | **~84 GB** liberados (127→43 GB usados) |
| 2026-05-29 | `docker image prune -f` | +77.7 MB |
| 2026-05-29 | `docker image prune -a -f` | 0 B (imágenes en uso) |

---

## Ver también

- [[context]] — arquitectura y deploy del agente  
- [[AGENTS]] — convenciones del repo  
- [[scripts/DOKPLOY-LIMPIEZA]] — versión corta en repo  
- [[scripts/ACTIVATE-NOTEBOOKLM-VPS]] — volumen NotebookLM  

```dataview
TABLE title, fecha
FROM ""
WHERE contains(file.tags, "vps")
SORT fecha DESC
```

> Si no usas el plugin Dataview, ignora el bloque anterior.
