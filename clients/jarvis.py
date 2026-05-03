"""
AgenteZirox — Cliente de voz Jarvis
====================================
Mantén pulsado F2 para hablar. Suelta para enviar.
El agente responde en voz.

Instalación (una sola vez):
    pip install groq httpx sounddevice numpy soundfile pynput edge-tts pygame

Variables de entorno (crea un archivo .env junto a este script o defínelas en el sistema):
    GROQ_API_KEY   — tu clave de Groq (para Whisper)
    AGENT_URL      — URL de tu agente, ej: https://ziro.zirox.io/api/chat
    WEB_API_SECRET — mismo valor que en Dokploy (si lo configuraste)
    VOICE          — voz Edge TTS, por defecto es-ES-AlvaroNeural
"""

import asyncio
import os
import sys
import tempfile
import threading
import time
from pathlib import Path

# ── cargar .env si existe ────────────────────────────────────────────────────
_env_path = Path(__file__).parent / '.env'
if _env_path.exists():
    for line in _env_path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, _, v = line.partition('=')
            os.environ.setdefault(k.strip(), v.strip())

# ── configuración ────────────────────────────────────────────────────────────
GROQ_API_KEY  = os.environ.get('GROQ_API_KEY', '')
AGENT_URL     = os.environ.get('AGENT_URL', 'https://ziro.zirox.io/api/chat')
API_SECRET    = os.environ.get('WEB_API_SECRET', '')
VOICE         = os.environ.get('VOICE', 'es-ES-AlvaroNeural')
CHAT_ID       = 'laptop-voice'
SAMPLE_RATE   = 16_000
PUSH_KEY      = 'f2'          # tecla push-to-talk (minúsculas)
MAX_SECS      = 60            # grabación máxima por turno

if not GROQ_API_KEY:
    print('ERROR: define GROQ_API_KEY en .env o en las variables de entorno.')
    sys.exit(1)

# ── importaciones con mensajes de error claros ───────────────────────────────
try:
    import groq as _groq_mod
    import httpx
    import numpy as np
    import sounddevice as sd
    import soundfile as sf
    from pynput import keyboard as pynput_kb
    import pygame
    import edge_tts
except ImportError as e:
    print(f'Falta dependencia: {e}')
    print('Instala con:  pip install groq httpx sounddevice numpy soundfile pynput edge-tts pygame')
    sys.exit(1)

groq_client = _groq_mod.Groq(api_key=GROQ_API_KEY)
pygame.mixer.init()

# ── estado global ────────────────────────────────────────────────────────────
_recording   = False
_audio_chunks: list[np.ndarray] = []
_lock        = threading.Lock()
_busy        = False          # evita solapamiento de turnos

# ── grabación ────────────────────────────────────────────────────────────────

def _audio_callback(indata: np.ndarray, frames, time_info, status):
    if _recording:
        with _lock:
            _audio_chunks.append(indata.copy())


def _start_recording():
    global _recording, _audio_chunks
    with _lock:
        _audio_chunks = []
        _recording = True
    print('\n🎙️  Grabando… (suelta F2 para enviar)')


def _stop_and_process():
    global _recording, _busy
    _recording = False
    time.sleep(0.05)           # deja que el callback termine

    with _lock:
        chunks = list(_audio_chunks)

    if not chunks:
        print('⚠️  Sin audio capturado.')
        return

    audio = np.concatenate(chunks, axis=0).flatten().astype(np.float32)
    duration = len(audio) / SAMPLE_RATE
    if duration < 0.5:
        print('⚠️  Audio demasiado corto.')
        return

    _busy = True
    threading.Thread(target=_process_turn, args=(audio,), daemon=True).start()


# ── transcripción → agente → TTS ─────────────────────────────────────────────

def _process_turn(audio: np.ndarray):
    global _busy
    try:
        # 1. Guardar wav temporal
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
            tmp_wav = f.name
        sf.write(tmp_wav, audio, SAMPLE_RATE)

        # 2. Transcripción con Groq Whisper
        print('📝 Transcribiendo…')
        with open(tmp_wav, 'rb') as audio_file:
            transcription = groq_client.audio.transcriptions.create(
                model='whisper-large-v3-turbo',
                file=audio_file,
                response_format='text',
                language='es',
            )
        os.unlink(tmp_wav)
        text = str(transcription).strip()
        if not text:
            print('⚠️  No se detectó voz.')
            return
        print(f'🗣️  Tú: {text}')

        # 3. Enviar al agente
        print('🤖 Pensando…')
        headers = {'Content-Type': 'application/json'}
        if API_SECRET:
            headers['x-api-secret'] = API_SECRET
        resp = httpx.post(
            AGENT_URL,
            json={'message': text, 'chatId': CHAT_ID},
            headers=headers,
            timeout=60,
        )
        resp.raise_for_status()
        reply = resp.json().get('reply', '')
        if not reply:
            print('⚠️  Respuesta vacía del agente.')
            return
        print(f'🤖 Agente: {reply[:200]}{"…" if len(reply) > 200 else ""}')

        # 4. TTS con Edge
        asyncio.run(_speak(reply))

    except Exception as exc:
        print(f'❌ Error en turno: {exc}')
    finally:
        _busy = False


async def _speak(text: str):
    with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as f:
        tmp_mp3 = f.name
    communicate = edge_tts.Communicate(text, VOICE)
    await communicate.save(tmp_mp3)

    pygame.mixer.music.load(tmp_mp3)
    pygame.mixer.music.play()
    while pygame.mixer.music.get_busy():
        await asyncio.sleep(0.1)
    pygame.mixer.music.unload()
    os.unlink(tmp_mp3)


# ── hotkey push-to-talk ───────────────────────────────────────────────────────

def _on_press(key):
    global _busy
    try:
        k = key.char if hasattr(key, 'char') else key.name
    except AttributeError:
        return
    if k and k.lower() == PUSH_KEY and not _recording and not _busy:
        _start_recording()


def _on_release(key):
    try:
        k = key.char if hasattr(key, 'char') else key.name
    except AttributeError:
        return
    if k and k.lower() == PUSH_KEY and _recording:
        _stop_and_process()


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    print('╔══════════════════════════════════════╗')
    print('║      AgenteZirox — Modo Jarvis       ║')
    print('╠══════════════════════════════════════╣')
    print(f'║  Agente : {AGENT_URL[:38]}')
    print(f'║  Voz    : {VOICE}')
    print(f'║  Hotkey : F2 (mantén pulsado)        ║')
    print('╚══════════════════════════════════════╝')
    print('\nEsperando… (Ctrl+C para salir)\n')

    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype='float32',
                        callback=_audio_callback):
        with pynput_kb.Listener(on_press=_on_press, on_release=_on_release) as listener:
            listener.join()


if __name__ == '__main__':
    main()
