---
title: "2026-06-03 — Landing: ola se movía distinto en móvil"
tags:
  - error
  - landing
  - canvas
  - resuelto
fecha: 2026-06-03
proyecto: Landing Zirox
estado: resuelto
severidad: baja
---

# Ola visible en móvil pero animación/perspectiva distinta a desktop

## Síntoma

Tras arreglar WebGL en Samsung, la ola aparecía pero **se movía diferente** (bandas 2D vs rejilla 3D).

## Causa raíz

El fallback 2D usaba **fórmula y rejilla inventadas**, no la misma malla que Three.js (`40×60`, `sin(ix*0.3)+sin(iy*0.5)`).

## Solución

Canvas 2D que **proyecta los mismos 2400 puntos** con `THREE.PerspectiveCamera` (solo math, sin renderer WebGL).

## Commits

- `524f69a` — alinear onda 2D con malla y cámara Three.js

## Prevención

- [ ] Si hay fallback 2D, **reutilizar la misma física/malla**, no aproximar visualmente
- [ ] Documentar qué motor usa cada breakpoint
