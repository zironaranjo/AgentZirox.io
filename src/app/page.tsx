"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import NeuralBackground from "@/components/ui/flow-field-background";
import { ZiroChatInput } from "@/components/ui/v0-ai-chat";

type AgentState = "idle" | "listening" | "thinking" | "speaking";

const COLORS: Record<AgentState, { primary: string; secondary: string }> = {
  idle:      { primary: "#8b5cf6", secondary: "#6d28d9" },
  listening: { primary: "#0ea5e9", secondary: "#0284c7" },
  thinking:  { primary: "#f59e0b", secondary: "#d97706" },
  speaking:  { primary: "#10b981", secondary: "#059669" },
};

const LABELS: Record<AgentState, string> = {
  idle:      "En espera",
  listening: "Escuchando...",
  thinking:  "Procesando...",
  speaking:  "Respondiendo...",
};

/** Ancho del panel lateral de conversación (px) */
const SIDEBAR_W = 340;

export default function Home() {
  const [messages, setMessages] = useState<{ text: string; sender: "user" | "bot" }[]>([
    { text: "Enlace establecido. Soy Ziro.<br/>¿En qué puedo asistirte?", sender: "bot" },
  ]);
  const [state, setState]           = useState<AgentState>("idle");
  const [agentInput, setAgentInput] = useState("");
  const [showChat, setShowChat]     = useState(false);
  const [transcript, setTranscript] = useState("");
  const [lastReply, setLastReply]   = useState("");
  const [micError, setMicError]     = useState("");
  const recogRef                    = useRef<any>(null);
  const speakTimerRef               = useRef<ReturnType<typeof setTimeout> | null>(null);


  const stripHtml = (html: string) => html.replace(/<[^>]*>/g, "").replace(/&[a-z]+;/g, " ").trim();

  const speakText = useCallback((text: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(stripHtml(text));
    utter.lang = "es-ES";
    utter.rate = 1.05;
    utter.pitch = 1;
    const voices = window.speechSynthesis.getVoices();
    const esVoice = voices.find(v => v.lang.startsWith("es")) ?? null;
    if (esVoice) utter.voice = esVoice;
    utter.onend = () => setState("idle");
    utter.onerror = () => setState("idle");
    window.speechSynthesis.speak(utter);
  }, []);

  useEffect(() => {
    if ("speechSynthesis" in window) window.speechSynthesis.getVoices();
  }, []);


  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || state === "thinking") return;
    setShowChat(true);
    setTranscript("");
    setMessages(prev => [...prev, { text: trimmed, sender: "user" }]);
    setAgentInput("");
    setState("thinking");

    try {
      const res  = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      const data = await res.json();
      const reply = data.reply ?? "(sin respuesta)";
      setMessages(prev => [...prev, { text: reply, sender: "bot" }]);
      setLastReply(reply);
      setShowChat(true);
      setState("speaking");
      speakText(reply);
    } catch {
      setMessages(prev => [...prev, { text: "[Error de conexión]", sender: "bot" }]);
      setState("idle");
    }
  }, [state, speakText]);

  const startListening = useCallback(() => {
    if (state === "thinking" || state === "speaking") return;
    window.speechSynthesis?.cancel();
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setShowChat(true); setMicError("Tu navegador no soporta reconocimiento de voz. Usa Chrome."); return; }

    if (recogRef.current) { recogRef.current.abort(); recogRef.current = null; }

    setMicError("");
    const r = new SR();
    r.lang = "es-ES";
    r.continuous = false;
    r.interimResults = true;
    recogRef.current = r;

    r.onstart  = () => { if (speakTimerRef.current) clearTimeout(speakTimerRef.current); setState("listening"); setTranscript(""); };
    r.onresult = (e: any) => {
      const interim = Array.from(e.results).map((res: any) => res[0].transcript).join("");
      setTranscript(interim);
      if (e.results[e.results.length - 1].isFinal) sendMessage(interim);
    };
    r.onerror  = (e: any) => {
      recogRef.current = null;
      setState("idle");
      setTranscript("");
      const code: string = e.error ?? "";
      if (code === "not-allowed" || code === "permission-denied")
        setMicError("Permiso de micrófono denegado. Actívalo en la barra de Chrome.");
      else if (code === "no-speech")
        setMicError("No detecté voz. Habla más cerca del micrófono.");
      else if (code === "network")
        setMicError("Error de red. El reconocimiento de voz requiere conexión.");
      else if (code !== "aborted")
        setMicError(`Error de voz: ${code}`);
    };
    r.onend = () => {
      recogRef.current = null;
      setState(prev => prev === "listening" ? "idle" : prev);
    };
    r.start();
  }, [state, sendMessage]);

  const stopListening = useCallback(() => {
    recogRef.current?.stop();
    recogRef.current = null;
  }, []);

  const c = COLORS[state];
  const isActive = state !== "idle";

  return (
    <div
      className={showChat ? "ziro-layout ziro-chat-open" : "ziro-layout"}
      style={{
        minHeight: "100svh", width: "100%",
        background: "#050508",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        fontFamily: "'Outfit', 'Inter', system-ui, sans-serif",
        position: "relative", overflow: "hidden",
        ["--ziro-sidebar-w" as string]: `${SIDEBAR_W}px`,
      }}
    >

      {/* ── SVG grain filter ── */}
      <svg style={{ position: "absolute", width: 0, height: 0 }} aria-hidden="true">
        <defs>
          <filter id="grain" x="0%" y="0%" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="4" stitchTiles="stitch" result="noise"/>
            <feColorMatrix type="saturate" values="0" in="noise" result="grayNoise"/>
            <feBlend in="SourceGraphic" in2="grayNoise" mode="overlay" result="blended"/>
            <feComposite in="blended" in2="SourceGraphic" operator="in"/>
          </filter>
        </defs>
      </svg>

      {/* ── Background: Neural particle flow field ── */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }} aria-hidden="true">
        <NeuralBackground
          color={c.primary}
          particleCount={350}
          trailOpacity={0.10}
          speed={0.8}
          className="absolute inset-0 w-full h-full opacity-35 bg-transparent"
        />
      </div>

      {/* ── Dynamic ambient glow (follows state color) ── */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: `radial-gradient(ellipse 55% 55% at 50% 48%, ${c.primary}13 0%, transparent 70%)`,
        transition: "background 0.8s ease",
      }} aria-hidden="true" />

      {/* ══════════════════════════════════════════
          Header — centered glass pill
      ══════════════════════════════════════════ */}
      <div style={{
        position: "fixed", top: 18, left: "50%", transform: "translateX(-50%)",
        background: "rgba(255,255,255,0.04)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 60,
        padding: "6px 8px 6px 8px",
        display: "flex", alignItems: "center", gap: 10,
        zIndex: 50,
        whiteSpace: "nowrap",
        boxShadow: "0 4px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}>
        {/* Avatar */}
        <div style={{
          width: 38, height: 38, borderRadius: "50%",
          padding: 2,
          background: `linear-gradient(135deg, ${c.primary}, ${c.secondary})`,
          boxShadow: `0 0 14px ${c.primary}55`,
          transition: "box-shadow 0.6s ease, background 0.6s ease",
          flexShrink: 0,
        }}>
          <div style={{
            width: "100%", height: "100%", borderRadius: "50%",
            overflow: "hidden", background: "#0f172a", position: "relative",
          }}>
            <Image src="/zirox.png" alt="Ziro" fill style={{ objectFit: "cover", objectPosition: "top center" }} priority />
          </div>
        </div>

        {/* Name + state */}
        <div style={{ paddingRight: 4 }}>
          <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 13, letterSpacing: "0.18em" }}>ZIRO</div>
          <div style={{
            color: c.primary, fontSize: 9, fontWeight: 600,
            letterSpacing: "0.18em", textTransform: "uppercase",
            transition: "color 0.6s ease",
          }}>
            {LABELS[state]}
          </div>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 26, background: "rgba(255,255,255,0.08)", flexShrink: 0 }} />

        {/* Chat toggle — SVG icon instead of emoji */}
        <button
          onClick={() => setShowChat(v => !v)}
          aria-label={showChat ? "Cerrar chat" : "Abrir chat"}
          aria-expanded={showChat}
          style={{
            background: showChat ? `${c.primary}20` : "transparent",
            border: `1px solid ${showChat ? `${c.primary}44` : "rgba(255,255,255,0.08)"}`,
            borderRadius: 30,
            padding: "6px 14px 6px 10px",
            color: showChat ? c.primary : "rgba(255,255,255,0.5)",
            fontSize: 11, fontWeight: 600, cursor: "pointer",
            letterSpacing: "0.08em", textTransform: "uppercase",
            transition: "all 0.25s ease",
            display: "flex", alignItems: "center", gap: 6,
            flexShrink: 0,
            minHeight: 32,
          }}
        >
          {showChat ? (
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          )}
          {showChat ? "Cerrar" : "Chat"}
        </button>
      </div>

      {/* ── Escena principal (agente + voz); se desplaza al abrir sidebar ── */}
      <div className="ziro-main-stage" style={{
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        width: "100%", flex: 1,
        paddingBottom: 200,
        boxSizing: "border-box",
      }}>

      {/* ══════════════════════════════════════════
          Agent Portrait
      ══════════════════════════════════════════ */}
      <div style={{
        position: "relative",
        width: 260, height: 360,
        display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: 24,
      }}>

        {/* Ring 3 — outermost */}
        <div style={{
          position: "absolute",
          width: isActive ? 400 : 330, height: isActive ? 400 : 330,
          borderRadius: "50%",
          border: `1px solid ${c.primary}18`,
          animation: isActive ? "ringPulse 2s ease-out infinite" : "ringIdle 4s ease-in-out infinite",
          transition: "border-color 0.6s ease, width 0.4s ease, height 0.4s ease",
          animationDelay: "0s",
        }} />

        {/* Ring 2 */}
        <div style={{
          position: "absolute",
          width: isActive ? 342 : 286, height: isActive ? 342 : 286,
          borderRadius: "50%",
          border: `1px solid ${c.primary}2c`,
          animation: isActive ? "ringPulse 2s ease-out infinite" : "ringIdle 4s ease-in-out infinite",
          transition: "border-color 0.6s ease, width 0.4s ease, height 0.4s ease",
          animationDelay: "0.38s",
        }} />

        {/* Ring 1 — innermost */}
        <div style={{
          position: "absolute",
          width: isActive ? 284 : 244, height: isActive ? 284 : 244,
          borderRadius: "50%",
          border: `1px solid ${c.primary}4c`,
          animation: isActive ? "ringPulse 2s ease-out infinite" : "ringIdle 4s ease-in-out infinite",
          transition: "border-color 0.6s ease, width 0.4s ease, height 0.4s ease",
          animationDelay: "0.76s",
        }} />

        {/* Glow bloom */}
        <div style={{
          position: "absolute",
          width: isActive ? 280 : 220, height: isActive ? 380 : 300,
          background: `radial-gradient(ellipse, ${c.primary}30 0%, ${c.secondary}14 50%, transparent 75%)`,
          filter: "blur(44px)",
          animation: isActive ? "glowPulse 1.5s ease-in-out infinite" : "breathe 4s ease-in-out infinite",
          transition: "background 0.6s ease, width 0.5s ease, height 0.5s ease",
          pointerEvents: "none",
        }} />

        {/* Portrait — soft edge blend via mask-image */}
        <div
          role="button"
          tabIndex={0}
          aria-label={state === "listening" ? "Detener escucha" : "Iniciar escucha"}
          onClick={state === "listening" ? stopListening : startListening}
          onKeyDown={e => e.key === "Enter" && (state === "listening" ? stopListening() : startListening())}
          style={{
            position: "relative", width: "100%", height: "100%",
            cursor: "pointer",
            maskImage: "radial-gradient(ellipse 86% 82% at 50% 38%, black 35%, rgba(0,0,0,0.75) 52%, rgba(0,0,0,0.2) 66%, transparent 80%)",
            WebkitMaskImage: "radial-gradient(ellipse 86% 82% at 50% 38%, black 35%, rgba(0,0,0,0.75) 52%, rgba(0,0,0,0.2) 66%, transparent 80%)",
            animation: isActive ? "orbActive 0.9s ease-in-out infinite" : "breathe 4s ease-in-out infinite",
            filter: `drop-shadow(0 0 28px ${c.primary}50) drop-shadow(0 0 56px ${c.primary}22)`,
            transition: "filter 0.6s ease",
          }}
        >
          <Image
            src="/zirox.png"
            alt="Ziro — Agente IA"
            fill
            style={{ objectFit: "cover", objectPosition: "top center" }}
            priority
          />
          {/* State-reactive color wash */}
          <div style={{
            position: "absolute", inset: 0,
            background: `radial-gradient(ellipse at 50% 28%, ${c.primary}22 0%, transparent 62%)`,
            mixBlendMode: "soft-light",
            transition: "background 0.8s ease",
            pointerEvents: "none",
          }} />
        </div>
      </div>

      {/* ── Status pill ── */}
      <div style={{
        background: `${c.primary}10`,
        border: `1px solid ${c.primary}28`,
        borderRadius: 100,
        padding: "5px 18px",
        color: c.primary,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.22em",
        textTransform: "uppercase",
        marginBottom: 18,
        transition: "all 0.6s ease",
        backdropFilter: "blur(8px)",
      }}
        aria-live="polite"
        aria-label={`Estado: ${LABELS[state]}`}
      >
        {LABELS[state]}
      </div>

      {/* ── Transcript / reply caption ── */}
      <div style={{
        minHeight: 52, marginBottom: 22,
        maxWidth: 480, width: "90%",
        textAlign: "center",
        transition: "opacity 0.4s ease",
        opacity: (transcript || (state === "speaking" && lastReply)) ? 1 : 0,
      }}>
        {state === "listening" && transcript && (
          <div style={{
            color: "#e2e8f0", fontSize: 14, lineHeight: 1.55,
            background: "rgba(14,165,233,0.09)",
            border: "1px solid rgba(14,165,233,0.20)",
            borderRadius: 16, padding: "10px 18px",
            fontStyle: "italic",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
          }}>
            "{transcript}"
          </div>
        )}
        {state === "speaking" && lastReply && (
          <div style={{
            color: "#e2e8f0", fontSize: 14, lineHeight: 1.55,
            background: "rgba(16,185,129,0.08)",
            border: "1px solid rgba(16,185,129,0.18)",
            borderRadius: 16, padding: "10px 18px",
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical" as const,
            overflow: "hidden",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
          }}
            dangerouslySetInnerHTML={{ __html: lastReply }}
          />
        )}
      </div>

      {/* ── Mic button ── */}
      <button
        onMouseDown={startListening}
        onMouseUp={state === "listening" ? stopListening : undefined}
        onTouchStart={(e) => { e.preventDefault(); startListening(); }}
        onTouchEnd={state === "listening" ? stopListening : undefined}
        onClick={state !== "listening" ? startListening : stopListening}
        aria-label={state === "listening" ? "Detener escucha" : "Hablar con Ziro"}
        aria-pressed={state === "listening"}
        style={{
          width: 72, height: 72, borderRadius: "50%",
          background: state === "listening"
            ? `linear-gradient(135deg, ${c.primary}, ${c.secondary})`
            : "rgba(255,255,255,0.055)",
          border: `1.5px solid ${state === "listening" ? c.primary : "rgba(255,255,255,0.10)"}`,
          cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: state === "listening"
            ? `0 0 30px ${c.primary}88, 0 0 64px ${c.primary}2e`
            : "0 4px 24px rgba(0,0,0,0.32)",
          transition: "all 0.25s ease",
          marginBottom: 10,
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          flexShrink: 0,
        }}
      >
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"
          style={{ fill: state === "listening" ? "white" : "rgba(255,255,255,0.52)", transition: "fill 0.25s ease" }}>
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
        </svg>
      </button>

      <div style={{
        color: "rgba(255,255,255,0.18)", fontSize: 10,
        letterSpacing: "0.22em", textTransform: "uppercase",
        marginBottom: 8,
        userSelect: "none",
      }}>
        {state === "listening" ? "Suelta para enviar" : "Toca para hablar"}
      </div>

      {micError && (
        <div role="alert" style={{
          maxWidth: 360, width: "90%",
          background: "rgba(239,68,68,0.09)",
          border: "1px solid rgba(239,68,68,0.28)",
          borderRadius: 14, padding: "10px 18px",
          color: "#fca5a5", fontSize: 12, textAlign: "center",
          marginBottom: 8,
          backdropFilter: "blur(8px)",
        }}>
          ⚠ {micError}
        </div>
      )}

      </div>{/* /ziro-main-stage */}

      {/* ── Dock: input + chips siempre visibles (no tapa al agente) ── */}
      <div className="ziro-chat-dock">
        <p className="ziro-chat-dock-title">¿En qué puedo asistirte?</p>
        <ZiroChatInput
          value={agentInput}
          onChange={setAgentInput}
          onSend={sendMessage}
          disabled={state === "thinking"}
          placeholder="Escribe un mensaje a Ziro…"
          showSuggestions
        />
      </div>

      {/* ── Sidebar derecho: solo historial de mensajes ── */}
      <aside
        className="ziro-chat-sidebar"
        role="dialog"
        aria-label="Historial de chat con Ziro"
        aria-hidden={!showChat}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 16px 12px",
          borderBottom: `1px solid ${c.primary}22`,
          flexShrink: 0,
        }}>
          <span style={{ color: "#f1f5f9", fontSize: 14, fontWeight: 600 }}>Conversación</span>
          <button
            type="button"
            onClick={() => setShowChat(false)}
            aria-label="Cerrar panel de chat"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 8,
              color: "rgba(255,255,255,0.55)",
              cursor: "pointer",
              padding: "6px 10px",
              fontSize: 12,
            }}
          >
            Cerrar
          </button>
        </div>

        <div className="ziro-chat-sidebar-messages">
          {messages.map((msg, i) => (
            <div key={i} style={{
              maxWidth: "92%",
              padding: "10px 14px",
              borderRadius: msg.sender === "bot" ? "16px 16px 16px 4px" : "16px 16px 4px 16px",
              alignSelf: msg.sender === "bot" ? "flex-start" : "flex-end",
              background: msg.sender === "bot"
                ? "rgba(255,255,255,0.05)"
                : `linear-gradient(135deg, ${c.primary}, ${c.secondary})`,
              border: msg.sender === "bot" ? `1px solid rgba(255,255,255,0.08)` : "none",
              color: "#f1f5f9",
              fontSize: 13, lineHeight: 1.55,
            }}
              dangerouslySetInnerHTML={{ __html: msg.text }}
            />
          ))}
          {state === "thinking" && (
            <div style={{
              alignSelf: "flex-start",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "16px 16px 16px 4px",
              padding: "12px 16px",
              display: "flex", gap: 5, alignItems: "center",
            }}>
              {[0, 0.2, 0.4].map((d, i) => (
                <div key={i} style={{
                  width: 6, height: 6, background: c.primary, borderRadius: "50%",
                  animation: `bounce 1.2s ease-in-out ${d}s infinite`,
                }} />
              ))}
            </div>
          )}
        </div>
      </aside>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { -webkit-text-size-adjust: 100%; }
        body { overflow: hidden; background: #050508; }

        @keyframes breathe {
          0%, 100% { transform: scale(1);    opacity: 0.85; }
          50%       { transform: scale(1.06); opacity: 1; }
        }
        @keyframes orbActive {
          0%, 100% { transform: scale(1);    opacity: 1; }
          50%       { transform: scale(1.08); opacity: 0.9; }
        }
        @keyframes ringIdle {
          0%, 100% { transform: scale(1);    opacity: 0.35; }
          50%       { transform: scale(1.04); opacity: 0.55; }
        }
        @keyframes ringPulse {
          0%   { transform: scale(1);    opacity: 0.7; }
          60%  { transform: scale(1.15); opacity: 0.15; }
          100% { transform: scale(1.22); opacity: 0; }
        }
        @keyframes glowPulse {
          0%, 100% { transform: scale(1);   opacity: 0.7; }
          50%       { transform: scale(1.2); opacity: 1; }
        }
        @keyframes dotPulse {
          0%, 100% { transform: scale(1);   opacity: 0.9; }
          50%       { transform: scale(1.5); opacity: 0.5; }
        }
        @keyframes dotBreath {
          0%, 100% { transform: scale(1);    opacity: 0.4; }
          50%       { transform: scale(1.25); opacity: 0.7; }
        }
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(-5px); }
        }

        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(139,92,246,0.28); border-radius: 2px; }

[role="button"]:focus-visible,
        button:focus-visible {
          outline: 2px solid rgba(139,92,246,0.7);
          outline-offset: 3px;
        }

        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after {
            animation-duration: 0.01ms !important;
            transition-duration: 0.01ms !important;
          }
        }

        .ziro-main-stage {
          transition: margin-right 0.38s cubic-bezier(0.32, 0.72, 0, 1);
        }
        .ziro-chat-open .ziro-main-stage {
          margin-right: var(--ziro-sidebar-w, 340px);
        }

        .ziro-chat-dock {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 35;
          padding: 12px 16px max(16px, env(safe-area-inset-bottom));
          max-width: 640px;
          margin: 0 auto;
          width: 100%;
          pointer-events: auto;
          background: linear-gradient(to top, rgba(5,5,8,0.97) 55%, transparent);
          transition: right 0.38s cubic-bezier(0.32, 0.72, 0, 1),
                      max-width 0.38s cubic-bezier(0.32, 0.72, 0, 1);
          box-sizing: border-box;
        }
        .ziro-chat-open .ziro-chat-dock {
          right: var(--ziro-sidebar-w, 340px);
          left: 0;
          margin: 0;
          max-width: min(640px, calc(100vw - var(--ziro-sidebar-w, 340px) - 24px));
        }
        .ziro-chat-dock-title {
          text-align: center;
          color: rgba(255,255,255,0.55);
          font-size: 15px;
          font-weight: 600;
          margin-bottom: 10px;
        }

        .ziro-chat-sidebar {
          position: fixed;
          top: 0;
          right: 0;
          bottom: 0;
          width: var(--ziro-sidebar-w, 340px);
          z-index: 40;
          display: flex;
          flex-direction: column;
          background: rgba(6, 6, 10, 0.96);
          backdrop-filter: blur(28px);
          -webkit-backdrop-filter: blur(28px);
          border-left: 1px solid rgba(139, 92, 246, 0.18);
          box-shadow: -8px 0 40px rgba(0, 0, 0, 0.45);
          transform: translateX(100%);
          transition: transform 0.38s cubic-bezier(0.32, 0.72, 0, 1),
                      border-color 0.6s ease;
          pointer-events: none;
        }
        .ziro-chat-open .ziro-chat-sidebar {
          transform: translateX(0);
          pointer-events: auto;
        }
        .ziro-chat-sidebar-messages {
          flex: 1;
          overflow-y: auto;
          padding: 12px 14px 20px;
          display: flex;
          flex-direction: column;
          gap: 8;
        }

        @media (max-width: 720px) {
          .ziro-layout.ziro-chat-open {
            --ziro-sidebar-w: min(88vw, 300px);
          }
          .ziro-chat-open .ziro-chat-dock {
            max-width: calc(100vw - var(--ziro-sidebar-w) - 16px);
            padding-left: 10px;
            padding-right: 10px;
          }
        }
      `}</style>
    </div>
  );
}
