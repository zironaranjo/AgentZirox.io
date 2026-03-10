# 🧠 Ziro - System Architecture & Context

## 1. Project Overview
**Ziro** is a Personal AI Agent designed to operate both as an active Background service (Telegram Bot) and a dynamic Web Application (SaaS interface), built natively on top of Next.js 15.

### Core Identity:
*   **Name:** Ziro
*   **Version:** 1.0.0 (Web + Bot Monolith)
*   **Domain:** `https://ziro.zirox.io`
*   **Aesthetic Theme:** Cybernetic, Neon Purple/Blue (`#8b5cf6` & `#0ea5e9`), Glassmorphism.

---

## 2. Architecture Decisions
**Why Next.js + Custom Server?**
We opted for a **Monolithic Architecture** using Next.js 15 App Router instead of a standalone Express server. This allows us to scale the Web Dashboard infinitely in the future, while `server.js` starts the Telegram Bot in the same process, effectively sharing the same SQLite Memory Database and resources.

### Tech Stack:
*   **Frontend:** Next.js 15.2 (React 19), Tailwind CSS 4, Google Fonts (Outfit).
*   **Backend Interface:** Next.js API Routes (`/api/chat`).
*   **Core Systems:** Node.js Custom Server (`server.js`), TypeScript.
*   **Deployment:** Dokploy (VPS), Nixpacks.

---

## 3. Directory Structure
*   📁 `src/app/` -> Next.js Frontend (Web Interface).
*   📁 `src/core/` -> AI Logic, Persistent Memory (SQLite).
*   📁 `src/integrations/telegram/` -> Telegram Bot listeners.
*   📄 `server.js` -> Custom Bootloader. Starts Bot + Next.js Server.

---

## 4. Current State (March 2026)
*   [x] Deployed successfully on VPS with Dokploy.
*   [x] Telegram bot linked manually inside code.
*   [x] Web interface created with interactive UI (HTML/Tailwind).
*   [x] Migrated architecture from simple Node/Express to Next.js Monolith.
*   [ ] Connect the Web Interface `/api/chat` to the actual LLM (OpenAI/Groq).

---

## 5. Next Steps / Roadmap
1. Hook up the AI Engine to the Web Terminal.
2. Build an Auth System (Clerk or NextAuth) for the private SaaS dashboard.
3. Add memory capabilities so Ziro remembers conversations in both Telegram and Web simultaneously.
