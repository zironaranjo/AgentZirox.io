---
title: "2026-06-03 — Landing: build Docker falla en Galaxy.tsx"
tags:
  - error
  - landing
  - typescript
  - deploy
  - resuelto
fecha: 2026-06-03
proyecto: Landing Zirox
estado: resuelto
severidad: alta
---

# `npm run build` falla en Docker (Galaxy.tsx:267)

## Síntoma

Deploy Dokploy: `RUN npm run build` exit code 1. TypeScript: `'ctn' is possibly 'null'` en `Galaxy.tsx` línea 267 (`resize` dentro de `mountWebGL`).

## Causa raíz

TypeScript **no mantiene el narrowing** de `ref.current` dentro de closures anidadas (`function resize()`). En dev a veces pasa; en build CI es error estricto.

## Solución

Tras comprobar el ref, copiar a constante tipada:

```typescript
const node = containerRef.current;
if (!node) return;
const host: HTMLDivElement = node;
// usar `host` en mountWebGL, resize, listeners…
```

## Prevención

- [ ] Tras refactor de `useEffect` con WebGL, ejecutar **`npm run build`** local antes de push
- [ ] No usar `ref.current` directamente en funciones anidadas; usar `const host: HTMLDivElement`

## Commits

- (fix build) — `fix(galaxy): TypeScript host ref en closures`
