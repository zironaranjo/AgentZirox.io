#!/usr/bin/env python3
"""
Jarvis — Asistente de voz local para AgentZirox
Di «Zirox» para activar. Requiere agente corriendo en localhost:3000.
"""

import os
import sys
import re
import tempfile
import numpy as np
import sounddevice as sd
import scipy.io.wavfile as wavfile
import requests
import pyttsx3
from groq import Groq
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))

# ── Configuración ─────────────────────────────────────────────────────────────
GROQ_API_KEY      = os.getenv('GROQ_API_KEY', '')
AGENT_URL         = os.getenv('JARVIS_AGENT_URL', 'http://localhost:3000/api/chat')
API_SECRET        = os.getenv('WEB_API_SECRET', '')
CHAT_ID           = 'jarvis'

WAKE_WORDS        = ['zirox', 'ziro', 'despierta zirox', 'despierta']
SAMPLE_RATE       = 16_000
CHANNELS          = 1
WAKE_CHUNK_SECS   = 2.5      # duración de cada chunk de escucha pasiva
ENERGY_THRESHOLD  = 0.015    # RMS normalizado — ajustar si hay falsos positivos
SILENCE_SECS      = 1.8      # segundos de silencio para cortar el comando
MAX_CMD_SECS      = 12       # duración máxima de un comando

# ── TTS ───────────────────────────────────────────────────────────────────────
tts = pyttsx3.init()
tts.setProperty('rate', 160)

for voice in tts.getProperty('voices'):
    name = voice.name.lower()
    vid  = voice.id.lower()
    if any(k in name or k in vid for k in ('sabina', 'helena', 'spanish', 'es_', 'es-')):
        tts.setProperty('voice', voice.id)
        break

def speak(text: str) -> None:
    print(f'🔊 {text}')
    tts.say(text)
    tts.runAndWait()

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

# ── Wake word ─────────────────────────────────────────────────────────────────
def find_wake_word(text: str) -> tuple[bool, str]:
    lower = text.lower()
    for word in WAKE_WORDS:
        idx = lower.find(word)
        if idx != -1:
            command = text[idx + len(word):].strip(' ,.-!¡¿?')
            return True, command
    return False, ''

# ── Bucle principal ───────────────────────────────────────────────────────────
def run():
    if not GROQ_API_KEY:
        print('❌  Falta GROQ_API_KEY en .env')
        sys.exit(1)

    print()
    print('╔══════════════════════════════════════╗')
    print('║   Jarvis · AgentZirox  — modo local  ║')
    print('╠══════════════════════════════════════╣')
    print('║  Di «Zirox» para activar             ║')
    print('║  Ctrl+C para salir                   ║')
    print('╚══════════════════════════════════════╝')
    print()

    speak('Jarvis activo. Di Zirox para activarme.')

    while True:
        # ── Escucha pasiva ────────────────────────────────────────────────────
        chunk = record_chunk(WAKE_CHUNK_SECS)
        energy = rms(chunk)

        if energy < ENERGY_THRESHOLD:
            continue  # silencio — no gastar API

        # Hay voz — transcribir para detectar wake word
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

        print(f'📝  Comando: {command}')
        speak('Un momento.')

        reply = ask_agent(command)
        print(f'🤖  {reply[:200]}')

        speak(clean_for_tts(reply))

if __name__ == '__main__':
    try:
        run()
    except KeyboardInterrupt:
        print('\n\n👋  Jarvis desactivado.')
        speak('Hasta luego.')
