"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";

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

export default function Home() {
  const [messages, setMessages] = useState<{ text: string; sender: "user" | "bot" }[]>([
    { text: "Enlace establecido. Soy Ziro.<br/>¿En qué puedo asistirte?", sender: "bot" },
  ]);
  const [input, setInput]           = useState("");
  const [state, setState]           = useState<AgentState>("idle");
  const [showChat, setShowChat]     = useState(false);
  const [transcript, setTranscript] = useState("");   // live caption shown on screen
  const [lastReply, setLastReply]   = useState("");   // last bot reply shown below orb
  const messagesEndRef              = useRef<HTMLDivElement>(null);
  const recogRef                    = useRef<any>(null);
  const speakTimerRef               = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Strip HTML tags for TTS
  const stripHtml = (html: string) => html.replace(/<[^>]*>/g, "").replace(/&[a-z]+;/g, " ").trim();

  const speakText = useCallback((text: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(stripHtml(text));
    utter.lang = "es-ES";
    utter.rate = 1.05;
    utter.pitch = 1;
    // Prefer a Spanish voice if available
    const voices = window.speechSynthesis.getVoices();
    const esVoice = voices.find(v => v.lang.startsWith("es")) ?? null;
    if (esVoice) utter.voice = esVoice;
    utter.onend = () => setState("idle");
    utter.onerror = () => setState("idle");
    window.speechSynthesis.speak(utter);
  }, []);

  // Voices may load async — pre-load on mount
  useEffect(() => {
    if ("speechSynthesis" in window) window.speechSynthesis.getVoices();
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || state === "thinking") return;
    setTranscript("");
    setMessages(prev => [...prev, { text: trimmed, sender: "user" }]);
    setInput("");
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
      setShowChat(true);   // auto-open chat so user sees the response
      setState("speaking");
      speakText(reply);    // read reply aloud
    } catch {
      setMessages(prev => [...prev, { text: "[Error de conexión]", sender: "bot" }]);
      setState("idle");
    }
  }, [state, speakText]);

  const startListening = useCallback(() => {
    if (state === "thinking" || state === "speaking") return;
    window.speechSynthesis?.cancel();
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setShowChat(true); return; }

    if (recogRef.current) { recogRef.current.abort(); recogRef.current = null; }

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
    r.onerror  = () => { setState("idle"); setTranscript(""); };
    r.onend    = () => { if (state === "listening") setState("idle"); };
    r.start();
  }, [state, sendMessage]);

  const stopListening = useCallback(() => {
    recogRef.current?.stop();
    recogRef.current = null;
  }, []);

  const c = COLORS[state];
  const isActive = state !== "idle";

  return (
    <div style={{
      minHeight: "100vh", width: "100%",
      background: "#07070a",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      fontFamily: "'Inter', system-ui, sans-serif",
      position: "relative", overflow: "hidden",
    }}>

      {/* ── SVG grain filter ── */}
      <svg style={{ position: "absolute", width: 0, height: 0 }}>
        <defs>
          <filter id="grain" x="0%" y="0%" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="4" stitchTiles="stitch" result="noise"/>
            <feColorMatrix type="saturate" values="0" in="noise" result="grayNoise"/>
            <feBlend in="SourceGraphic" in2="grayNoise" mode="overlay" result="blended"/>
            <feComposite in="blended" in2="SourceGraphic" operator="in"/>
          </filter>
        </defs>
      </svg>

      {/* ── Background ambient glow ── */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: `radial-gradient(ellipse 60% 60% at 50% 50%, ${c.primary}18 0%, transparent 70%)`,
        transition: "background 0.8s ease",
      }} />

      {/* ── Avatar — top-left ── */}
      <div style={{
        position: "fixed", top: 20, left: 20,
        display: "flex", alignItems: "center", gap: 10,
        zIndex: 50,
      }}>
        <div style={{
          width: 52, height: 52, borderRadius: "50%",
          padding: 2,
          background: `linear-gradient(135deg, ${c.primary}, ${c.secondary})`,
          boxShadow: `0 0 16px ${c.primary}66`,
          transition: "box-shadow 0.6s ease, background 0.6s ease",
          flexShrink: 0,
        }}>
          <div style={{
            width: "100%", height: "100%", borderRadius: "50%",
            overflow: "hidden", background: "#0f172a", position: "relative",
          }}>
            <Image src="/avatar.png" alt="Ziro" fill style={{ objectFit: "cover" }} priority />
          </div>
        </div>
        <div>
          <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14, letterSpacing: 3 }}>ZIRO</div>
          <div style={{ color: c.primary, fontSize: 10, fontWeight: 600, letterSpacing: 2, transition: "color 0.6s ease" }}>
            {LABELS[state].toUpperCase()}
          </div>
        </div>
      </div>

      {/* ── Chat toggle — top-right ── */}
      <button onClick={() => setShowChat(v => !v)} style={{
        position: "fixed", top: 20, right: 20, zIndex: 50,
        background: showChat ? `${c.primary}33` : "rgba(255,255,255,0.05)",
        border: `1px solid ${showChat ? c.primary : "rgba(255,255,255,0.1)"}`,
        borderRadius: 12, padding: "8px 16px",
        color: "#f1f5f9", fontSize: 12, fontWeight: 600, cursor: "pointer",
        letterSpacing: 1, transition: "all 0.3s ease",
      }}>
        {showChat ? "✕ CERRAR" : "💬 CHAT"}
      </button>

      {/* ══════════════════════════════════════════
          Central Granular Orb
      ══════════════════════════════════════════ */}
      <div style={{
        position: "relative",
        width: 320, height: 320,
        display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: 48,
      }}>

        {/* Outer pulse ring 3 */}
        <div style={{
          position: "absolute",
          width: isActive ? 340 : 280, height: isActive ? 340 : 280,
          borderRadius: "50%",
          border: `1px solid ${c.primary}22`,
          animation: isActive ? "ringPulse 2s ease-out infinite" : "ringIdle 4s ease-in-out infinite",
          transition: "border-color 0.6s ease",
          animationDelay: "0s",
        }} />

        {/* Outer pulse ring 2 */}
        <div style={{
          position: "absolute",
          width: isActive ? 290 : 245, height: isActive ? 290 : 245,
          borderRadius: "50%",
          border: `1px solid ${c.primary}33`,
          animation: isActive ? "ringPulse 2s ease-out infinite" : "ringIdle 4s ease-in-out infinite",
          transition: "border-color 0.6s ease",
          animationDelay: "0.4s",
        }} />

        {/* Inner ring */}
        <div style={{
          position: "absolute",
          width: isActive ? 240 : 210, height: isActive ? 240 : 210,
          borderRadius: "50%",
          border: `1px solid ${c.primary}55`,
          animation: isActive ? "ringPulse 2s ease-out infinite" : "ringIdle 4s ease-in-out infinite",
          transition: "border-color 0.6s ease",
          animationDelay: "0.8s",
        }} />

        {/* Glow layer */}
        <div style={{
          position: "absolute",
          width: isActive ? 200 : 170, height: isActive ? 200 : 170,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${c.primary}44 0%, ${c.secondary}22 50%, transparent 75%)`,
          filter: "blur(20px)",
          animation: isActive ? "glowPulse 1.5s ease-in-out infinite" : "breathe 4s ease-in-out infinite",
          transition: "background 0.6s ease",
        }} />

        {/* Granular orb — core */}
        <div style={{
          position: "relative",
          width: isActive ? 160 : 140, height: isActive ? 160 : 140,
          borderRadius: "50%",
          background: `radial-gradient(circle at 35% 35%, ${c.primary}ff 0%, ${c.secondary}cc 45%, #1e1b4b 100%)`,
          boxShadow: `
            0 0 30px ${c.primary}88,
            0 0 60px ${c.primary}44,
            0 0 100px ${c.primary}22,
            inset 0 1px 2px rgba(255,255,255,0.35),
            inset 0 -2px 6px rgba(0,0,0,0.5)
          `,
          filter: "url(#grain)",
          animation: isActive ? "orbActive 0.8s ease-in-out infinite" : "breathe 4s ease-in-out infinite",
          transition: "width 0.4s ease, height 0.4s ease, background 0.6s ease, box-shadow 0.6s ease",
          cursor: "pointer",
        }}
          onClick={state === "listening" ? stopListening : startListening}
        >
          {/* Specular highlight */}
          <div style={{
            position: "absolute", top: "18%", left: "22%",
            width: "30%", height: "20%",
            borderRadius: "50%",
            background: "rgba(255,255,255,0.25)",
            filter: "blur(4px)",
            transform: "rotate(-30deg)",
          }} />
        </div>

        {/* Particle dots — decorative */}
        {[0, 60, 120, 180, 240, 300].map((deg, i) => {
          const r = isActive ? 118 : 105;
          const x = Math.cos((deg * Math.PI) / 180) * r;
          const y = Math.sin((deg * Math.PI) / 180) * r;
          const size = i % 2 === 0 ? 6 : 4;
          return (
            <div key={i} style={{
              position: "absolute",
              left: `calc(50% + ${x}px - ${size / 2}px)`,
              top: `calc(50% + ${y}px - ${size / 2}px)`,
              width: size, height: size,
              borderRadius: "50%",
              background: c.primary,
              opacity: isActive ? 0.9 : 0.45,
              boxShadow: `0 0 ${isActive ? 8 : 4}px ${c.primary}`,
              animation: isActive ? `dotPulse 1.2s ease-in-out ${i * 0.15}s infinite` : `dotBreath 4s ease-in-out ${i * 0.3}s infinite`,
              transition: "opacity 0.5s ease, left 0.4s ease, top 0.4s ease, background 0.6s ease",
            }} />
          );
        })}
      </div>

      {/* ── Status text ── */}
      <div style={{
        color: c.primary, fontSize: 13, fontWeight: 600, letterSpacing: 4,
        textTransform: "uppercase", marginBottom: 12,
        opacity: 0.9, transition: "color 0.6s ease",
      }}>
        {LABELS[state]}
      </div>

      {/* ── Live transcript / last reply caption ── */}
      <div style={{
        minHeight: 48, marginBottom: 20,
        maxWidth: 480, width: "90%",
        textAlign: "center",
        transition: "opacity 0.4s ease",
        opacity: (transcript || (state === "speaking" && lastReply)) ? 1 : 0,
      }}>
        {state === "listening" && transcript && (
          <div style={{
            color: "#e2e8f0", fontSize: 15, lineHeight: "1.5",
            background: "rgba(14,165,233,0.12)",
            border: "1px solid rgba(14,165,233,0.25)",
            borderRadius: 14, padding: "8px 16px",
            fontStyle: "italic",
          }}>
            "{transcript}"
          </div>
        )}
        {state === "speaking" && lastReply && (
          <div style={{
            color: "#e2e8f0", fontSize: 14, lineHeight: "1.55",
            background: "rgba(16,185,129,0.1)",
            border: "1px solid rgba(16,185,129,0.2)",
            borderRadius: 14, padding: "8px 16px",
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical" as const,
            overflow: "hidden",
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
        style={{
          width: 64, height: 64, borderRadius: "50%",
          background: state === "listening"
            ? `linear-gradient(135deg, ${c.primary}, ${c.secondary})`
            : "rgba(255,255,255,0.07)",
          border: `2px solid ${state === "listening" ? c.primary : "rgba(255,255,255,0.12)"}`,
          cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: state === "listening" ? `0 0 24px ${c.primary}88` : "none",
          transition: "all 0.3s ease",
          marginBottom: 12,
        }}
      >
        <svg viewBox="0 0 24 24" style={{ width: 26, height: 26, fill: state === "listening" ? "white" : "rgba(255,255,255,0.6)" }}>
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
        </svg>
      </button>

      <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 11, letterSpacing: 2, marginBottom: 8 }}>
        {state === "listening" ? "SUELTA PARA ENVIAR" : "TOCA PARA HABLAR"}
      </div>

      {/* ── Chat panel — slide up from bottom ── */}
      <div style={{
        position: "fixed",
        bottom: showChat ? 0 : "-100%",
        left: 0, right: 0,
        height: "55vh",
        background: "rgba(9,9,11,0.96)",
        backdropFilter: "blur(24px)",
        borderTop: `1px solid ${c.primary}33`,
        borderRadius: "24px 24px 0 0",
        display: "flex", flexDirection: "column",
        transition: "bottom 0.4s cubic-bezier(0.32,0.72,0,1), border-color 0.6s ease",
        zIndex: 40,
      }}>
        {/* Drag handle */}
        <div style={{
          width: 40, height: 4, borderRadius: 2,
          background: "rgba(255,255,255,0.15)",
          margin: "12px auto 4px",
          flexShrink: 0,
        }} />

        {/* Messages */}
        <div style={{
          flex: 1, overflowY: "auto",
          padding: "12px 20px",
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          {messages.map((msg, i) => (
            <div key={i} style={{
              maxWidth: "78%",
              padding: "10px 16px",
              borderRadius: msg.sender === "bot" ? "16px 16px 16px 4px" : "16px 16px 4px 16px",
              alignSelf: msg.sender === "bot" ? "flex-start" : "flex-end",
              background: msg.sender === "bot"
                ? `${c.primary}18`
                : `linear-gradient(135deg, ${c.primary}, ${c.secondary})`,
              border: msg.sender === "bot" ? `1px solid ${c.primary}28` : "none",
              color: "#f8fafc",
              fontSize: 14,
              lineHeight: "1.55",
              transition: "background 0.6s ease, border-color 0.6s ease",
            }}
              dangerouslySetInnerHTML={{ __html: msg.text }}
            />
          ))}
          {state === "thinking" && (
            <div style={{
              alignSelf: "flex-start",
              background: `${c.primary}18`,
              border: `1px solid ${c.primary}28`,
              borderRadius: "16px 16px 16px 4px",
              padding: "12px 16px",
              display: "flex", gap: 5, alignItems: "center",
            }}>
              {[0, 0.2, 0.4].map((d, i) => (
                <div key={i} style={{
                  width: 7, height: 7, background: c.primary, borderRadius: "50%",
                  animation: `bounce 1.2s ease-in-out ${d}s infinite`,
                }} />
              ))}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Text input */}
        <div style={{
          padding: "12px 16px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "flex", gap: 10,
          flexShrink: 0,
        }}>
          <input
            type="text"
            placeholder="Escribe un mensaje..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && sendMessage(input)}
            disabled={state === "thinking"}
            style={{
              flex: 1,
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 12, padding: "10px 16px",
              color: "#f8fafc", fontSize: 14, outline: "none",
              fontFamily: "inherit",
            }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={state === "thinking" || !input.trim()}
            style={{
              width: 44, height: 44, borderRadius: 12, flexShrink: 0,
              background: state === "thinking" || !input.trim()
                ? "rgba(139,92,246,0.25)"
                : `linear-gradient(135deg, ${c.primary}, ${c.secondary})`,
              border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background 0.3s ease",
            }}
          >
            <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, fill: "white", marginLeft: 2 }}>
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { overflow: hidden; background: #07070a; }

        @keyframes breathe {
          0%, 100% { transform: scale(1);   opacity: 0.85; }
          50%       { transform: scale(1.06); opacity: 1; }
        }
        @keyframes orbActive {
          0%, 100% { transform: scale(1);    opacity: 1; }
          50%       { transform: scale(1.08); opacity: 0.9; }
        }
        @keyframes ringIdle {
          0%, 100% { transform: scale(1);    opacity: 0.4; }
          50%       { transform: scale(1.04); opacity: 0.6; }
        }
        @keyframes ringPulse {
          0%   { transform: scale(1);    opacity: 0.7; }
          60%  { transform: scale(1.15); opacity: 0.2; }
          100% { transform: scale(1.22); opacity: 0; }
        }
        @keyframes glowPulse {
          0%, 100% { transform: scale(1);    opacity: 0.7; }
          50%       { transform: scale(1.2);  opacity: 1; }
        }
        @keyframes dotPulse {
          0%, 100% { transform: scale(1);   opacity: 0.9; }
          50%       { transform: scale(1.5); opacity: 0.5; }
        }
        @keyframes dotBreath {
          0%, 100% { transform: scale(1);    opacity: 0.45; }
          50%       { transform: scale(1.25); opacity: 0.7; }
        }
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(-5px); }
        }

        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(139,92,246,0.3); border-radius: 2px; }
        input::placeholder { color: rgba(255,255,255,0.25); }
        input:focus { border-color: rgba(139,92,246,0.5) !important; }
      `}</style>
    </div>
  );
}
