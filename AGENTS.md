# AGENTS.md — AgentZirox.io

> Guía de roles y flujo de trabajo para Claude Code al desarrollar este proyecto.
> Leer completo antes de comenzar cualquier tarea de desarrollo.

---

## ¿Qué es este proyecto?

**AgentZirox.io** es un agente de IA personal, multicanal y extensible construido en Next.js + TypeScript.
Responde por Web, Telegram, WhatsApp y Email. Usa herramientas (tools) para ejecutar acciones reales:
buscar en internet, enviar mensajes, guardar archivos, publicar en LinkedIn, crear recordatorios, etc.

- **Runtime:** Node.js 20 + Next.js (App Router) con servidor custom (`server.ts`)
- **LLMs:** Groq, OpenRouter, Hermes (conmutable en caliente vía `set-provider`)
- **Memoria:** Supabase (Postgres) primario, SQLite como fallback
- **Deploy:** Docker en VPS vía Dokploy (rama `main` → build automático)
- **Idioma del agente:** Español. El código está en inglés.

---

## Estructura de archivos clave

```
src/
  core/
    agent.ts          ← Loop principal: LLM → tools → respuesta (max 8 iteraciones)
    dispatcher.ts     ← Registro y ejecución de tools
    llm.ts            ← Clientes multi-proveedor LLM
    memory.ts         ← Facade de memoria (delega a Supabase o SQLite)
    tool-context.ts   ← AsyncLocalStorage para pasar chatId a tools
    vision.ts         ← Análisis de imágenes (Claude vision)
    image-cache.ts    ← Cache en memoria de imágenes recibidas (TTL 10min)
    storage.ts        ← Supabase Storage para imágenes persistidas
  tools/
    index.ts          ← Hub de registro — TODA tool nueva va aquí
    *.ts              ← Una tool por archivo, registrada con registerTool()
  app/api/
    chat/route.ts     ← POST /api/chat (Web + MCP)
    whatsapp/webhook/route.ts ← Webhook WhatsApp (GET verificación, POST mensajes)
    cron/             ← Endpoints para tareas programadas y auto-mejora
  integrations/
    telegram/         ← Bot Telegram (grammY)
    google/           ← OAuth2: Drive, Gmail, Sheets, Calendar
    linkedin/         ← OAuth2: publicación con aprobación humana
    email/            ← IMAP (lectura), Nodemailer (envío)
Brain/
  context.md          ← Arquitectura detallada del sistema
  roadmap.md          ← Fases y features planeadas
feature_list.json     ← Fuente de verdad del estado de features
progress/             ← Archivos de tracking por feature en desarrollo
CHECKPOINTS.md        ← Criterios de verificación antes de cerrar una feature
```

---

## Roles

### 🎯 Leader (Orquestador)
**Responsabilidad:** Descomponer la tarea en pasos, asignar trabajo, verificar checkpoints al final.

- Lee `feature_list.json` para entender el estado actual
- Define el plan antes de escribir código
- NO escribe código de producción directamente
- Verifica CHECKPOINTS.md al cerrar una feature
- Actualiza `feature_list.json` cuando una feature cambia de estado

### 🔨 Implementer (Desarrollador)
**Responsabilidad:** Escribir el código. Un feature a la vez.

- Leer `Brain/context.md` antes de tocar código de arquitectura
- Seguir las convenciones del proyecto (ver sección Convenciones)
- Crear el archivo de progreso en `progress/` al iniciar
- Registrar toda tool nueva en `src/tools/index.ts`
- Documentar variables de entorno nuevas en `.env.example`

### 🔍 Reviewer (Verificador)
**Responsabilidad:** Verificar que la implementación cumple los checkpoints.

- Ejecutar C1–C5 de `CHECKPOINTS.md` antes de marcar como done
- Verificar que no hay regresiones en tools existentes
- Confirmar que el Docker build pasaría (al menos `npx tsc --noEmit`)

---

## Flujo de trabajo para una feature nueva

```
1. Leader: marcar feature como "in_progress" en feature_list.json
2. Leader: crear progress/<feature-id>.md con plan
3. Implementer: desarrollar según el plan
4. Implementer: actualizar progress/<feature-id>.md con avances
5. Reviewer: ejecutar checkpoints C1-C5
6. Leader: marcar feature como "done" en feature_list.json
7. Leader: archivar progress/<feature-id>.md (mover a progress/done/)
```

**Regla:** Solo una feature puede estar `in_progress` a la vez.

---

## Cómo agregar una tool nueva

1. Crear `src/tools/<nombre-kebab>.ts`
2. Llamar `registerTool({ name, description, parameters, handler })` dentro del archivo
3. Importar en `src/tools/index.ts` — sin extensión `.js`
4. Si necesita `chatId`, usar `getToolContext()?.chatId` de `tool-context.ts`
5. Si necesita variables de entorno, agregarlas a `.env.example` con comentario
6. Actualizar `feature_list.json` con el estado de la feature correspondiente

### Patrón de una tool

```typescript
import { registerTool } from '../core/dispatcher';
import { getToolContext } from '../core/tool-context';

registerTool({
    name: 'nombre_tool',
    description: 'Descripción clara de cuándo el agente debe usarla.',
    parameters: {
        type: 'object',
        properties: {
            param: { type: 'string', description: '...' },
        },
        required: ['param'],
    },
    handler: async (args) => {
        const chatId = getToolContext()?.chatId;
        // lógica...
        return 'resultado como string';
    },
});
```

---

## Convenciones del proyecto

| Aspecto | Regla |
|---|---|
| **Idioma del código** | Inglés (variables, funciones, archivos) |
| **Respuestas del agente** | Español |
| **Imports** | Sin extensión `.js` (compatibilidad Turbopack) |
| **Errores** | `throw new Error('mensaje descriptivo')` — el dispatcher los captura |
| **Logging** | Usar `logger.info/warn/error` de `core/logger.ts` |
| **Variables de entorno** | Siempre `process.env.VAR?.trim()` — nunca acceso directo |
| **Async** | Todo handler es `async` aunque no use await |
| **Retorno de tools** | Siempre `string` — el agente lo incluye en su respuesta |
| **Supabase client** | Usar `getClient()` lazy (ver `storage.ts` como patrón) |
| **Docker** | Hacer push a `main` → Dokploy hace el build automáticamente |

---

## Reglas de arquitectura

- **No modificar** `core/agent.ts` para añadir lógica de tools — las tools son autónomas
- **No hardcodear** credenciales — siempre via env vars
- **No crear** archivos en la raíz del proyecto sin justificación
- **Las tools** no deben importarse entre sí — usan `core/` como capa compartida
- **El dispatcher** ejecuta tools en secuencia, no en paralelo — diseñar sin asumir concurrencia
- **Memoria**: `saveMessage` y `getHistory` en `core/memory.ts` — nunca acceso directo a Supabase desde tools

---

## Entorno de deploy

| Variable | Valor en producción |
|---|---|
| `WORKSPACE_BASE_DIR` | `/opt/zirox-workspace` |
| `LLM_PROVIDER` | `groq` o `openrouter` |
| `NODE_ENV` | `production` |
| Puerto | `3000` (configurado en Dockerfile) |

El servidor de producción es `server.ts` (no `next start`).
El Dockerfile usa `ARG CACHEBUST` para invalidar la capa de `COPY . .` en cada deploy.
