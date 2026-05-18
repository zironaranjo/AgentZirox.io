#!/usr/bin/env python3
"""
Jarvis — Asistente de voz local para AgentZirox
Di «Zirox» para activar. Requiere agente corriendo en localhost:3000.
"""

import os
import sys
import re
import tempfile

# Fix Windows console encoding for unicode/emoji
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if sys.stderr.encoding != 'utf-8':
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

import asyncio
import base64
import ctypes
import io
import subprocess
import tempfile
import time
from difflib import SequenceMatcher
import edge_tts
import numpy as np
import sounddevice as sd
import scipy.io.wavfile as wavfile
import requests
from PIL import ImageGrab
from groq import Groq
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))

# ── Configuración ─────────────────────────────────────────────────────────────
GROQ_API_KEY      = os.getenv('GROQ_API_KEY', '')
AGENT_URL         = os.getenv('JARVIS_AGENT_URL', 'http://localhost:3000/api/chat')
API_SECRET        = os.getenv('WEB_API_SECRET', '')
CHAT_ID           = 'jarvis'

WAKE_WORDS        = {'zirox', 'ziro', 'sirox', 'cirox', 'silox', 'sirop', 'xirox',
                     'zirop', 'siroc', 'zerox', 'serrox', 'serox', 'silos', 'silas',
                     'siros', 'sioxx', 'jarvis', 'despierta'}
VISION_KEYWORDS   = ['qué ves', 'que ves', 'mira la pantalla', 'mira esto',
                     'qué hay en mi pantalla', 'que hay en mi pantalla',
                     'qué está en mi pantalla', 'que esta en mi pantalla',
                     'que esta es mi pantalla', 'dime que esta', 'dime qué esta',
                     'analiza pantalla', 'analiza la pantalla',
                     'qué tengo abierto', 'que tengo abierto',
                     'qué estoy viendo', 'que estoy viendo',
                     'qué se ve', 'que se ve', 'qué hay en pantalla',
                     'pantalla', 'captura', 'screenshot', 'foto pantalla',
                     'que ves ahora', 'qué ves ahora', 'describe lo que ves']
VISION_MODEL      = 'meta-llama/llama-4-scout-17b-16e-instruct'
SAMPLE_RATE       = 16_000
CHANNELS          = 1
WAKE_CHUNK_SECS   = 2.5      # duración de cada chunk de escucha pasiva
ENERGY_THRESHOLD  = 0.015    # RMS normalizado — ajustar si hay falsos positivos
SILENCE_SECS      = 1.8      # segundos de silencio para cortar el comando
MAX_CMD_SECS      = 12       # duración máxima de un comando

# ── TTS ───────────────────────────────────────────────────────────────────────
VOICE = os.getenv('JARVIS_VOICE', 'es-US-AlonsoNeural')
_wm   = ctypes.windll.winmm

def speak(text: str) -> None:
    print(f'🔊 {text}')
    safe = text.replace('\n', ' ')[:600]

    async def _gen(path: str) -> None:
        await edge_tts.Communicate(safe, VOICE, rate='+10%').save(path)

    path = tempfile.mktemp(suffix='.mp3')
    try:
        asyncio.run(_gen(path))
        _wm.mciSendStringW(f'open "{path}" type mpegvideo alias mp3', None, 0, None)
        _wm.mciSendStringW('play mp3 wait', None, 0, None)
        _wm.mciSendStringW('close mp3', None, 0, None)
    except Exception as e:
        print(f'[tts error] {e}')
    finally:
        try:
            os.unlink(path)
        except Exception:
            pass

# ── Audio helpers ─────────────────────────────────────────────────────────────
def rms(audio: np.ndarray) -> float:
    return float(np.sqrt(np.mean((audio.astype(np.float32) / 32768.0) ** 2)))

def record_chunk(duration: float) -> np.ndarray:
    samples = int(SAMPLE_RATE * duration)
    data = sd.rec(samples, samplerate=SAMPLE_RATE, channels=CHANNELS, dtype='int16')
    sd.wait()
    return data

def record_until_silence() -> np.ndarray:
    """Graba hasta detectar silencio prolongado o MAX_CMD_SECS."""
    chunks = []
    chunk_secs   = 0.6
    chunk_samp   = int(SAMPLE_RATE * chunk_secs)
    silent_limit = int(SILENCE_SECS / chunk_secs)
    max_chunks   = int(MAX_CMD_SECS / chunk_secs)
    silent_count = 0

    for _ in range(max_chunks):
        chunk = sd.rec(chunk_samp, samplerate=SAMPLE_RATE, channels=CHANNELS, dtype='int16')
        sd.wait()
        chunks.append(chunk)
        if rms(chunk) < ENERGY_THRESHOLD:
            silent_count += 1
            if silent_count >= silent_limit:
                break
        else:
            silent_count = 0

    return np.concatenate(chunks, axis=0)

# ── Transcripción ─────────────────────────────────────────────────────────────
groq_client = Groq(api_key=GROQ_API_KEY)

def transcribe(audio: np.ndarray) -> str:
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
        wavfile.write(f.name, SAMPLE_RATE, audio)
        path = f.name
    try:
        with open(path, 'rb') as f:
            result = groq_client.audio.transcriptions.create(
                model='whisper-large-v3-turbo',
                file=('audio.wav', f, 'audio/wav'),
                language='es',
            )
        return result.text.strip()
    finally:
        os.unlink(path)

# ── Agente ────────────────────────────────────────────────────────────────────
def ask_agent(message: str) -> str:
    headers = {'Content-Type': 'application/json'}
    if API_SECRET:
        headers['x-api-secret'] = API_SECRET
    try:
        r = requests.post(
            AGENT_URL,
            json={'message': message, 'chatId': CHAT_ID},
            headers=headers,
            timeout=60,
        )
        r.raise_for_status()
        return r.json().get('reply', 'Sin respuesta.')
    except requests.exceptions.ConnectionError:
        return 'No puedo conectar con el agente. ¿Está corriendo npm run dev?'
    except Exception as e:
        return f'Error: {e}'

def clean_for_tts(text: str) -> str:
    """Elimina markdown y símbolos que suenan mal en TTS."""
    text = re.sub(r'```[\s\S]*?```', '', text)
    text = re.sub(r'`[^`]+`', '', text)
    text = re.sub(r'\*+([^*]+)\*+', r'\1', text)
    text = re.sub(r'#{1,6}\s*', '', text)
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
    text = re.sub(r'[^\w\s.,!?áéíóúüñÁÉÍÓÚÜÑ:()\-\'\"]+', ' ', text)
    return ' '.join(text.split())[:700]

# ── Visión de pantalla ────────────────────────────────────────────────────────
def is_vision_command(text: str) -> bool:
    t = text.lower()
    return any(k in t for k in VISION_KEYWORDS)

def screenshot_base64() -> str:
    img = ImageGrab.grab()
    img = img.resize((1280, 720))
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=70)
    return base64.b64encode(buf.getvalue()).decode()

def ask_vision(question: str) -> str:
    print('📸  Capturando pantalla...')
    try:
        img_b64 = screenshot_base64()
        base_prompt = (
            'Responde SIEMPRE en español. '
            'Describe brevemente lo que ves en esta pantalla en 2-3 frases máximo. '
            'Sé directo y conciso.'
        )
        prompt = f'{base_prompt} El usuario pregunta: {question}' if question else base_prompt
        response = groq_client.chat.completions.create(
            model=VISION_MODEL,
            messages=[{
                'role': 'user',
                'content': [
                    {'type': 'image_url', 'image_url': {'url': f'data:image/jpeg;base64,{img_b64}'}},
                    {'type': 'text', 'text': prompt},
                ],
            }],
            max_tokens=200,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        return f'No pude analizar la pantalla: {e}'

# ── Wake word ─────────────────────────────────────────────────────────────────
def _like_zirox(word: str) -> bool:
    w = word.lower().strip('.,!?¡¿:;"\'-')
    if w in WAKE_WORDS:
        return True
    if len(w) >= 4:
        return SequenceMatcher(None, w, 'zirox').ratio() >= 0.7
    return False

def find_wake_word(text: str) -> tuple[bool, str]:
    words = text.split()
    for i, w in enumerate(words):
        if _like_zirox(w):
            command = ' '.join(words[i + 1:]).strip(' ,.-!¡¿?')
            return True, command
    return False, ''

CONV_TIMEOUT_SECS  = 12   # segundos de silencio para volver a modo pasivo
CONV_CHUNK_SECS    = 1.0  # chunks cortos para reaccionar rápido en conversación

# ── Procesador de comando (compartido por wake word y conversación) ────────────
def process_command(command: str) -> None:
    print(f'📝  Comando: {command}')
    if is_vision_command(command):
        speak('Mirando tu pantalla.')
        reply = ask_vision(command)
    else:
        speak('Un momento.')
        reply = ask_agent(command)
    print(f'🤖  {reply[:200]}')
    speak(clean_for_tts(reply))

# ── Modo conversación ─────────────────────────────────────────────────────────
def conversation_mode() -> None:
    print('💬  Modo conversación — escuchando seguimiento...')
    silent_secs = 0.0

    while silent_secs < CONV_TIMEOUT_SECS:
        chunk = record_chunk(CONV_CHUNK_SECS)
        if rms(chunk) < ENERGY_THRESHOLD:
            silent_secs += CONV_CHUNK_SECS
            continue

        silent_secs = 0.0
        rest = record_until_silence()
        full_audio = np.concatenate([chunk, rest], axis=0)
        try:
            command = transcribe(full_audio)
        except Exception as e:
            print(f'[transcribe error] {e}')
            continue

        if not command or len(command) < 2:
            continue

        process_command(command)

    print('💬  Silencio — volviendo a modo pasivo.')

# ── Bucle principal ───────────────────────────────────────────────────────────
def run():
    if not GROQ_API_KEY:
        print('❌  Falta GROQ_API_KEY en .env')
        sys.exit(1)

    print()
    print('╔══════════════════════════════════════╗')
    print('║   Jarvis · AgentZirox  — modo local  ║')
    print('╠══════════════════════════════════════╣')
    print('║  Di «Jarvis» para activar            ║')
    print('║  Ctrl+C para salir                   ║')
    print('╚══════════════════════════════════════╝')
    print()

    speak('Jarvis activo. Di Jarvis para activarme.')

    while True:
        # ── Escucha pasiva ────────────────────────────────────────────────────
        chunk = record_chunk(WAKE_CHUNK_SECS)
        if rms(chunk) < ENERGY_THRESHOLD:
            continue

        try:
            text = transcribe(chunk)
        except Exception as e:
            print(f'[transcribe error] {e}')
            continue

        if not text:
            continue

        print(f'👂  {text}')
        found, command = find_wake_word(text)
        if not found:
            continue

        # ── Wake word detectado ───────────────────────────────────────────────
        print('⚡  Wake word detectado!')

        if not command:
            speak('Dime')
            time.sleep(0.6)
            audio = record_until_silence()
            try:
                command = transcribe(audio)
            except Exception as e:
                print(f'[transcribe error] {e}')
                speak('No te escuché bien, inténtalo de nuevo.')
                continue

        if not command or len(command) < 2:
            speak('No escuché ningún comando.')
            continue

        process_command(command)
        conversation_mode()

if __name__ == '__main__':
    try:
        run()
    except KeyboardInterrupt:
        print('\n\n👋  Jarvis desactivado.')
        speak('Hasta luego.')
