"""
AgenteZirox — Jarvis local para Windows
=========================================
Mantén pulsado F2 para hablar. Suelta para enviar.
El agente piensa con Groq y actúa en tu laptop (archivos, apps, comandos…)
y puede delegar al agente en el VPS para tareas en la nube.

Instalación:
    pip install groq httpx sounddevice numpy soundfile pynput edge-tts pygame pyperclip

.env junto a este script:
    GROQ_API_KEY   — tu clave Groq
    AGENT_URL      — https://ziro.zirox.io/api/chat  (para tareas en la nube)
    WEB_API_SECRET — si lo configuraste en Dokploy
    VOICE          — voz Edge TTS (por defecto es-ES-AlvaroNeural)
    GROQ_MODEL     — modelo a usar (por defecto llama-3.3-70b-versatile)
"""

import asyncio, glob, json, os, platform, shutil, subprocess, sys, tempfile
import threading, time
from datetime import datetime
from pathlib import Path

# ── .env ─────────────────────────────────────────────────────────────────────
_env = Path(__file__).parent / '.env'
if _env.exists():
    for _l in _env.read_text(encoding='utf-8').splitlines():
        _l = _l.strip()
        if _l and not _l.startswith('#') and '=' in _l:
            k, _, v = _l.partition('=')
            os.environ.setdefault(k.strip(), v.strip())

GROQ_API_KEY = os.environ.get('GROQ_API_KEY', '')
AGENT_URL    = os.environ.get('AGENT_URL', 'https://ziro.zirox.io/api/chat')
API_SECRET   = os.environ.get('WEB_API_SECRET', '')
VOICE        = os.environ.get('VOICE', 'es-ES-AlvaroNeural')
MODEL        = os.environ.get('GROQ_MODEL', 'llama-3.3-70b-versatile')
CHAT_ID      = 'laptop-jarvis'
SAMPLE_RATE  = 16_000
PUSH_KEY     = 'f2'

if not GROQ_API_KEY:
    print('ERROR: define GROQ_API_KEY en .env'); sys.exit(1)

try:
    import groq as _groq_mod
    import httpx
    import numpy as np
    import sounddevice as sd
    import soundfile as sf
    from pynput import keyboard as pynput_kb
    import pygame
    import edge_tts
    import pyperclip
except ImportError as e:
    print(f'Falta: {e}')
    print('pip install groq httpx sounddevice numpy soundfile pynput edge-tts pygame pyperclip')
    sys.exit(1)

groq_client = _groq_mod.Groq(api_key=GROQ_API_KEY)
pygame.mixer.init()

# ══════════════════════════════════════════════════════════════════════════════
#  HERRAMIENTAS LOCALES
# ══════════════════════════════════════════════════════════════════════════════

def _tool_create_folder(path: str) -> str:
    p = Path(path).expanduser()
    p.mkdir(parents=True, exist_ok=True)
    return f'✅ Carpeta creada: {p}'

def _tool_delete_path(path: str) -> str:
    p = Path(path).expanduser()
    if not p.exists():
        return f'❌ No existe: {p}'
    if p.is_dir():
        shutil.rmtree(p)
        return f'✅ Carpeta eliminada: {p}'
    p.unlink()
    return f'✅ Archivo eliminado: {p}'

def _tool_write_file(path: str, content: str) -> str:
    p = Path(path).expanduser()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding='utf-8')
    return f'✅ Archivo guardado: {p} ({len(content)} chars)'

def _tool_read_file(path: str) -> str:
    p = Path(path).expanduser()
    if not p.exists():
        return f'❌ No existe: {p}'
    if p.stat().st_size > 200_000:
        return f'⚠️ Archivo muy grande ({p.stat().st_size} bytes). Especifica un rango.'
    return p.read_text(encoding='utf-8', errors='replace')

def _tool_list_files(path: str = '.') -> str:
    p = Path(path).expanduser()
    if not p.exists():
        return f'❌ No existe: {p}'
    items = sorted(p.iterdir(), key=lambda x: (x.is_file(), x.name.lower()))
    lines = []
    for item in items[:60]:
        tag = '📁' if item.is_dir() else '📄'
        lines.append(f'{tag} {item.name}')
    extra = len(list(p.iterdir())) - 60
    if extra > 0:
        lines.append(f'… y {extra} más')
    return '\n'.join(lines) if lines else 'Carpeta vacía.'

def _tool_move_file(src: str, dst: str) -> str:
    s, d = Path(src).expanduser(), Path(dst).expanduser()
    if not s.exists():
        return f'❌ No existe: {s}'
    d.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(s), str(d))
    return f'✅ Movido: {s} → {d}'

def _tool_copy_file(src: str, dst: str) -> str:
    s, d = Path(src).expanduser(), Path(dst).expanduser()
    if not s.exists():
        return f'❌ No existe: {s}'
    d.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(str(s), str(d))
    return f'✅ Copiado: {s} → {d}'

def _tool_search_files(pattern: str, folder: str = str(Path.home())) -> str:
    folder = str(Path(folder).expanduser())
    results = glob.glob(os.path.join(folder, '**', pattern), recursive=True)[:30]
    if not results:
        return f'No se encontraron archivos con patrón "{pattern}" en {folder}'
    return '\n'.join(results)

def _tool_open_app(name_or_path: str) -> str:
    try:
        os.startfile(name_or_path)
        return f'✅ Abierto: {name_or_path}'
    except Exception:
        try:
            subprocess.Popen(name_or_path, shell=True)
            return f'✅ Ejecutado: {name_or_path}'
        except Exception as e:
            return f'❌ No se pudo abrir: {e}'

def _tool_open_url(url: str) -> str:
    import webbrowser
    webbrowser.open(url)
    return f'✅ URL abierta en el navegador: {url}'

def _tool_run_command(command: str, timeout: int = 30) -> str:
    try:
        result = subprocess.run(
            command, shell=True, capture_output=True, text=True, timeout=timeout
        )
        out = (result.stdout or '').strip()
        err = (result.stderr or '').strip()
        parts = []
        if out:
            parts.append(f'STDOUT:\n{out[:2000]}')
        if err:
            parts.append(f'STDERR:\n{err[:500]}')
        if result.returncode != 0:
            parts.append(f'Código de salida: {result.returncode}')
        return '\n'.join(parts) if parts else '✅ Comando ejecutado sin salida.'
    except subprocess.TimeoutExpired:
        return f'❌ Timeout ({timeout}s)'
    except Exception as e:
        return f'❌ Error: {e}'

def _tool_take_screenshot(save_path: str = '') -> str:
    try:
        import mss, mss.tools
        with mss.mss() as sct:
            p = save_path.strip() or str(Path.home() / 'Desktop' / f'screenshot_{int(time.time())}.png')
            sct.shot(output=p)
        return f'✅ Captura guardada en: {p}'
    except ImportError:
        # fallback con PIL si mss no está
        try:
            from PIL import ImageGrab
            p = save_path.strip() or str(Path.home() / 'Desktop' / f'screenshot_{int(time.time())}.png')
            ImageGrab.grab().save(p)
            return f'✅ Captura guardada en: {p}'
        except ImportError:
            return '❌ Instala mss o Pillow para capturas: pip install mss'

def _tool_get_system_info() -> str:
    import psutil
    cpu  = psutil.cpu_percent(interval=1)
    ram  = psutil.virtual_memory()
    disk = psutil.disk_usage('C:\\')
    now  = datetime.now().strftime('%d/%m/%Y %H:%M')
    return (
        f'🖥️  Sistema: {platform.system()} {platform.release()}\n'
        f'💻 CPU: {cpu:.1f}% uso\n'
        f'🧠 RAM: {ram.percent:.1f}% usado ({ram.used/1e9:.1f} GB / {ram.total/1e9:.1f} GB)\n'
        f'💾 Disco C: {disk.percent:.1f}% usado ({disk.free/1e9:.1f} GB libres)\n'
        f'🕐 Hora: {now}'
    )

def _tool_get_clipboard() -> str:
    try:
        text = pyperclip.paste()
        return text[:2000] if text else '(portapapeles vacío)'
    except Exception as e:
        return f'❌ {e}'

def _tool_set_clipboard(text: str) -> str:
    try:
        pyperclip.copy(text)
        return '✅ Texto copiado al portapapeles.'
    except Exception as e:
        return f'❌ {e}'

def _tool_ask_cloud_agent(message: str) -> str:
    """Delega al agente del VPS para tareas en la nube (LinkedIn, email, web search…)."""
    headers = {'Content-Type': 'application/json'}
    if API_SECRET:
        headers['x-api-secret'] = API_SECRET
    try:
        resp = httpx.post(AGENT_URL, json={'message': message, 'chatId': CHAT_ID},
                          headers=headers, timeout=60)
        resp.raise_for_status()
        return resp.json().get('reply', '(sin respuesta)')
    except Exception as e:
        return f'❌ Error contactando al agente VPS: {e}'

# ── registro de herramientas ──────────────────────────────────────────────────

LOCAL_TOOLS = {
    'create_folder':    _tool_create_folder,
    'delete_path':      _tool_delete_path,
    'write_file':       _tool_write_file,
    'read_file':        _tool_read_file,
    'list_files':       _tool_list_files,
    'move_file':        _tool_move_file,
    'copy_file':        _tool_copy_file,
    'search_files':     _tool_search_files,
    'open_app':         _tool_open_app,
    'open_url':         _tool_open_url,
    'run_command':      _tool_run_command,
    'take_screenshot':  _tool_take_screenshot,
    'get_system_info':  _tool_get_system_info,
    'get_clipboard':    _tool_get_clipboard,
    'set_clipboard':    _tool_set_clipboard,
    'ask_cloud_agent':  _tool_ask_cloud_agent,
}

TOOL_DEFS = [
    {'type':'function','function':{'name':'create_folder','description':'Crear carpeta (y subcarpetas) en la laptop.','parameters':{'type':'object','properties':{'path':{'type':'string','description':'Ruta absoluta o relativa. Puedes usar ~ para home.'}},'required':['path']}}},
    {'type':'function','function':{'name':'delete_path','description':'Eliminar archivo o carpeta (y todo su contenido).','parameters':{'type':'object','properties':{'path':{'type':'string'}},'required':['path']}}},
    {'type':'function','function':{'name':'write_file','description':'Crear o sobreescribir un archivo con texto.','parameters':{'type':'object','properties':{'path':{'type':'string'},'content':{'type':'string'}},'required':['path','content']}}},
    {'type':'function','function':{'name':'read_file','description':'Leer el contenido de un archivo.','parameters':{'type':'object','properties':{'path':{'type':'string'}},'required':['path']}}},
    {'type':'function','function':{'name':'list_files','description':'Listar archivos y carpetas en una ruta.','parameters':{'type':'object','properties':{'path':{'type':'string','description':'Ruta a listar. Por defecto directorio actual.'}},'required':[]}}},
    {'type':'function','function':{'name':'move_file','description':'Mover o renombrar archivo/carpeta.','parameters':{'type':'object','properties':{'src':{'type':'string'},'dst':{'type':'string'}},'required':['src','dst']}}},
    {'type':'function','function':{'name':'copy_file','description':'Copiar archivo o carpeta.','parameters':{'type':'object','properties':{'src':{'type':'string'},'dst':{'type':'string'}},'required':['src','dst']}}},
    {'type':'function','function':{'name':'search_files','description':'Buscar archivos por nombre/patrón glob en una carpeta.','parameters':{'type':'object','properties':{'pattern':{'type':'string','description':'Patrón glob, ej: *.pdf, reporte*.xlsx'},'folder':{'type':'string','description':'Carpeta raíz de búsqueda. Por defecto carpeta personal.'}},'required':['pattern']}}},
    {'type':'function','function':{'name':'open_app','description':'Abrir una aplicación o archivo del sistema (Notepad, Chrome, un .pdf, etc.).','parameters':{'type':'object','properties':{'name_or_path':{'type':'string','description':'Nombre del exe, ruta completa, o nombre de archivo a abrir.'}},'required':['name_or_path']}}},
    {'type':'function','function':{'name':'open_url','description':'Abrir una URL en el navegador por defecto.','parameters':{'type':'object','properties':{'url':{'type':'string'}},'required':['url']}}},
    {'type':'function','function':{'name':'run_command','description':'Ejecutar un comando de Windows (CMD/PowerShell). Usar con cuidado.','parameters':{'type':'object','properties':{'command':{'type':'string'},'timeout':{'type':'integer','description':'Segundos máximo. Por defecto 30.'}},'required':['command']}}},
    {'type':'function','function':{'name':'take_screenshot','description':'Hacer una captura de pantalla y guardarla.','parameters':{'type':'object','properties':{'save_path':{'type':'string','description':'Ruta donde guardar. Por defecto escritorio.'}},'required':[]}}},
    {'type':'function','function':{'name':'get_system_info','description':'Obtener info del sistema: CPU, RAM, disco, hora.','parameters':{'type':'object','properties':{},'required':[]}}},
    {'type':'function','function':{'name':'get_clipboard','description':'Leer el contenido del portapapeles.','parameters':{'type':'object','properties':{},'required':[]}}},
    {'type':'function','function':{'name':'set_clipboard','description':'Copiar texto al portapapeles.','parameters':{'type':'object','properties':{'text':{'type':'string'}},'required':['text']}}},
    {'type':'function','function':{'name':'ask_cloud_agent','description':'Delegar al agente en el VPS para tareas en la nube: LinkedIn, email, buscar en internet, recordatorios, Google Sheets, etc.','parameters':{'type':'object','properties':{'message':{'type':'string','description':'Mensaje exacto para el agente cloud.'}},'required':['message']}}},
]

SYSTEM_PROMPT = f"""Eres AgenteZirox ejecutándote en la laptop de Ziro (Windows 11).
Tienes acceso completo al sistema: puedes crear, leer, mover y eliminar archivos y carpetas,
abrir aplicaciones, ejecutar comandos, capturar pantalla, gestionar el portapapeles y más.
Para tareas en la nube (LinkedIn, email, búsqueda web, Google Sheets, recordatorios) usa ask_cloud_agent.
Ruta home del usuario: {Path.home()}
Escritorio: {Path.home() / 'Desktop'}
Documentos: {Path.home() / 'Documents'}
Fecha y hora: {datetime.now().strftime('%d/%m/%Y %H:%M')}
Responde siempre en español. Sé conciso y directo."""

# ── historial de conversación (en memoria) ────────────────────────────────────
_history: list[dict] = []
MAX_HISTORY = 20

# ══════════════════════════════════════════════════════════════════════════════
#  BUCLE AGENTE
# ══════════════════════════════════════════════════════════════════════════════

def _run_agent(user_text: str) -> str:
    global _history
    _history.append({'role': 'user', 'content': user_text})
    if len(_history) > MAX_HISTORY * 2:
        _history = _history[-MAX_HISTORY * 2:]

    messages = [{'role': 'system', 'content': SYSTEM_PROMPT}] + _history

    for _ in range(6):  # máx 6 iteraciones de tool calls
        resp = groq_client.chat.completions.create(
            model=MODEL,
            messages=messages,
            tools=TOOL_DEFS,
            tool_choice='auto',
            temperature=0.5,
            max_tokens=1024,
        )
        choice = resp.choices[0]
        msg = choice.message

        if msg.tool_calls:
            messages.append(msg)
            for tc in msg.tool_calls:
                fn   = tc.function.name
                args = json.loads(tc.function.arguments or '{}')
                print(f'  🔧 {fn}({", ".join(f"{k}={repr(v)[:40]}" for k,v in args.items())})')
                func = LOCAL_TOOLS.get(fn)
                result = func(**args) if func else f'❌ Herramienta desconocida: {fn}'
                print(f'     → {str(result)[:120]}')
                messages.append({
                    'role': 'tool',
                    'tool_call_id': tc.id,
                    'content': str(result),
                })
            continue  # siguiente iteración con los resultados

        # respuesta final
        final = (msg.content or '').strip() or '✅ Hecho.'
        _history.append({'role': 'assistant', 'content': final})
        return final

    return 'Alcancé el límite de iteraciones.'

# ══════════════════════════════════════════════════════════════════════════════
#  VOZ
# ══════════════════════════════════════════════════════════════════════════════

_recording    = False
_audio_chunks: list[np.ndarray] = []
_lock         = threading.Lock()
_busy         = False

def _audio_callback(indata, frames, time_info, status):
    if _recording:
        with _lock:
            _audio_chunks.append(indata.copy())

def _start_recording():
    global _recording, _audio_chunks
    with _lock:
        _audio_chunks = []
        _recording = True
    print('\n🎙️  Grabando… (suelta F2)')

def _stop_and_process():
    global _recording, _busy
    _recording = False
    time.sleep(0.05)
    with _lock:
        chunks = list(_audio_chunks)
    if not chunks:
        print('⚠️  Sin audio.')
        return
    audio = np.concatenate(chunks, axis=0).flatten().astype(np.float32)
    if len(audio) / SAMPLE_RATE < 0.5:
        print('⚠️  Audio demasiado corto.')
        return
    _busy = True
    threading.Thread(target=_process_turn, args=(audio,), daemon=True).start()

def _process_turn(audio: np.ndarray):
    global _busy
    try:
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
            tmp = f.name
        sf.write(tmp, audio, SAMPLE_RATE)

        print('📝 Transcribiendo…')
        with open(tmp, 'rb') as af:
            transcription = groq_client.audio.transcriptions.create(
                model='whisper-large-v3-turbo',
                file=af,
                response_format='text',
                language='es',
            )
        os.unlink(tmp)
        text = str(transcription).strip()
        if not text:
            print('⚠️  Sin voz detectada.')
            return
        print(f'🗣️  Tú: {text}')

        print('🤖 Pensando…')
        reply = _run_agent(text)
        # Solo hablar los primeros 600 chars para no eternizarse
        spoken = reply[:600] + ('…' if len(reply) > 600 else '')
        print(f'🤖 Jarvis: {reply[:300]}{"…" if len(reply) > 300 else ""}')
        asyncio.run(_speak(spoken))

    except Exception as e:
        print(f'❌ Error: {e}')
    finally:
        _busy = False

async def _speak(text: str):
    with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as f:
        tmp = f.name
    await edge_tts.Communicate(text, VOICE).save(tmp)
    pygame.mixer.music.load(tmp)
    pygame.mixer.music.play()
    while pygame.mixer.music.get_busy():
        await asyncio.sleep(0.1)
    pygame.mixer.music.unload()
    os.unlink(tmp)

# ── hotkey ────────────────────────────────────────────────────────────────────

def _on_press(key):
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

# ══════════════════════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════════════════════

def main():
    print('╔══════════════════════════════════════════╗')
    print('║    AgenteZirox — Jarvis modo local       ║')
    print('╠══════════════════════════════════════════╣')
    print(f'║  Modelo : {MODEL:<32}║')
    print(f'║  Voz    : {VOICE:<32}║')
    print(f'║  VPS    : {AGENT_URL[:32]:<32}║')
    print('║  Hotkey : F2 (mantén pulsado)            ║')
    print('╚══════════════════════════════════════════╝')
    print('\nEsperando… (Ctrl+C para salir)\n')

    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype='float32',
                        callback=_audio_callback):
        with pynput_kb.Listener(on_press=_on_press, on_release=_on_release) as lst:
            lst.join()

if __name__ == '__main__':
    main()
