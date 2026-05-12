# CHECKPOINTS.md — AgentZirox.io

> El Reviewer ejecuta estos 5 checkpoints antes de marcar cualquier feature como `done`.
> Un checkpoint fallido bloquea el cierre. No hay excepciones.

---

## C1 — Coherencia de estado

**Objetivo:** `feature_list.json` refleja la realidad del código.

Verificar que:
- [ ] La feature recién implementada tiene `status: "done"` en `feature_list.json`
- [ ] No hay features marcadas como `done` que no existan en el código
- [ ] Si se creó una tool nueva, existe en `src/tools/` y está en `src/tools/index.ts`
- [ ] El archivo `progress/<feature-id>.md` existe y describe lo implementado

**Comando de ayuda:**
```bash
# Listar tools registradas en index.ts
grep "import './" src/tools/index.ts

# Listar archivos en src/tools/
ls src/tools/
```

---

## C2 — TypeScript compila sin errores

**Objetivo:** El código nuevo no rompe la compilación.

Verificar que:
- [ ] `npx tsc --noEmit` termina sin errores
- [ ] No hay `any` implícito donde el tipo es conocido
- [ ] Los tipos de retorno de handlers son compatibles con `string | Promise<string>`

**Comando:**
```bash
npx tsc --noEmit
```

Si hay errores de compilación → bloquear. Corregirlos antes de continuar.

---

## C3 — Tool registrada correctamente

**Objetivo:** Toda tool nueva es accesible por el agente.

Verificar que:
- [ ] El archivo de la tool llama `registerTool()` con `name`, `description`, `parameters` y `handler`
- [ ] `description` explica claramente cuándo el agente debe usarla (en español)
- [ ] El import está en `src/tools/index.ts` sin extensión `.js`
- [ ] Si la tool necesita `chatId`, usa `getToolContext()?.chatId` — no hardcodea IDs
- [ ] Si la tool llama a Supabase, usa el patrón `getClient()` lazy

**Verificación manual:**
Iniciar el agente en dev y pedir `/tools` → la tool nueva debe aparecer en la lista.

---

## C4 — Variables de entorno documentadas

**Objetivo:** Otro desarrollador (o Claude en una sesión nueva) puede configurar el entorno.

Verificar que:
- [ ] Toda variable de entorno nueva está en `.env.example` con un comentario descriptivo
- [ ] El acceso en código es `process.env.VAR?.trim()` — nunca sin trim()
- [ ] Las variables opcionales tienen fallback o guarda con `if (!var) return ...`
- [ ] No hay credenciales hardcodeadas en ningún archivo de código fuente

**Comando:**
```bash
# Buscar posibles credenciales hardcodeadas
grep -r "sk-" src/ --include="*.ts" | grep -v "node_modules"
grep -r "Bearer " src/ --include="*.ts" | grep -v "Authorization.*Bearer.*process.env"
```

---

## C5 — Build de Docker pasa

**Objetivo:** El código es deployable a producción.

Verificar que:
- [ ] `next build` completa sin errores (o el Dockerfile lo haría)
- [ ] No hay imports que rompan el bundler de Next.js (sin `.js` explícito en imports locales)
- [ ] El `Dockerfile` no requiere cambios manuales para el nuevo feature
- [ ] Si se agregaron dependencias npm nuevas, están en `package.json` (no solo instaladas localmente)

**Verificación local:**
```bash
npm run build
```

Si el build falla → no hacer push a `main` hasta resolver.

---

## Tabla de estado de checkpoints

Al revisar una feature, llenar esta tabla en `progress/<feature-id>.md`:

| Checkpoint | Estado | Notas |
|---|---|---|
| C1 — Coherencia de estado | ✅ / ❌ | |
| C2 — TypeScript compila | ✅ / ❌ | |
| C3 — Tool registrada | ✅ / ❌ | N/A si no hay tool nueva |
| C4 — Env vars documentadas | ✅ / ❌ | N/A si no hay vars nuevas |
| C5 — Build pasa | ✅ / ❌ | |

**Todos ✅ → feature se cierra. Cualquier ❌ → feature sigue `in_progress`.**
