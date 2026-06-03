---
title: "2026-06-03 — Landing: layout cambiaba demasiado pronto en tablet"
tags:
  - error
  - landing
  - responsive
  - resuelto
fecha: 2026-06-03
proyecto: Landing Zirox
estado: resuelto
severidad: media
---

# Layout «Bienvenido al cambio» saltaba a los 768px

## Síntoma

A ~783px se veía bien (texto sobre fondo 3D). Al bajar a ~403px el layout cambiaba a columna (texto arriba, ola abajo). Transición brusca e inconsistente.

## Entorno

- DevTools responsive vs tablet real
- Repo: `zironaranjo/Zirox` — `WelcomeChangeSection.tsx`

## Causa raíz

Breakpoint Tailwind `md` (768px) activaba layout desktop (Three.js pantalla completa) en viewports que aún son demasiado estrechos para ese diseño.

## Por qué confundía

En PC al probar 783px parecía «desktop roto»; en móvil parecía «el arreglo». El problema era el **corte a 768px**, no la caché.

## Solución

Pasar el layout compacto (columna) hasta **`lg` (1024px)**. Desktop 3D solo ≥1024px.

## Commits

- `4f939aa` — `fix(cambio): layout compacto hasta lg (1024px)`

## Prevención

- [ ] Probar **783px y 360px** en DevTools tras cambios de breakpoint
- [ ] No usar `md` para layouts que necesitan mucho ancho horizontal
