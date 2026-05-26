#!/usr/bin/env bash
# Verifica NotebookLM dentro del contenedor AgentZirox.
set -euo pipefail

echo "=== Check NotebookLM VPS ==="

echo "[1] Python"
python3 --version || { echo "FAIL: python3 no instalado"; exit 1; }

echo "[2] notebooklm-py"
python3 -c "import notebooklm; print('notebooklm OK')" 2>/dev/null || {
  echo "FAIL: pip install 'notebooklm-py[browser]'"
  exit 1
}

echo "[3] Auth"
HOME_DIR="${NOTEBOOKLM_HOME:-/app/.notebooklm}"
STORAGE="${NOTEBOOKLM_STORAGE_PATH:-$HOME_DIR/profiles/default/storage_state.json}"

if [[ -n "${NOTEBOOKLM_AUTH_JSON:-}" ]]; then
  echo "OK — NOTEBOOKLM_AUTH_JSON definido (${#NOTEBOOKLM_AUTH_JSON} chars)"
elif [[ -f "$STORAGE" ]]; then
  echo "OK — $STORAGE ($(wc -c < "$STORAGE") bytes)"
else
  echo "FAIL — Sin auth. Monta volumen o define NOTEBOOKLM_AUTH_JSON"
  echo "      Esperado: $STORAGE"
  exit 1
fi

echo "[4] Env"
echo "  NOTEBOOKLM_ENABLED=${NOTEBOOKLM_ENABLED:-false}"
echo "  NOTEBOOKLM_HOME=${NOTEBOOKLM_HOME:-<default>}"
echo "  NOTEBOOKLM_STYLE=${NOTEBOOKLM_STYLE:-editorial}"

echo "[5] Script infografia"
SCRIPT="${NOTEBOOKLM_SCRIPT_PATH:-scripts/notebooklm-generate-infographic.py}"
if [[ ! -f "$SCRIPT" ]]; then
  echo "FAIL: no existe $SCRIPT"
  exit 1
fi
echo "OK — $SCRIPT"

echo "[6] Test sesion (listar notebooks, sin generar PNG)"
export NOTEBOOKLM_STORAGE_PATH="$STORAGE"
python3 - <<'PY'
import asyncio
import os
import sys
from pathlib import Path

def storage_path() -> str:
    p = os.environ.get("NOTEBOOKLM_STORAGE_PATH", "").strip()
    if p:
        return p
    home = os.environ.get("NOTEBOOKLM_HOME", "/app/.notebooklm").strip()
    return str(Path(home) / "profiles" / "default" / "storage_state.json")

async def main():
    path = storage_path()
    if not Path(path).is_file():
        print(f"FAIL — no existe {path}", file=sys.stderr)
        sys.exit(1)
    from notebooklm import NotebookLMClient
    try:
        async with NotebookLMClient.from_storage(path) as client:
            nbs = await client.notebooks.list()
            print(f"OK — sesion valida ({path}), {len(nbs)} notebooks")
    except Exception as exc:
        msg = str(exc).lower()
        if "ratelimit" in msg or "rate limit" in msg:
            print(f"WARN — sesion OK pero rate limit al listar: {exc}")
            sys.exit(0)
        print(f"FAIL — auth/sesion: {exc}", file=sys.stderr)
        print("      Renueva: notebooklm login en PC + scp storage_state.json al VPS", file=sys.stderr)
        sys.exit(1)

asyncio.run(main())
PY

echo ""
echo "=== Todo listo. Prueba por Telegram: infografia estilo NotebookLM ==="
