# 🗺️ Ziro — Roadmap hacia un Agente Profesional

> Estado actual: MVP desplegado en `ziro.zirox.io` ✅  
> Objetivo: Agente de IA personal autónomo, escalable y listo para SaaS

---

## 🔴 FASE 1 — Core Funcional (Prioridad ALTA)
> *Sin esto, Ziro no es un agente real*

### ✅ Hecho
- [x] Despliegue en VPS con Dokploy + Docker
- [x] Interfaz web cibernética en Next.js 16
- [x] Bot de Telegram activo
- [x] Memoria persistente con SQLite
- [x] Arquitectura Monolito (Bot + Web en un solo proceso)

### 🔲 Pendiente
- [ ] **Conectar Web Chat al LLM real**  
  Modificar `/api/chat/route.ts` para llamar a `callLLM()` de `src/core/llm.ts`.  
  El chat web ahora mismo responde con texto de prueba.

- [ ] **Memoria compartida Web + Telegram**  
  Usar el mismo `chatId` del usuario en ambas interfaces para que Ziro recuerde la conversación independientemente de por dónde hables.

- [ ] **Historial de chat visible en la web**  
  Cargar el historial de conversaciones desde SQLite al cargar la página web.

- [ ] **Streaming de respuestas**  
  Mostrar las letras de Groq/OpenRouter en tiempo real (efecto de escritura) en vez de esperar a que llegue el texto completo.

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

- [ ] **Notas y knowledge base personal**  
  Ziro guarda notas que tú le dictas y las recuerda para siempre.

- [ ] **Integración con Notion/Obsidian**  
  Crear y editar páginas de Notion o notas de Obsidian directamente desde el chat.

### 🌐 Skills de Integración
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

- [ ] **Modo voz**  
  Hablar con Ziro por micrófono (Whisper para transcripción) y escuchar respuestas (ElevenLabs TTS).

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
| Conectar web chat al LLM | 🔥🔥🔥 | ⚡ Bajo | ⭐⭐⭐⭐⭐ |
| Streaming de respuestas | 🔥🔥🔥 | ⚡ Bajo | ⭐⭐⭐⭐⭐ |
| Historial web | 🔥🔥 | ⚡ Bajo | ⭐⭐⭐⭐ |
| Búsqueda en internet | 🔥🔥🔥 | ⚡ Medio | ⭐⭐⭐⭐ |
| Modo voz | 🔥🔥🔥 | 🔨 Medio | ⭐⭐⭐ |
| Google Calendar | 🔥🔥 | 🔨 Medio | ⭐⭐⭐ |
| Autenticación | 🔥🔥 | 🔨 Medio | ⭐⭐⭐ |
| Memoria semántica RAG | 🔥🔥🔥 | 🏗️ Alto | ⭐⭐⭐ |
| Multi-tenancy SaaS | 🔥🔥🔥 | 🏗️ Alto | ⭐⭐ |
| Stripe pagos | 🔥🔥🔥 | 🏗️ Alto | ⭐⭐ |

---

## 🚀 Recomendación: Por dónde empezar mañana

```
1️⃣  Conectar web chat → Groq (30 min)
2️⃣  Streaming de respuestas (1 hora)
3️⃣  Búsqueda en internet con Tavily (2 horas)
4️⃣  Historial en web (1 hora)
```

Con esos 4 pasos, Ziro pasa de "demo bonita" a **agente de IA real y funcional** que impresiona a cualquiera.
