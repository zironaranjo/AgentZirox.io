#!/usr/bin/env python3
"""Genera infografía NotebookLM desde JSON en stdin → JSON en stdout (png_base64)."""
from __future__ import annotations

import asyncio
import base64
import json
import os
import sys
import tempfile
from pathlib import Path


def _err(msg: str) -> dict:
    return {"success": False, "error": msg}


def _read_payload() -> dict:
    raw = sys.stdin.read()
    if not raw.strip():
        raise ValueError("stdin vacío")
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("payload debe ser un objeto JSON")
    return data


def _build_instructions(payload: dict) -> str:
    title = str(payload.get("title") or "").strip()
    brief = str(payload.get("brief") or "").strip()
    steps = [str(s).strip() for s in (payload.get("steps") or []) if str(s).strip()]
    benefits = [str(b).strip() for b in (payload.get("benefits") or []) if str(b).strip()]
    custom = str(payload.get("instructions") or "").strip()

    parts: list[str] = []
    if title:
        parts.append(f"Título principal: {title}")
    if brief:
        parts.append(brief)
    if steps:
        parts.append("Pasos clave:\n" + "\n".join(f"- {s}" for s in steps))
    if benefits:
        parts.append("Beneficios:\n" + "\n".join(f"- {b}" for b in benefits))
    if custom:
        parts.append(custom)

    base = "\n\n".join(parts).strip()
    if not base:
        return "Infografía editorial clara en español, estilo profesional tipo NotebookLM."
    return (
        base
        + "\n\nDiseño: infografía editorial de alta calidad, legible, iconos, 2 columnas si aplica."
    )


def _build_source_text(payload: dict) -> str:
    return _build_instructions(payload)


def _map_orientation(value: str):
    from notebooklm.rpc.types import InfographicOrientation

    key = (value or "portrait").lower()
    mapping = {
        "landscape": InfographicOrientation.LANDSCAPE,
        "portrait": InfographicOrientation.PORTRAIT,
        "square": InfographicOrientation.SQUARE,
    }
    return mapping.get(key, InfographicOrientation.PORTRAIT)


def _map_detail(value: str):
    from notebooklm.rpc.types import InfographicDetail

    key = (value or "standard").lower()
    mapping = {
        "concise": InfographicDetail.CONCISE,
        "standard": InfographicDetail.STANDARD,
        "detailed": InfographicDetail.DETAILED,
    }
    return mapping.get(key, InfographicDetail.STANDARD)


def _map_style(value: str | None):
    from notebooklm.rpc.types import InfographicStyle

    if not value:
        return InfographicStyle.EDITORIAL
    key = value.lower().replace("-", "_")
    mapping = {
        "auto": InfographicStyle.AUTO_SELECT,
        "auto_select": InfographicStyle.AUTO_SELECT,
        "sketch": InfographicStyle.SKETCH_NOTE,
        "sketch_note": InfographicStyle.SKETCH_NOTE,
        "professional": InfographicStyle.PROFESSIONAL,
        "pro": InfographicStyle.PROFESSIONAL,
        "bento": InfographicStyle.BENTO_GRID,
        "bento_grid": InfographicStyle.BENTO_GRID,
        "editorial": InfographicStyle.EDITORIAL,
        "instructional": InfographicStyle.INSTRUCTIONAL,
    }
    return mapping.get(key, InfographicStyle.EDITORIAL)


def _is_rate_limit(exc: Exception) -> bool:
    msg = str(exc).lower()
    return (
        "ratelimit" in msg
        or "rate_limit" in msg
        or "rate limit" in msg
        # notebooklm-py swallows RateLimitError and raises this after polling
        or "disappeared from list" in msg
        or "not-found polls" in msg
    )


async def _generate(payload: dict) -> dict:
    try:
        from notebooklm import NotebookLMClient
    except ImportError:
        return _err(
            "notebooklm-py no instalado. Ejecuta: pip install 'notebooklm-py[browser]' "
            "y luego notebooklm login"
        )

    title = str(payload.get("title") or "Infografía AgentZirox").strip()[:120]
    sources = [str(u).strip() for u in (payload.get("sources") or []) if str(u).strip()]
    language = str(payload.get("language") or "es").strip() or "es"
    instructions = _build_instructions(payload)
    timeout = float(payload.get("timeout_sec") or 600)
    orientation = _map_orientation(str(payload.get("orientation") or "portrait"))
    detail = _map_detail(str(payload.get("detail") or "standard"))
    style = _map_style(str(payload.get("style") or os.environ.get("NOTEBOOKLM_STYLE") or "editorial"))

    storage_path = (
        str(payload.get("storage_path") or os.environ.get("NOTEBOOKLM_STORAGE_PATH") or "").strip()
        or None
    )

    max_attempts = 3
    rate_limit_delay = 60.0  # seconds between retries on rate limit

    for attempt in range(1, max_attempts + 1):
        try:
            ctx = (
                NotebookLMClient.from_storage(storage_path)
                if storage_path
                else NotebookLMClient.from_storage()
            )
            async with ctx as client:
                nb = await client.notebooks.create(title)
                nb_id = nb.id

                if sources:
                    for url in sources[:8]:
                        try:
                            await client.sources.add_url(nb_id, url, wait=True, wait_timeout=120.0)
                        except Exception:
                            pass
                else:
                    await client.sources.add_text(
                        nb_id,
                        title[:80] or "Contenido",
                        _build_source_text(payload),
                        wait=True,
                        wait_timeout=90.0,
                    )

                status = await client.artifacts.generate_infographic(
                    nb_id,
                    language=language,
                    instructions=instructions,
                    orientation=orientation,
                    detail_level=detail,
                    style=style,
                )

                final = await client.artifacts.wait_for_completion(
                    nb_id,
                    status.task_id,
                    timeout=timeout,
                )

                if getattr(final, "status", "") == "failed":
                    return _err("NotebookLM falló al generar la infografía")

                with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
                    out_path = tmp.name

                try:
                    await client.artifacts.download_infographic(nb_id, out_path)
                    png_bytes = Path(out_path).read_bytes()
                finally:
                    try:
                        Path(out_path).unlink(missing_ok=True)
                    except OSError:
                        pass

                if not png_bytes:
                    return _err("PNG vacío tras descarga")

                return {
                    "success": True,
                    "notebook_id": nb_id,
                    "task_id": status.task_id,
                    "png_base64": base64.b64encode(png_bytes).decode("ascii"),
                    "bytes": len(png_bytes),
                }

        except Exception as exc:
            if _is_rate_limit(exc) and attempt < max_attempts:
                print(
                    f"[notebooklm] RateLimitError (intento {attempt}/{max_attempts}) — "
                    f"reintentando en {rate_limit_delay:.0f}s…",
                    file=sys.stderr,
                )
                await asyncio.sleep(rate_limit_delay)
                rate_limit_delay = min(rate_limit_delay * 2, 180.0)
                continue
            extra = " (puede ser sesión expirada: ejecuta 'notebooklm login' en el VPS)" if _is_rate_limit(exc) else ""
            return _err(str(exc) + extra)

    return _err("No se pudo generar la infografía tras todos los intentos")


def main() -> None:
    try:
        payload = _read_payload()
    except Exception as exc:
        print(json.dumps(_err(str(exc)), ensure_ascii=False))
        sys.exit(1)

    result = asyncio.run(_generate(payload))
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get("success") else 1)


if __name__ == "__main__":
    main()
