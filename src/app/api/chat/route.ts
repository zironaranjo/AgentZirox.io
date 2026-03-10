import { NextResponse } from "next/server";
import { logger } from "../../../core/logger";

export async function POST(req: Request) {
  try {
    const { message } = await req.json();

    // Mock response so the user can test the chat interface right away.
    // We can hook this up to the actual AI core next.
    const reply = `He procesado tu mensaje vía Next.js: "${message}". Mi conexión directa al cerebro de IA estará lista muy pronto.`;

    return NextResponse.json({ reply });
  } catch (error) {
    logger.error("Error en /api/chat:", error);
    return NextResponse.json(
      { reply: "Error interno en mis sistemas neuronales." },
      { status: 500 }
    );
  }
}
