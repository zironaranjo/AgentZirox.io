import { NextResponse } from "next/server";
import { stripForSpeech } from "@/lib/speech-text";
import { synthesizeSpeech, VOICES } from "@/tools/tts-generate";

export async function POST(req: Request) {
  let body: { text?: string; voice?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const raw = String(body.text ?? "").trim();
  const clean = stripForSpeech(raw);
  if (!clean) {
    return NextResponse.json({ error: "Texto vacío" }, { status: 400 });
  }
  if (clean.length > 4000) {
    return NextResponse.json({ error: "Texto demasiado largo" }, { status: 400 });
  }

  const voiceKey = String(body.voice ?? "jorge").toLowerCase();
  if (!VOICES[voiceKey] && voiceKey !== "default") {
    return NextResponse.json({ error: "Voz no válida" }, { status: 400 });
  }

  try {
    const mp3 = await synthesizeSpeech(clean, voiceKey);
    return new NextResponse(new Uint8Array(mp3), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error TTS";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
