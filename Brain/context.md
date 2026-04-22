# 🧠 Ziro - System Architecture & Context

> Última actualización: 21 de Abril 2026

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
    ├── initMemory()          → SQLite DB en ./data/
    ├── startTelegramBot()    → Polling infinito en background (fire-and-forget)
    └── next.js HTTP Server   → Escucha en 0.0.0.0:3000
            └── /api/chat     → Endpoint web de chat (pendiente pulir parity total con Telegram)
            └── / (page.tsx)  → Interfaz web del chat
```

### ¿Por qué esta arquitectura?
- Next.js App Router da escalabilidad máxima para el SaaS futuro
- El bot de Telegram se lanza con **fire-and-forget** después de que el servidor HTTP ya está escuchando. Es CRÍTICO: `bot.start()` es infinito y bloquearía el servidor si se usara `await`.
- `tsup` compila TypeScript → JS durante el build de Docker para que en producción solo corra `node dist-server/server.js` (sin tsx en runtime)

---

## 3. Stack Tecnológico
| Capa | Tecnología |
|---|---|
| **Frontend** | Next.js 16, React 19, Tailwind CSS 4, Google Fonts (Outfit) |
| **API Routes** | Next.js App Router `/api/chat/route.ts` |
| **Backend Custom Server** | TypeScript → compilado con tsup → `node dist-server/server.js` |
| **Bot Telegram** | grammY (long polling, fire-and-forget) |
| **Memoria** | better-sqlite3 (SQLite) |
| **LLM** | Groq / OpenRouter / Hermes (endpoint OpenAI-compatible) |
| **Deployment** | Dokploy + Dockerfile custom en VPS |
| **Build** | Dockerfile con Node 20-bullseye-slim |
| **CI/CD** | Push a `main` → Deploy manual en Dokploy |

---

## 4. Estructura de Carpetas
```
AgentZirox.io/
├── Brain/                    → 📖 Documentación de arquitectura (este archivo)
├── public/                   → Assets estáticos (avatar.png)
├── src/
│   ├── app/                  → Next.js App Router
│   │   ├── layout.tsx        → Root layout (fuente Outfit, metadata)
│   │   ├── page.tsx          → Chat UI (componente React "use client")
│   │   ├── globals.css       → Tailwind + variables CSS del tema cibernético
│   │   └── api/chat/
│   │       └── route.ts      → POST /api/chat (mock por ahora)
│   ├── core/
│   │   ├── agent.ts          → Procesador de mensajes principal
│   │   ├── dispatcher.ts     → Router de herramientas/tools
│   │   ├── llm.ts            → Clientes Groq/OpenRouter (LAZY — no crashea sin API key)
│   │   ├── logger.ts         → Logger centralizado
│   │   └── memory.ts         → SQLite: historial de conversaciones
│   ├── integrations/
│   │   ├── telegram/bot.ts   → Bot de Telegram (grammY)
│   │   └── email/imap.ts     → Lector de emails (IMAP)
│   └── tools/                → Herramientas del agente (email, API, memoria, etc.)
├── server.ts                 → 🚀 Bootloader personalizado (Next.js + Bot)
├── Dockerfile                → Build: next build + tsup → CMD node dist-server/server.js
├── .env.example              → Plantilla de variables de entorno
├── tsconfig.json             → module: esnext, moduleResolution: bundler (para Next.js)
└── tailwind.config.ts        → Config Tailwind apuntando a src/app/**
```

---

## 5. Variables de Entorno (configuradas en Dokploy)
| Variable | Obligatoria | Descripción |
|---|---|---|
| `NODE_ENV` | ✅ | `production` |
| `TELEGRAM_BOT_TOKEN` | ✅ | Token BotFather |
| `GROQ_API_KEY` | ✅ | API Key de console.groq.com |
| `LLM_PROVIDER` | ⚡ | `groq` / `openrouter` / `hermes` |
| `GROQ_MODEL` | ⚡ | default: `llama-3.3-70b-versatile` |
| `GROQ_TRANSCRIPTION_MODEL` | 🔵 | Modelo Whisper para voz en Telegram |
| `AGENT_NAME` | ⚡ | `Ziro` |
| `AGENT_VERSION` | ⚡ | `1.0.0` |
| `OPENROUTER_API_KEY` | 🔵 | Solo si usas OpenRouter |
| `OPENROUTER_MODEL` | 🔵 | Modelo principal de chat |
| `OPENROUTER_TOOLS_MODEL` | 🔵 | Modelo compatible con tool-calling |
| `OPENROUTER_VISION_MODEL` | 🔵 | Modelo para analisis de imagen en Telegram |
| `HERMES_BASE_URL` / `HERMES_API_KEY` / `HERMES_MODEL` | 🔵 | Solo si usas provider `hermes` |
| `SMTP_*` / `IMAP_*` | 🔵 | Solo si usas integración de email |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` | 🔵 | OAuth2 para Google Drive + Gmail API |
| `GOOGLE_REDIRECT_URI` / `GOOGLE_DRIVE_ROOT_FOLDER_ID` | 🔵 | URI OAuth y carpeta raiz opcional en Drive |
| `WORKSPACE_BASE_DIR` | ✅ | Sandbox de archivos del agente en VPS |

---

## 6. Estado Actual ✅ (Abril 2026)
- [x] VPS limpiado (se liberaron ~50GB de Docker artifacts)
- [x] Subdominio `ziro.zirox.io` configurado con DNS + SSL
- [x] Aplicación desplegada en Dokploy con Dockerfile propio
- [x] Interfaz web cibernética visible y funcional
- [x] Bot de Telegram activo en paralelo
- [x] Variables de entorno configuradas en Dokploy
- [x] Arquitectura migrada de Express a Next.js 16 Monolito
- [x] Problema del "Bad Gateway" resuelto (bot fire-and-forget + 0.0.0.0 binding)
- [x] Proveedor OpenRouter con modelo Hermes operativo en producción
- [x] Routing híbrido OpenRouter: modelo chat + modelo tools separado
- [x] Workspace seguro para operaciones de archivos en VPS
- [x] Tools de operaciones: `create_folder`, `write_file`, `append_file`, `read_file`, `list_files`
- [x] Plantilla rápida por cliente: `create_client_workspace`
- [x] Captura rápida de ideas: `capture_note` (ej: "anota esto...")
- [x] Soporte de mensajes de voz/audio de Telegram con transcripción automática
- [x] Soporte de analisis de imagen en Telegram (`message:photo` + OpenRouter Vision)
- [x] Integracion Google Drive/Gmail con tools:
  - `drive_create_folder`
  - `drive_save_important_emails`
  - `drive_archive_important_emails`
- [x] Fix robusto de respuestas Telegram cuando falla parseo Markdown (fallback a texto plano)
- [x] Fix del loop del agente para no responder solo "✅ Hecho." y devolver resultado real de tools

## 7. Próximos Pasos / Roadmap
- [ ] **Paridad completa Web Chat vs Telegram** — asegurar que web use exactamente el mismo loop de tools y memoria
- [ ] **Cerrar loop de permisos Google en producción** — terminar validación OAuth estable para archivado de correos sin errores de autorización
- [ ] **Canales adicionales** — Instagram/WhatsApp como bandeja de entrada de notas/tareas
- [ ] **Auth** — Añadir Clerk o NextAuth para proteger dashboard
- [ ] **Dashboard de Admin** — panel de conversaciones, jobs y configuración de tools
- [ ] **Escalar a SaaS** — multiusuario, planes de pago, subagentes por rol
