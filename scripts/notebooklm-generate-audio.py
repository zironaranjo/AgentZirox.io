#!/usr/bin/env python3
"""Genera Audio Overview NotebookLM desde JSON en stdin → JSON en stdout (audio_base64)."""
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


def _build_source_text(payload: dict) -> str:
    title = str(payload.get("title") or "").strip()
    brief = str(payload.get("brief") or "").strip()
    topics = [str(t).strip() for t in (payload.get("topics") or []) if str(t).strip()]
    custom = str(payload.get("instructions") or "").strip()

    parts: list[str] = []
    if title:
        parts.append(f"Tema: {title}")
    if brief:
        parts.append(brief)
    if topics:
        parts.append("Puntos clave:\n" + "\n".join(f"- {t}" for t in topics))
    if custom:
        parts.append(custom)

    base = "\n\n".join(parts).strip()
    if not base:
        return "Resumen en audio claro en español, estilo podcast educativo NotebookLM."
    return base


def _resolve_storage_path(payload: dict) -> str | None:
    explicit = (
        str(payload.get("storage_path") or os.environ.get("NOTEBOOKLM_STORAGE_PATH") or "").strip()
    )
    if explicit:
        return explicit
    home = os.environ.get("NOTEBOOKLM_HOME", "").strip()
    if home:
        return str(Path(home) / "profiles" / "default" / "storage_state.json")
    return None


def _is_rate_limit(exc: Exception) -> bool:
    msg = str(exc).lower()
    return (
        "ratelimit" in msg
        or "rate_limit" in msg
        or "rate limit" in msg
        or "disappeared from list" in msg
        or "not-found polls" in msg
    )


def _is_auth_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return any(
        k in msg
        for k in (
            "auth",
            "login",
            "unauthorized",
            "forbidden",
            "not logged",
            "session",
            "csrf",
            "cookie",
            "storage_state",
        )
    ) and not _is_rate_limit(exc)


def _map_audio_format(value: str):
    from notebooklm.rpc.types import AudioFormat

    key = (value or "deep_dive").lower().replace("-", "_")
    mapping = {
        "deep_dive": AudioFormat.DEEP_DIVE,
        "deep": AudioFormat.DEEP_DIVE,
        "brief": AudioFormat.BRIEF,
        "critique": AudioFormat.CRITIQUE,
        "debate": AudioFormat.DEBATE,
    }
    return mapping.get(key, AudioFormat.DEEP_DIVE)


def _map_audio_length(value: str):
    from notebooklm.rpc.types import AudioLength

    key = (value or "default").lower()
    mapping = {
        "short": AudioLength.SHORT,
        "default": AudioLength.DEFAULT,
        "long": AudioLength.LONG,
    }
    return mapping.get(key, AudioLength.DEFAULT)


async def _generate(payload: dict) -> dict:
    try:
        from notebooklm import NotebookLMClient
    except ImportError:
        return _err(
            "notebooklm-py no instalado. Ejecuta: pip install 'notebooklm-py[browser]' "
            "y luego notebooklm login"
        )

    title = str(payload.get("title") or "Audio Overview AgentZirox").strip()[:120]
    sources = [str(u).strip() for u in (payload.get("sources") or []) if str(u).strip()]
    language = str(payload.get("language") or "es").strip() or "es"
    instructions = str(payload.get("instructions") or "").strip() or (
        "Podcast en español, tono claro y educativo, estilo Audio Overview de NotebookLM."
    )
    timeout = float(payload.get("timeout_sec") or 900)
    audio_format = _map_audio_format(str(payload.get("audio_format") or "deep_dive"))
    audio_length = _map_audio_length(str(payload.get("audio_length") or "default"))

    storage_path = _resolve_storage_path(payload)
    if storage_path and not Path(storage_path).is_file():
        return _err(
            f"Auth no encontrada en {storage_path}. "
            "Vuelve a ejecutar notebooklm login y copia storage_state.json al VPS."
        )

    max_attempts = 2
    rate_limit_delay = 90.0

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

                await client.sources.add_text(
                    nb_id,
                    title[:80] or "Contenido",
                    _build_source_text(payload),
                    wait=True,
                    wait_timeout=90.0,
                )
                for url in sources[:8]:
                    try:
                        await client.sources.add_url(nb_id, url, wait=True, wait_timeout=120.0)
                    except Exception:
                        pass

                status = await client.artifacts.generate_audio(
                    nb_id,
                    instructions=instructions,
                    audio_format=audio_format,
                    audio_length=audio_length,
                    language=language,
                )

                final = await client.artifacts.wait_for_completion(
                    nb_id,
                    status.task_id,
                    timeout=timeout,
                )

                if getattr(final, "status", "") == "failed":
                    return _err("NotebookLM falló al generar el audio")

                suffix = ".mp3"
                with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                    out_path = tmp.name

                try:
                    saved = await client.artifacts.download_audio(nb_id, out_path)
                    file_path = Path(saved or out_path)
                    audio_bytes = file_path.read_bytes()
                    ext = file_path.suffix.lower()
                finally:
                    try:
                        Path(out_path).unlink(missing_ok=True)
                    except OSError:
                        pass

                if not audio_bytes:
                    return _err("Audio vacío tras descarga")

                mime = "audio/mpeg" if ext in (".mp3", ".mpeg") else "audio/mp4"
                if len(audio_bytes) > 14_000_000:
                    return _err(f"Audio demasiado grande ({len(audio_bytes)} bytes) para Telegram")

                return {
                    "success": True,
                    "notebook_id": nb_id,
                    "task_id": status.task_id,
                    "audio_base64": base64.b64encode(audio_bytes).decode("ascii"),
                    "mime_type": mime,
                    "bytes": len(audio_bytes),
                }

        except Exception as exc:
            if _is_rate_limit(exc) and attempt < max_attempts:
                print(
                    f"[notebooklm] RateLimitError audio (intento {attempt}/{max_attempts}) — "
                    f"reintentando en {rate_limit_delay:.0f}s…",
                    file=sys.stderr,
                )
                await asyncio.sleep(rate_limit_delay)
                rate_limit_delay = min(rate_limit_delay * 2, 240.0)
                continue
            if _is_auth_error(exc):
                return _err(
                    str(exc)
                    + " — Sesión Google expirada. En tu PC: scripts/setup-notebooklm-auth.ps1 "
                    "y vuelve a copiar storage_state.json al VPS."
                )
            if _is_rate_limit(exc):
                return _err(
                    str(exc)
                    + " — Cuota diaria de audio NotebookLM agotada. "
                    "Prueba en notebooklm.google.com o espera al reset."
                )
            return _err(str(exc))

    return _err("No se pudo generar el audio tras todos los intentos")


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
