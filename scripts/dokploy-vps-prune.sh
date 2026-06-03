#!/usr/bin/env bash
# Limpieza segura de Docker en VPS con Dokploy.
# Uso:
#   ./dokploy-vps-prune.sh           # solo muestra qué haría
#   ./dokploy-vps-prune.sh --apply   # ejecuta limpieza conservadora
#
# NO borra volúmenes nombrados ni para contenedores en ejecución.

set -euo pipefail

APPLY=false
if [[ "${1:-}" == "--apply" ]]; then
  APPLY=true
fi

echo "=== Disco ==="
df -h / 2>/dev/null || df -h .

echo ""
echo "=== Docker (antes) ==="
docker system df 2>/dev/null || { echo "docker no disponible"; exit 1; }

echo ""
echo "=== Contenedores en ejecución (no se tocan) ==="
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"

prune_cmds() {
  echo ""
  echo ">> Contenedores parados"
  if $APPLY; then docker container prune -f; else docker container prune -f --dry-run 2>/dev/null || echo "  (dry-run: docker container prune -f)"; fi

  echo ">> Redes no usadas"
  if $APPLY; then docker network prune -f; else echo "  (dry-run: docker network prune -f)"; fi

  echo ">> Imágenes dangling (<none>)"
  if $APPLY; then docker image prune -f; else docker image prune -f --dry-run 2>/dev/null || echo "  (dry-run: docker image prune -f)"; fi

  echo ">> Build cache (builder prune)"
  if $APPLY; then docker builder prune -f --filter "until=168h" 2>/dev/null || docker builder prune -f; else echo "  (dry-run: docker builder prune -f --filter until=168h)"; fi
}

if $APPLY; then
  echo ""
  echo "=== Aplicando limpieza conservadora ==="
  prune_cmds
  echo ""
  echo "=== Docker (después) ==="
  docker system df
  echo ""
  echo "Listo. Si necesitas más espacio: docker image prune -a -f (revisar imágenes no usadas)."
else
  echo ""
  echo "=== Modo simulación ==="
  echo "Se ejecutaría:"
  echo "  - docker container prune -f"
  echo "  - docker network prune -f"
  echo "  - docker image prune -f"
  echo "  - docker builder prune -f (cache > 7 días)"
  echo ""
  echo "Para aplicar: $0 --apply"
fi
