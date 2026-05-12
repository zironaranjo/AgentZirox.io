# progress/

Archivos de tracking para features en desarrollo activo.

## Estructura

```
progress/
  README.md                  ← este archivo
  <feature-id>.md            ← feature actualmente en desarrollo
  done/
    <feature-id>.md          ← features cerradas y verificadas
```

## Reglas

- Solo puede haber **un archivo** en la raíz de `progress/` (la feature activa)
- Al cerrar una feature (todos los checkpoints ✅), mover su archivo a `done/`
- El archivo de progreso es la fuente de verdad de lo que se hizo y por qué

## Template para un archivo de progreso

```markdown
# Feature: <nombre>
**ID:** <feature-id>
**Estado:** in_progress
**Iniciado:** YYYY-MM-DD

## Plan
1. ...
2. ...

## Implementación
- [ ] Paso 1
- [x] Paso 2 — completado YYYY-MM-DD

## Archivos modificados
- src/tools/<nombre>.ts — nueva tool
- src/tools/index.ts — import añadido
- .env.example — variables nuevas

## Checkpoints
| Checkpoint | Estado | Notas |
|---|---|---|
| C1 — Coherencia de estado | ✅ / ❌ | |
| C2 — TypeScript compila | ✅ / ❌ | |
| C3 — Tool registrada | ✅ / ❌ | |
| C4 — Env vars documentadas | ✅ / ❌ | |
| C5 — Build pasa | ✅ / ❌ | |

## Notas
Decisiones técnicas relevantes, problemas encontrados, etc.
```
