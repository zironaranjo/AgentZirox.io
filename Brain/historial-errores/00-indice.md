---
title: "Historial de errores y resoluciones"
aliases:
  - errores
  - postmortem
  - lecciones aprendidas
tags:
  - error
  - indice
  - moc
---

# Historial de errores y resoluciones

> Registro para **no repetir** los mismos fallos. Cada entrada = síntoma → causa → solución → prevención.

## Cómo usar

1. Cuando algo falle en prod o solo en móvil, copia [[plantilla]].
2. Nombra el archivo: `YYYY-MM-DD-proyecto-resumen.md`
3. Añade una línea en la tabla de abajo.
4. Duplica o enlaza la nota en Obsidian: [[AgentZirox - Historial errores]]

## Índice

| Fecha | Proyecto | Error | Estado | Nota |
|-------|----------|-------|--------|------|
| 2026-06-03 | Landing | Breakpoint tablet: layout cambiaba a 768px | Resuelto | [[2026-06-03-landing-breakpoint-tablet]] |
| 2026-06-03 | Landing | Ola WebGL rota en Samsung (blanco + icono) | Resuelto | [[2026-06-03-landing-webgl-ola-samsung]] |
| 2026-06-03 | Landing | Ola móvil: movimiento/perspectiva distinta a desktop | Resuelto | [[2026-06-03-landing-ola-perspectiva-movil]] |
| 2026-06-03 | Landing | Estrellitas hero invisibles en Samsung | Resuelto | [[2026-06-03-landing-galaxy-estrellas-movil]] |
| 2026-06-03 | Landing | Build Docker: Galaxy.tsx ref null TS | Resuelto | [[2026-06-03-landing-build-galaxy-typescript]] |

## Reglas en criollo (móvil Samsung)

### Qué pasaba

La landing usa **dos efectos con WebGL** (gráficos 3D en el navegador):

1. **Estrellitas** del inicio (`Galaxy`)
2. **Ola de puntos** (`Three.js`)

En **PC** el navegador aguanta varios a la vez. En muchos **Samsung** (GPU Mali), el **segundo suele romperse** → blanco, sin puntos, icono roto.

Por eso en el emulador del PC se veía bien y en el **A54 no**.

### La regla

> **En móvil, como mucho un WebGL “grande” por pantalla.**  
> Si hace falta otro efecto parecido → **canvas 2D** (más compatible).

| Parte | Móvil (<1024px) | PC (≥1024px) |
|-------|-----------------|--------------|
| Estrellitas | Canvas 2D | WebGL (Galaxy) |
| Ola | Canvas 2D | WebGL (Three.js) |

Misma idea visual; **motor distinto** en móvil para que no falle.

### DevTools no basta

Probar en Chrome del PC con “modo móvil” **no sustituye** un **móvil real** (A54, etc.). Siempre revisar en el teléfono antes de dar por cerrado.

---

## Patrones recurrentes

> [!warning] WebGL en Samsung / Mali
> - DevTools móvil **≠** dispositivo real.
> - Evitar **2º contexto WebGL** en la misma página (Galaxy + Three.js).
> - Preferir **canvas 2D** en `<1024px` con la misma lógica matemática.
> - Shaders: evitar `uniform bool` → usar `float` (0/1).

> [!tip] Deploy landing
> - Tras cambios de UI: redeploy Dokploy `landingzirox-onhqko`, clean cache si hay dudas.
> - En móvil: borrar datos del sitio o incógnito (HTML cache largo).

## Plantilla

[[plantilla]]
