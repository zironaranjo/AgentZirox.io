# 🤖 AgenteZirox.io

Un agente de IA personal, extensible y modular. Se comunica via **Telegram**, puede enviar/leer **emails**, llamar **cualquier API REST**, y expone sus capacidades via **MCP** (Model Context Protocol).

## Stack

| | |
|---|---|
| **LLM** | Groq (Llama 3.3 70B) + OpenRouter (Claude, etc.) + Hermes (endpoint compatible OpenAI) |
| **Telegram** | grammy |
| **Email** | nodemailer (SMTP) + imapflow (IMAP) |
| **MCP** | @modelcontextprotocol/sdk |
| **Memoria** | SQLite (better-sqlite3) |
| **Runtime** | Node.js 20+ / TypeScript |

## Inicio rápido

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# Edita .env con tus credenciales

# 3. Arrancar el agente + bot de Telegram
npm run dev
```

## Comandos de Telegram

| Comando | Descripción |
|---|---|
| `/start` | Bienvenida e instrucciones |
| `/reset` | Borrar historial de conversación |
| `/status` | Estado del agente y modelo activo |
| `/tools` | Ver herramientas disponibles |
| `/provider groq\|openrouter\|hermes` | Cambiar proveedor LLM |

## Herramientas del agente

| Tool | Descripción |
|---|---|
| `send_email` | Enviar email via SMTP |
| `read_inbox` | Leer emails del buzón (IMAP) |
| `call_api` | Llamar cualquier API REST (GET/POST/PUT/DELETE) |
| `web_search` | Buscar en internet (Serper, Tavily o DuckDuckGo; configura `SERPER_API_KEY` o `TAVILY_API_KEY` para mejores resultados) |
| `search_memory` | Buscar en historial de conversación |
| `clear_memory` | Borrar historial de un chat |
| `list_tools` | Listar herramientas disponibles |
| `set_provider` | Cambiar proveedor LLM en tiempo real |
| `create_folder` | Crear carpetas dentro del workspace seguro del VPS |
| `write_file` | Crear/editar archivos de trabajo de clientes y contenidos |
| `append_file` | Agregar seguimiento/tareas sin sobrescribir archivos |
| `read_file` | Leer briefs, tareas y notas guardadas del workspace |
| `list_files` | Listar carpetas y archivos del workspace seguro |
| `create_client_workspace` | Crear estructura base de cliente con plantillas |
| `capture_note` | Captura rapida de ideas/notas en `capturas/*.md` con fecha |
| `remember_about_user` | Guarda nombre preferido y gustos en SQLite; se inyectan en el system prompt en cada mensaje |
| `schedule_task` | Programa una acción futura en este chat (requiere cron en servidor, ver abajo) |
| `list_scheduled_tasks` | Lista tareas pendientes del chat |
| `cancel_scheduled_task` | Cancela una tarea pendiente por id |
| `drive_create_folder` | Crear carpetas en Google Drive con OAuth2 |
| `drive_save_important_emails` | Guardar correos importantes de Gmail en Drive |
| `drive_archive_important_emails` | Crear carpeta + guardar correos importantes en un paso |
| `linkedin_save_draft` | Guardar borrador de LinkedIn (post, titular, Acerca de, etc.) en `linkedin/drafts/*.md` |
| `linkedin_list_drafts` | Listar borradores recientes en el workspace |

## Workspace operativo (clientes y redes)

Define en `.env`:

```env
WORKSPACE_BASE_DIR=/opt/zirox-workspace
```

Todas las tools de archivos (`create_folder`, `write_file`, `list_files`) quedan restringidas a esa ruta base para evitar accesos fuera del workspace.
Para captura rapida de ideas, el agente puede usar `capture_note` y guardar en `capturas/ideas.md`.

Perfil persistente: configura `USER_DISPLAY_NAME` y/o `USER_PROFILE` en el entorno, o deja que el usuario lo diga en el chat; el agente puede usar `remember_about_user` para guardar nombre y preferencias (tabla `metadata` en `agent_memory.db`). `clear_memory` solo borra el historial del chat, no el perfil.

### Tareas programadas (recordatorios)

Sin esto, el agente **no puede** cumplir solo “mañana a las 8” aunque lo prometa: hace falta **persistencia** y que algo **ejecute** las tareas vencidas.

1. `SCHEDULED_TASKS_ENABLED=true`
2. Arranca la app con **`npm start`** / **`tsx server.ts`** (no solo `next start` aislado): el servidor incluye un **ticker interno** que cada **60 s** (configurable) llama a la misma lógica que el cron HTTP. Así no dependes obligatoriamente de Dokploy para las tareas.
3. Opcional: `SCHEDULED_TASKS_INTERNAL_TICKER=false` si quieres **solo** disparos externos.
4. Opcional: `SCHEDULED_TASKS_TICK_MS=60000` (mínimo 15000, máximo 300000).
5. Cron HTTP (redundante o si desactivas el ticker interno): GET/POST a `https://TU_DOMINIO/api/cron/scheduled-tasks` con `Authorization: Bearer` = `CRON_SECRET` o `SELF_IMPROVE_CRON_SECRET`.

Cuando pidas un recordatorio en Telegram, el modelo debe usar **`schedule_task`** (con `run_at_iso` en ISO con offset de España, ej. `2026-04-23T08:00:00+02:00`). Herramientas: `list_scheduled_tasks` / `cancel_scheduled_task`.

### Auto-mejora diaria (cron)

Con `SELF_IMPROVE_ENABLED=true` y `CRON_SECRET` o `SELF_IMPROVE_CRON_SECRET` largo, puedes programar **una petición al día** (GET o POST) a:

`https://TU_DOMINIO/api/cron/self-improve`

Cabecera: `Authorization: Bearer TU_SECRETO` (o `x-cron-secret: TU_SECRETO`).

El job lee mensajes recientes en SQLite, pide al LLM hasta 5 viñetas útiles (preferencias, correcciones, temas recurrentes) y las añade al perfil con prefijo `[auto YYYY-MM-DD]`. Como mucho **una ejecución efectiva por día** (zona `Europe/Madrid`). Si hay poca actividad, marca el día y no llama al modelo. Para forzar otro paso el mismo día, borra la clave `self_improve_last_day` en `metadata` o espera al día siguiente.

Si usas OpenRouter con un modelo que no soporta tools (por ejemplo algunos endpoints de Hermes), puedes separar modelo de chat y modelo para herramientas:

```env
LLM_PROVIDER=openrouter
OPENROUTER_MODEL=nousresearch/hermes-3-llama-3.1-70b
OPENROUTER_TOOLS_MODEL=anthropic/claude-3.5-sonnet
OPENROUTER_VISION_MODEL=openai/gpt-4o-mini
```

## Google Drive + Gmail + Sheets + Calendar

Configura OAuth2 en `.env` (mismas credenciales para todos):

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
GOOGLE_REDIRECT_URI=http://localhost:3000/oauth2callback
GOOGLE_DRIVE_ROOT_FOLDER_ID=
```

### Activar APIs y permisos

En [Google Cloud Console](https://console.cloud.google.com/) del proyecto:

1. **APIs y servicios → Biblioteca**: habilita **Google Sheets API** y **Google Calendar API** (además de Drive/Gmail si ya los usas).
2. **Pantalla de consentimiento OAuth**: añade los ámbitos (scopes):
   - `https://www.googleapis.com/auth/spreadsheets` — crear hojas y leer/escribir celdas (obligatorio para las tools de Sheets).
   - `https://www.googleapis.com/auth/calendar.events` — listar/crear eventos.
   - `https://www.googleapis.com/auth/drive.file` — **solo si** usas `parent_folder_id` en `google_sheets_create`, o `GOOGLE_DRIVE_ROOT_FOLDER_ID`, o tools que crean carpetas/archivos en Drive (mover la hoja a una carpeta concreta).
   - (Los de Gmail si archivas correos, p. ej. `gmail.readonly` / `gmail.modify` según tu flujo.)
3. **Vuelve a generar un `GOOGLE_REFRESH_TOKEN`** con todos esos scopes (OAuth 2.0 Playground, script o flujo local). El token antiguo **no** incluye permisos nuevos hasta que reautorices. Si ves `Request had insufficient authentication scopes`, casi siempre falta reautorizar tras añadir un scope o falta `spreadsheets` / `drive.file` según el caso.

**Nota:** La creación de un Spreadsheet **sin** carpeta padre usa la API de Sheets; no hace falta scope de Drive solo por crear la hoja (aparecerá en tu Drive por defecto).

### Herramientas del agente

| Tool | Uso |
|------|-----|
| `google_sheets_quick_note` | Crear Spreadsheet y guardar una nota en texto libre (lo más simple para el usuario) |
| `google_sheets_create` | Crear un Spreadsheet nuevo (titulo; opcional carpeta Drive) |
| `google_sheets_read` | Leer rango A1 de un spreadsheet (ID en la URL) |
| `google_sheets_write` | Escribir filas (JSON de arrays) |
| `google_calendar_list_events` | Eventos entre `time_min_iso` y `time_max_iso` |
| `google_calendar_create_event` | Crear evento con título e inicio/fin ISO |

## MCP Server

```bash
# Arrancar solo el servidor MCP (para Claude Desktop u otros clientes)
npm run mcp
```

Configurar en Claude Desktop (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "agentezirox": {
      "command": "node",
      "args": ["C:/Users/ziron/OneDrive/Documentos/ANTIGRAVITY/AgenteZirox.io/dist/mcp/server.js"]
    }
  }
}
```

## Estructura

```
src/
├── core/           # Motor del agente (LLM, memoria, dispatcher)
├── integrations/   # Telegram, Email
├── mcp/            # Servidor MCP
├── tools/          # Herramientas registradas
└── index.ts        # Punto de entrada
```

## Añadir nuevas herramientas

Crea un archivo en `src/tools/mi-herramienta.ts`:

```typescript
import { registerTool } from '../core/dispatcher.js';

registerTool({
  name: 'my_tool',
  description: 'What this tool does',
  parameters: {
    type: 'object',
    properties: {
      input: { type: 'string', description: 'Input param' },
    },
    required: ['input'],
  },
  handler: async (args) => {
    const { input } = args as { input: string };
    // ... do work ...
    return `Result: ${input}`;
  },
});
```

Luego impórtalo en `src/tools/index.ts`. ¡Listo!
