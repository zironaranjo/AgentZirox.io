# 🧠 Ziro - System Architecture & Context

> **Índice del agente:** [[00 - Agente Ziro]] · **VPS / limpieza:** [[limpieza-vps|Limpieza VPS]]

> Última actualización: 2 de Mayo 2026

## 1. Project Overview
**Ziro** es un Agente de IA Personal que opera simultáneamente como:
- 🌐 **Web App** en `https://ziro.zirox.io` (interfaz de chat cibernética)
- 🤖 **Telegram Bot** activo en segundo plano 24/7

### Core Identity:
| Campo | Valor |
|---|---|
| **Nombre** | Ziro |
| **Versión** | 1.0.0 |
| **Dominio** | `https://ziro.zirox.io` |
| **Tema Visual** | Cibernético, Glassmorphism, Neon Purple `#8b5cf6` & Blue `#0ea5e9` |
| **VPS** | Desplegado en VPS propio vía Dokploy |
| **Repositorio** | `github.com/zironaranjo/AgentZirox.io` |

---

## 2. Arquitectura del Sistema

### Patrón: Monolito Next.js con Custom Server
```
server.ts (Bootloader)
    ├── import 'dotenv/config'    → Carga .env antes de todo (crítico en Docker)
    ├── initMemory()             → Supabase (Postgres) o SQLite como fallback
    ├── startScheduledTasksTicker() → Ticker cada 60s para ejecutar tareas programadas
    ├── startTelegramBot()       → Polling infinito en background (fire-and-forget)
    └── next.js HTTP Server      → Escucha en 0.0.0.0:3000
            └── /api/chat        → Endpoint web de chat
            └── / (page.tsx)     → Interfaz web del chat
```

### ¿Por qué esta arquitectura?
- Next.js App Router da escalabilidad máxima para el SaaS futuro
- El bot de Telegram se lanza con **fire-and-forget** después de que el servidor HTTP ya está escuchando. Es CRÍTICO: `bot.start()` es infinito y bloquearía el servidor si se usara `await`.
- `tsup` compila TypeScript → JS durante el build de Docker para que en producción solo corra `node dist-server/server.js` (sin tsx en runtime)
- `import 'dotenv/config'` como primera línea de `server.ts` es CRÍTICO para que Docker lea el `.env` que Dokploy crea en el contenedor

---

## 3. Stack Tecnológico
| Capa | Tecnología |
|---|---|
| **Frontend** | Next.js 16, React 19, Tailwind CSS 4, Google Fonts (Outfit) |
| **API Routes** | Next.js App Router `/api/chat/route.ts` |
| **Backend Custom Server** | TypeScript → compilado con tsup → `node dist-server/server.js` |
| **Bot Telegram** | grammY (long polling, fire-and-forget) |
| **Memoria principal** | Supabase (Postgres) — persiste entre reinicios y redespliegues |
| **Memoria fallback** | better-sqlite3 (SQLite local) — si Supabase no está configurado |
| **LLM** | Groq / OpenRouter / Hermes (endpoint OpenAI-compatible) |
| **Imágenes IA** | KIE.ai (API unificada jobs/createTask + jobs/recordInfo) |
| **Deployment** | Dokploy + Dockerfile custom en VPS — ver [[limpieza-vps]] |
| **Build** | Dockerfile con Node 20-bullseye-slim |
| **CI/CD** | Push a `main` → Deploy manual en Dokploy |

---

## 4. Estructura de Carpetas
```
AgentZirox.io/
├── Brain/                    → 📖 Documentación de arquitectura (este archivo)
│   └── limpieza-vps.md       → Mantenimiento VPS / Dokploy / Docker ([[limpieza-vps]])
├── public/                   → Assets estáticos (avatar.png)
├── src/
│   ├── app/                  → Next.js App Router
│   │   ├── layout.tsx        → Root layout (fuente Outfit, metadata)
│   │   ├── page.tsx          → Chat UI (componente React "use client")
│   │   ├── globals.css       → Tailwind + variables CSS del tema cibernético
│   │   └── api/chat/
│   │       └── route.ts      → POST /api/chat
│   ├── core/
│   │   ├── agent.ts          → Procesador de mensajes principal (loop de tools)
│   │   ├── dispatcher.ts     → Router de herramientas/tools
│   │   ├── llm.ts            → Clientes Groq/OpenRouter/Hermes (LAZY), buildSystemPrompt()
│   │   ├── logger.ts         → Logger centralizado
│   │   ├── memory.ts         → Facade: Supabase (principal) o SQLite (fallback)
│   │   ├── memory-sqlite.ts  → Implementación SQLite con better-sqlite3
│   │   ├── memory-supabase.ts → Implementación Supabase (Postgres)
│   │   ├── process-scheduled.ts → Ticker de tareas programadas (cada 60s)
│   │   └── tool-context.ts   → AsyncLocalStorage para pasar chatId a las tools
│   ├── integrations/
│   │   ├── telegram/
│   │   │   ├── bot.ts        → Bot de Telegram (grammY) + comandos /li_approve, /li_reject, /li_pending
│   │   │   └── send-message.ts → API HTTP directa de Telegram (sin grammY, para cron/tools)
│   │   ├── linkedin/
│   │   │   └── linkedin-api.ts → OAuth + ugcPosts API de LinkedIn
│   │   └── email/imap.ts     → Lector de emails (IMAP)
│   └── tools/                → Herramientas del agente
│       ├── index.ts          → Registro de todas las tools
│       ├── generate-image.ts → Generación de imagen con KIE.ai (polling + notificación directa)
│       ├── linkedin.ts       → linkedin_propose_post, linkedin_save_draft, linkedin_list_drafts
│       ├── schedule-task.ts  → Programar tareas con run_at_iso
│       ├── web-search.ts     → Búsqueda web en tiempo real
│       ├── call-api.ts       → Llamadas a APIs externas arbitrarias
│       ├── send-email.ts     → Envío de email vía SMTP
│       ├── read-inbox.ts     → Lectura de email vía IMAP
│       ├── capture-note.ts   → Captura rápida de ideas
│       ├── remember-user.ts  → Guardar perfil del usuario en DB
│       ├── search-memory.ts  → Búsqueda en historial
│       └── ... (workspace, drive, sheets, calendar, etc.)
├── server.ts                 → 🚀 Bootloader personalizado (Next.js + Bot + Ticker)
├── Dockerfile                → Build: next build + tsup → CMD node dist-server/server.js
├── .dockerignore             → NO excluye .env (crítico para que Dokploy inyecte vars)
├── .env.example              → Plantilla de variables de entorno
├── tsconfig.json             → module: esnext, moduleResolution: bundler
└── tailwind.config.ts        → Config Tailwind apuntando a src/app/**
```

---

## 5. Variables de Entorno (configuradas en Dokploy)
| Variable | Obligatoria | Descripción |
|---|---|---|
| `NODE_ENV` | ✅ | `production` |
| `TELEGRAM_BOT_TOKEN` | ✅ | Token BotFather |
| `GROQ_API_KEY` | ✅ | API Key de console.groq.com |
| `SUPABASE_URL` | ✅ | URL del proyecto Supabase (memoria persistente) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Service Role Key de Supabase |
| `LLM_PROVIDER` | ⚡ | `groq` / `openrouter` / `hermes` |
| `GROQ_MODEL` | ⚡ | default: `llama-3.3-70b-versatile` |
| `GROQ_TRANSCRIPTION_MODEL` | 🔵 | Modelo Whisper para voz en Telegram |
| `AGENT_NAME` | ⚡ | `Ziro` |
| `AGENT_VERSION` | ⚡ | `1.0.0` |
| `OPENROUTER_API_KEY` | 🔵 | Solo si usas OpenRouter |
| `OPENROUTER_MODEL` | 🔵 | Modelo principal de chat |
| `OPENROUTER_TOOLS_MODEL` | 🔵 | Modelo compatible con tool-calling |
| `OPENROUTER_VISION_MODEL` | 🔵 | Modelo para analisis de imagen en Telegram |
| `KIE_API_KEY` | 🔵 | API Key de KIE.ai para generación de imágenes |
| `KIE_IMAGE_MODEL` | 🔵 | default: `flux-2/pro-text-to-image` |
| `LINKEDIN_CLIENT_ID` | 🔵 | OAuth LinkedIn (para publicar posts) |
| `LINKEDIN_CLIENT_SECRET` | 🔵 | OAuth LinkedIn |
| `LINKEDIN_REFRESH_TOKEN` | 🔵 | Refresh token LinkedIn (se rota; actualizar en .env) |
| `LINKEDIN_PERSON_URN` | 🔵 | `urn:li:person:XXXX` — se obtiene automáticamente si no se configura |
| `SCHEDULED_TASKS_ENABLED` | ⚡ | `true` para activar ticker de tareas programadas |
| `SCHEDULED_TASKS_TICK_MS` | 🔵 | Intervalo del ticker (default: 60000 ms) |
| `CRON_SECRET` | 🔵 | Bearer para endpoint HTTP `/api/cron/scheduled-tasks` |
| `HERMES_BASE_URL` / `HERMES_API_KEY` / `HERMES_MODEL` | 🔵 | Solo si usas provider `hermes` |
| `SMTP_*` / `IMAP_*` | 🔵 | Solo si usas integración de email |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` | 🔵 | OAuth2 para Google Drive + Gmail |
| `WORKSPACE_BASE_DIR` | ✅ | Sandbox de archivos del agente en VPS |

---

## 6. Sistema de Memoria (Supabase + SQLite)

### Selección de backend (automática en `initMemory()`):
1. Si `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` están presentes → **Supabase (Postgres)**
2. Si Supabase falla al iniciar → fallback automático a **SQLite**
3. Sin variables Supabase → **SQLite** directamente

### Tablas en Supabase (migración: `supabase/migrations/001_agent_memory.sql`):
- `messages` — historial de conversaciones por `chat_id`
- `agent_meta` — perfil del usuario (nombre, notas)
- `scheduled_tasks` — tareas programadas (estado: pending/running/done/failed)
- `linkedin_pending_posts` — posts LinkedIn pendientes de aprobación

### Diagnóstico en logs al arrancar:
```
[memory] SUPABASE_URL=SET SUPABASE_SERVICE_ROLE_KEY=SET
[memory] backend: supabase (Postgres)
✅ Persistent Memory initialized
```

---

## 7. Flujo LinkedIn (aprobación humana obligatoria)
1. Usuario pide publicar → agente llama `linkedin_propose_post` → post guardado en DB con estado `pending`
2. La tool envía un **mensaje directo** vía API HTTP con el ID y el comando `/li_approve N`
3. Usuario ejecuta `/li_approve N` en Telegram → bot publica en LinkedIn vía ugcPosts API
4. Si hay error de red → post permanece `pending` para reintentar con `/li_approve N` de nuevo
5. Si hay error definitivo de LinkedIn (4xx/5xx) → post marcado como `failed`
6. Posts `failed` también se pueden reintentar con `/li_approve N`

### Comandos Telegram para LinkedIn:
| Comando | Acción |
|---|---|
| `/li_pending` | Lista posts pendientes de aprobación |
| `/li_approve N` | Publica el post N en LinkedIn |
| `/li_reject N` | Cancela el post N sin publicar |

---

## 8. Sistema de Tareas Programadas
- Tool `schedule_task(instruction, run_at_iso)` guarda la tarea en DB
- Ticker interno (`startScheduledTasksTicker`) ejecuta tareas vencidas cada 60s
- Al ejecutar: llama a `processMessage()` con la instrucción → envía resultado por Telegram
- Las tareas persisten en Supabase → sobreviven reinicios y redespliegues
- El sistema prompt incluye tareas pendientes en cada conversación para que el agente sea consciente de ellas

---

## 9. Estado Actual ✅ (Mayo 2026)
- [x] VPS limpiado y Dokploy configurado
- [x] Subdominio `ziro.zirox.io` con DNS + SSL
- [x] Bot de Telegram activo (grammY polling)
- [x] Arquitectura monolito Next.js + custom server
- [x] Memoria persistente con **Supabase (Postgres)** — datos sobreviven redespliegues
- [x] Fallback automático a SQLite si Supabase no está disponible
- [x] Fix crítico `.dockerignore`: `.env` NO excluido → vars de entorno llegan al contenedor
- [x] `import 'dotenv/config'` en `server.ts` → dotenv carga el `.env` en producción
- [x] Generación de imágenes con **KIE.ai** (API unificada, modelo Flux-2 por defecto)
  - Feedback inmediato ("Generando imagen...") mientras hace polling
  - Imagen descargada y subida como buffer a Telegram (no URL directa que expira)
- [x] **LinkedIn publishing** con flujo de aprobación humana obligatoria
  - `linkedin_propose_post` → mensaje directo con ID y comando `/li_approve N`
  - `/li_approve`, `/li_reject`, `/li_pending` en Telegram
  - Retry automático en errores de red (post permanece `pending`)
- [x] **Tareas programadas** con ticker interno cada 60s
  - `schedule_task` con `run_at_iso` → guardado en Supabase
  - Notificación automática por Telegram cuando vence la tarea
  - Tareas visibles en system prompt del agente
- [x] Búsqueda web en tiempo real (`web_search`)
- [x] Workspace seguro en VPS (`create_folder`, `write_file`, etc.)
- [x] Transcripción automática de notas de voz (Whisper vía Groq)
- [x] Análisis de imágenes en Telegram (OpenRouter Vision)
- [x] Google Drive, Gmail, Sheets y Calendar integrados
- [x] Perfil de usuario persistente (`remember_about_user` → inyectado en system prompt)
- [x] Fix: comandos `/slash` nunca van al LLM (solo a sus handlers)
- [x] Retry en OpenRouter ante errores 429 con backoff

## 10. Próximos Pasos / Roadmap
- [ ] **Paridad completa Web + Telegram** — mismo pipeline de tools y memoria en `/api/chat`
- [ ] **Historial de chat en la web** — cargar conversaciones desde Supabase en la UI
- [ ] **Streaming de respuestas** — respuestas en tiempo real en web
- [ ] **Autenticación** (Clerk o NextAuth) — proteger el dashboard
- [ ] **Dashboard de Admin** — panel de conversaciones, tareas programadas, configuración
- [ ] **Escalar a SaaS** — multiusuario, planes de pago, subagentes por rol
