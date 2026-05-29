# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (local, no build)
npm run dev           # Starts Next.js + Telegram bot via tsx server.ts

# Production build (what Docker runs)
npm run build         # Next.js build only
npx tsc --noEmit      # TypeScript check — always run before committing

# TypeScript compilation for server (done in Dockerfile)
# tsup compiles server.ts + all src/ to dist-server/ (ESM)
```

There are no test scripts. Validate changes by running `npx tsc --noEmit` and deploying to Dokploy.

---

## Architecture

This is a **Next.js monolith** that serves two things simultaneously from one process:

1. **Next.js app** (`src/app/`) — the web UI at `ziro.zirox.io`
2. **AI agent runtime** — Telegram bot + `/api/chat` endpoint, sharing the same process

`server.ts` is the entry point: it starts Next.js, then fires the Telegram bot as a background task (fire-and-forget, never awaited).

### Agent flow

```
User message (Telegram / web / WhatsApp)
  → src/core/agent.ts  processMessage()
      → routeIntent()         # keyword-based fast dispatch (no LLM)
      → classifyDomain()      # limits tool set exposed to LLM
      → callLLM()             # OpenRouter / Groq / Hermes
      → executeTool()         # dispatcher with timeout + retry
      → hallucination check   # detects ACTION_PHRASES without tool calls → force retry
      → repeat until no tool_calls
```

### Core modules

| File | Purpose |
|------|---------|
| `src/core/agent.ts` | Main loop, hallucination detection, `STOP_AFTER_TOOLS`, `DIRECT_RESULT_TOOLS` |
| `src/core/dispatcher.ts` | Tool registry (`registerTool`), timeout, retry |
| `src/core/llm.ts` | LLM abstraction (OpenRouter/Groq/Hermes), system prompt builder |
| `src/core/domain-router.ts` | Domain classification → limits tools shown to LLM |
| `src/core/intent-router.ts` | Deterministic fast-path: image save/list, audio, pending tasks |
| `src/core/memory.ts` | Dual-backend: SQLite (local) + Supabase (production), semantic search |
| `src/core/storage.ts` | Supabase Storage uploads (images, audio, video, PDF) → `whatsapp-media` bucket |

### Adding a new tool

1. Create `src/tools/my-tool.ts` with `registerTool({ name, description, parameters, handler })`
2. Add `import './my-tool'` to `src/tools/index.ts`
3. Add tool name to the appropriate domain in `src/core/domain-router.ts`
4. Add `src/tools/my-tool.ts` to the `tsup` entry list in `Dockerfile`
5. If the tool should stop the agent loop immediately after executing, add its name to `STOP_AFTER_TOOLS` in `agent.ts`

### LLM providers

Controlled by `LLM_PROVIDER` env var (`groq` | `openrouter` | `hermes`).
- Chat model: `OPENROUTER_MODEL` (currently `anthropic/claude-sonnet-4-6`)
- Tool calls model: `OPENROUTER_TOOLS_MODEL` (currently `anthropic/claude-sonnet-4-6`)
- Vision: `OPENROUTER_VISION_MODEL` (currently `openai/gpt-4o-mini`)

### Memory

Dual-backend: SQLite (`agent_memory.db`) locally, Supabase in production. Controlled by `MEMORY_BACKEND=sqlite|supabase`. Semantic search uses embeddings (`OPENAI_API_KEY` or `GROQ_API_KEY`).

---

## Docker Build — Critical Rules

The Dockerfile has **two build steps**:

1. `npm run build` — Next.js (webpack). Native binaries must be in `serverExternalPackages` (`next.config.ts`)
2. `npx tsup ...` — Server bundle. Native binaries must be in `--external` flags

**Remotion rule**: `@remotion/renderer`, `@remotion/bundler` and all `@remotion/compositor-*` packages must appear in BOTH:
- `next.config.ts` → `serverExternalPackages` array
- `Dockerfile` → `--external` flags in the tsup command

Failing to do either causes `Module not found: Can't resolve '@remotion/compositor-linux-arm64-musl'` at build time.

**Playwright rule**: `playwright`, `playwright-core`, `chromium-bidi` are also `--external` in tsup.

**Cache busting**: Dokploy Build Args → `CACHEBUST=<timestamp>` to force rebuild after source changes.

---

## Channels & Routing

- **Telegram**: grammY bot, handles text/voice/photo/commands. Voice is transcribed via Groq Whisper before reaching `processMessage`.
- **Web** (`/api/chat`): Next.js API route. Auth via `WEB_API_SECRET` header. Trusted origins: `triadak.io`.
- **WhatsApp** (`/api/whatsapp/webhook`): Meta Cloud API webhook, bidirectional.

`chatId` format:
- Telegram numeric ID → `"1234567890"`
- WhatsApp personal → `"wa_34612345678"`
- WhatsApp group → `"wa_group_<id>"`
- Web → custom string or empty

---

## Video Pipeline

- **`create_short_video`** — full video with TTS voice + subtitles + Veo/KenBurns clips. Uses Kie.ai Veo for generation then polls for result.
- **`create_tiktok_text_video`** — text-only animated Remotion video (1080×1920). No external AI.
- **`create_linkedin_video`** — text-only animated Remotion video (1080×1080). No external AI.
- **`generate_video`** — single raw Kie.ai Veo clip (no TTS/subtitles).

Remotion renders via `src/lib/remotion-render.ts` which caches the webpack bundle in memory (first render ~20-30s, subsequent ~1-2 min). Chrome auto-detected via `playwright-core`.

TikTok posts go through a pending queue (`insertPending` → `/tt_approve ID`).
LinkedIn posts go through a pending queue (`linkedin_propose_post` → `/li_approve ID`).

---

## Marketing Audit

`run_marketing_audit` fetches a URL, runs 5 parallel Claude calls (copy, SEO, conversion, brand, strategy), aggregates weighted scores, returns Markdown. With `format=pdf` generates a PDF via `scripts/marketing_pdf.py` (requires `reportlab`, installed in Docker).

---

## Known Issues & Fixes

| Problem | Fix |
|---------|-----|
| `Module not found: @remotion/compositor-linux-arm64-musl` | Add to `serverExternalPackages` in `next.config.ts` AND `--external` in Dockerfile tsup |
| `Module not found: @remotion/compositor-win32-x64-msvc` | Same as above |
| Tool causes infinite re-schedule | Add to `STOP_AFTER_TOOLS` and `SCHEDULED_EXEC_EXCLUDED_TOOLS` in `agent.ts` |
| LLM describes action without calling tool | Add detection phrase to `ACTION_PHRASES` in `agent.ts` |
| Tool result gets rewritten by LLM (loses IDs/URLs) | Add tool name to `DIRECT_RESULT_TOOLS` in `agent.ts` |
| New tool not reachable from Telegram | Check domain in `domain-router.ts` — may need new domain or add to `general` |

---

## Deployment

Hosted on VPS via Dokploy (Docker). Production URL: `https://ziro.zirox.io`.

All secrets are Dokploy env vars — never in code or `.env` committed to git. Key vars: `TELEGRAM_BOT_TOKEN`, `OPENROUTER_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WEB_API_SECRET`.
