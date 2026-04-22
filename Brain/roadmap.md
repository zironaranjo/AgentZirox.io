# 🗺️ Ziro — Roadmap hacia un Agente Profesional

> Estado actual: Agente operativo en Telegram + Web, con workspace, voz e imagen ✅  
> Objetivo: Sistema autónomo para productividad, clientes y operaciones de contenido

---

## 🔴 FASE 1 — Core Funcional (Prioridad ALTA)
> *Sin esto, Ziro no es un agente real*

### ✅ Hecho
- [x] Despliegue en VPS con Dokploy + Docker
- [x] Interfaz web cibernética en Next.js 16
- [x] Bot de Telegram activo
- [x] Memoria persistente con SQLite
- [x] Arquitectura Monolito (Bot + Web en un solo proceso)
- [x] Routing OpenRouter híbrido (chat model + tools model)
- [x] Workspace seguro en VPS (`WORKSPACE_BASE_DIR`)
- [x] Tools de archivos para operaciones de clientes
- [x] Captura rápida de ideas (`capture_note`)
- [x] Soporte de notas de voz/audio Telegram con transcripción
- [x] Soporte de imagen Telegram (analisis con OpenRouter Vision)
- [x] Tools Google Drive/Gmail para crear carpeta y archivar correos
- [x] Fallback anti-error Markdown en Telegram para mensajes dinamicos
- [x] Respuesta final del agente basada en resultado real de tools (no solo "Hecho")

### 🔲 Pendiente
- [ ] **Paridad completa Web + Telegram**  
  Asegurar que la web usa exactamente el mismo flujo de tools, memoria y respuestas que Telegram.

- [ ] **Memoria compartida Web + Telegram**  
  Unificar identidad de sesión para continuidad entre dispositivos/canales.

- [ ] **Historial de chat visible en la web**  
  Cargar y navegar historial desde SQLite con UX tipo inbox.

- [ ] **Streaming de respuestas**  
  Respuestas en tiempo real en UI web para reducir latencia percibida.

---

## 🟠 FASE 2 — Skills del Agente (Capacidades Profesionales)
> *Lo que distingue a un chatbot de un verdadero agente*

### 🧠 Skills de Inteligencia
- [ ] **Búsqueda en internet en tiempo real**  
  Integrar Tavily API o Serper.dev para que Ziro pueda buscar información actualizada.

- [ ] **Lectura y resumen de URLs/PDFs**  
  Dar a Ziro la capacidad de leer un enlace o documento y resumirlo.

- [ ] **Memoria semántica (RAG)**  
  Usar embeddings + búsqueda vectorial (pgvector o Chroma) para que Ziro recuerde conceptos importantes a largo plazo, no solo el historial reciente.

- [ ] **Ejecución de código**  
  Permitir a Ziro escribir y ejecutar código Python/JavaScript en una sandbox segura para cálculos, análisis de datos, etc.

### 📅 Skills de Productividad
- [ ] **Google Calendar**  
  Leer y crear eventos del calendario desde el chat.

- [ ] **Recordatorios y tareas**  
  Sistema de tareas pendientes con notificaciones vía Telegram.

- [ ] **Knowledge base personal persistente**  
  Consolidar capturas (`capturas/*.md`) con búsqueda semántica y etiquetas automáticas.

- [ ] **Integración con Notion/Obsidian**  
  Crear y editar páginas de Notion o notas de Obsidian directamente desde el chat.

### 🌐 Skills de Integración
- [ ] **Google Drive + Gmail API (hardening de permisos OAuth)**  
  Estabilizar autorizacion en produccion para archivado de correos sin errores intermitentes.

- [ ] **Instagram DM Inbox**  
  Captura de ideas/tareas desde Instagram y sincronización al workspace.
- [ ] **Webhooks entrantes**  
  Recibir eventos de servicios externos (GitHub, Stripe, cualquier API) y procesarlos con IA.

- [ ] **Twitter/X automation**  
  Ziro puede redactar y publicar tweets o responder a menciones.

- [ ] **WhatsApp** (via Whapi o similar)  
  Añadir WhatsApp como canal adicional además de Telegram.

---

## 🟡 FASE 3 — Interfaz Web Profesional
> *De chat simple a dashboard de poder*

- [ ] **Autenticación** (Clerk o NextAuth)  
  Login con Google/GitHub para proteger el acceso privado.

- [ ] **Dashboard de conversaciones**  
  Panel para ver el historial de todos los chats (web y Telegram).

- [ ] **Panel de configuración**  
  Cambiar el modelo LLM, prompt del sistema, herramientas activas, desde la UI sin tocar código.

- [ ] **Modo voz web (input + output)**  
  Captura por micrófono en web y respuesta con TTS opcional.

- [ ] **Notificaciones proactivas**  
  Ziro puede enviarte mensajes sin que tú preguntes (alertas, resúmenes diarios, etc.)

---

## 🟢 FASE 4 — SaaS (Escalar a múltiples usuarios)
> *Cuando quieras que otros usen su propio Ziro*

- [ ] **Multi-tenancy**  
  Cada usuario tiene su propio agente aislado con su propia memoria y configuración.

- [ ] **Planes de pago** (Stripe)  
  Free / Pro / Enterprise con límites de uso y funcionalidades.

- [ ] **Sub-agentes y equipos**  
  Un agente principal (Ziro) que coordina agentes especializados (investigador, redactor, coder...).

- [ ] **API pública**  
  Exponer Ziro como API para que otros sistemas puedan usarlo.

- [ ] **Marketplace de Skills**  
  Los usuarios pueden activar/desactivar skills como plugins.

---

## 📊 Vista Rápida por Impacto vs Esfuerzo

| Tarea | Impacto | Esfuerzo | Prioridad |
|---|---|---|---|
| Paridad Web + Telegram | 🔥🔥🔥 | ⚡ Bajo | ⭐⭐⭐⭐⭐ |
| Streaming de respuestas web | 🔥🔥🔥 | ⚡ Bajo | ⭐⭐⭐⭐⭐ |
| Drive + Gmail OAuth hardening | 🔥🔥🔥 | 🔨 Medio | ⭐⭐⭐⭐ |
| Historial web | 🔥🔥 | ⚡ Bajo | ⭐⭐⭐⭐ |
| Instagram inbox | 🔥🔥🔥 | 🏗️ Alto | ⭐⭐⭐ |
| Knowledge base semántica | 🔥🔥🔥 | 🏗️ Alto | ⭐⭐⭐ |
| Autenticación | 🔥🔥 | 🔨 Medio | ⭐⭐⭐ |
| Multi-tenancy SaaS | 🔥🔥🔥 | 🏗️ Alto | ⭐⭐ |
| Stripe pagos | 🔥🔥🔥 | 🏗️ Alto | ⭐⭐ |

---

## 🚀 Recomendación: Por dónde empezar mañana

```
1️⃣  Paridad Web + Telegram (mismo pipeline de tools)  
2️⃣  Streaming de respuestas en web  
3️⃣  Hardening OAuth de Drive + Gmail y pruebas end-to-end de archivado  
4️⃣  Vista de historial y capturas en dashboard
```

Con esos 4 pasos, Ziro pasa de "demo bonita" a **agente de IA real y funcional** que impresiona a cualquiera.
