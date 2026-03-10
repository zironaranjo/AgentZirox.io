# 🧠 Ziro - System Architecture & Context

> Última actualización: 10 de Marzo 2026

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
            └── /api/chat     → Respuesta mock (pendiente conectar LLM)
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
| **LLM** | Groq (por defecto) / OpenRouter (opcional) |
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
| `LLM_PROVIDER` | ⚡ | `groq` o `openrouter` (default: groq) |
| `GROQ_MODEL` | ⚡ | default: `llama-3.3-70b-versatile` |
| `AGENT_NAME` | ⚡ | `Ziro` |
| `AGENT_VERSION` | ⚡ | `1.0.0` |
| `OPENROUTER_API_KEY` | 🔵 | Solo si usas OpenRouter |
| `SMTP_*` / `IMAP_*` | 🔵 | Solo si usas integración de email |

---

## 6. Estado Actual ✅ (Marzo 2026)
- [x] VPS limpiado (se liberaron ~50GB de Docker artifacts)
- [x] Subdominio `ziro.zirox.io` configurado con DNS + SSL
- [x] Aplicación desplegada en Dokploy con Dockerfile propio
- [x] Interfaz web cibernética visible y funcional
- [x] Bot de Telegram activo en paralelo
- [x] Variables de entorno configuradas en Dokploy
- [x] Arquitectura migrada de Express a Next.js 16 Monolito
- [x] Problema del "Bad Gateway" resuelto (bot fire-and-forget + 0.0.0.0 binding)

## 7. Próximos Pasos / Roadmap
- [ ] **Conectar Web Chat al LLM real** — Modificar `/api/chat/route.ts` para llamar a `callLLM()` de `src/core/llm.ts` y devolver respuestas reales de Groq
- [ ] **Memoria compartida Web+Telegram** — Mismo `chatId` para que Ziro recuerde en ambas interfaces
- [ ] **Auth** — Añadir Clerk o NextAuth para proteger el dashboard con login
- [ ] **Dashboard de Admin** — Panel para ver conversaciones, cambiar configuración en vivo
- [ ] **Escalar a SaaS** — Multi-usuario, planes de pago, sub-agentes personalizados
