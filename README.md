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

## Workspace operativo (clientes y redes)

Define en `.env`:

```env
WORKSPACE_BASE_DIR=/opt/zirox-workspace
```

Todas las tools de archivos (`create_folder`, `write_file`, `list_files`) quedan restringidas a esa ruta base para evitar accesos fuera del workspace.

Si usas OpenRouter con un modelo que no soporta tools (por ejemplo algunos endpoints de Hermes), puedes separar modelo de chat y modelo para herramientas:

```env
LLM_PROVIDER=openrouter
OPENROUTER_MODEL=nousresearch/hermes-3-llama-3.1-70b
OPENROUTER_TOOLS_MODEL=anthropic/claude-3.5-sonnet
```

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
