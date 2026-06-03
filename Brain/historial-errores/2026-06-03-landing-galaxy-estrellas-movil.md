---
title: "2026-06-03 — Landing: estrellitas del hero invisibles en móvil"
tags:
  - error
  - landing
  - webgl
  - galaxy
  - samsung
  - resuelto
fecha: 2026-06-03
proyecto: Landing Zirox
estado: resuelto
severidad: media
---

# Fondo de estrellas (Galaxy) no visible en Samsung

## Síntoma

Al inicio de https://zirox.io no se ven las **estrellitas** del hero en el móvil; en PC sí.

## Entorno

- `HeroLottie.tsx` → `Galaxy.tsx` (OGL / WebGL shader)
- Samsung A54

## Causa raíz

1. Shader con `uniform bool` — **incompatible en muchos Mali** → compilación fallida.
2. WebGL del hero puede fallar o renderizar vacío en móvil.
3. Sin fallback si WebGL no arranca.

## Solución

1. `bool` → `float` en uniforms del fragment shader.
2. **Canvas 2D de estrellas** en `<1024px` (`galaxy-stars-canvas.ts`).
3. Fallback automático si WebGL lanza error o pierde contexto.
4. Opacidad hero móvil `75%` para mejor visibilidad.

## Commits

- `9fdb989` — `fix(hero): estrellas en movil con canvas 2D fallback`

## Prevención

- [ ] No usar `uniform bool` en shaders para móvil
- [ ] Todo efecto WebGL del hero debe tener **fallback 2D**
- [ ] Mismo checklist que ola: probar A54 real
