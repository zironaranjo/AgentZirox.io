---
title: "2026-06-03 — Landing: ola rota en Samsung A54"
tags:
  - error
  - landing
  - webgl
  - samsung
  - resuelto
fecha: 2026-06-03
proyecto: Landing Zirox
estado: resuelto
severidad: alta
---

# Ola con fondo blanco e icono de imagen rota (Samsung A54)

## Síntoma

En Samsung A54: sección «Bienvenido al cambio» con **mitad inferior blanca**, icono roto abajo a la izquierda, sin puntos/ola. En PC y emulador DevTools se veía bien.

## Entorno

- Samsung Galaxy A54, Chrome Android
- Producción: https://zirox.io/#cambio
- Componentes: `DottedSurface`, `WelcomeChangeSection`

## Causa raíz

**Segundo contexto WebGL** en la misma página: el hero ya monta `Galaxy` (OGL). La ola usaba **Three.js WebGL** → en GPU Mali falla silenciosamente (canvas transparente/blanco).

## Por qué no se reproducía en PC

Emulador no limita contextos WebGL ni reproduce drivers Mali. El PC tolera varios contextos.

## Solución

1. En móvil/tablet (`≤1023px` o contenedor bajo): **canvas 2D**, no WebGL.
2. Fondo `#09090b` de respaldo en el contenedor.
3. Altura ola: `clamp` + `dvh` en lugar de solo `svh`.

## Commits

- `a551099` — canvas 2D en móvil, fondo oscuro
- `524f69a` — misma malla/cámara Three.js proyectada en 2D

## Prevención

- [ ] **Máximo un WebGL activo** por vista en móvil, o fallback 2D
- [ ] Probar siempre en **dispositivo Android real** antes de dar por cerrado
- [ ] Si hay blanco + icono roto → sospechar WebGL, no caché
