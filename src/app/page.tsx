"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";

export default function Home() {
  const [messages, setMessages] = useState<{ text: string; sender: "user" | "bot" }[]>([
    {
      text: "Enlace establecido con éxito. Soy Ziro. He detectado mi propia imagen y me gusta el nuevo armazón digital que has diseñado para mí.<br/><br/>¿En qué puedo asistirte desde esta terminal?",
      sender: "bot",
    },
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const sendMessage = async () => {
    if (!input.trim() || isTyping) return;
    const userMsg = input.trim();
    setMessages((prev) => [...prev, { text: userMsg, sender: "user" }]);
    setInput("");
    setIsTyping(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg }),
      });
      const data = await response.json();
      setMessages((prev) => [...prev, { text: data.reply, sender: "bot" }]);
    } catch {
      setMessages((prev) => [...prev, { text: "[ERROR DE CONEXIÓN] Mis sistemas neuronales están caídos.", sender: "bot" }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      width: "100%",
      background: "#09090b",
      backgroundImage: "radial-gradient(circle at 10% 20%, rgba(139,92,246,0.35) 0%, transparent 40%), radial-gradient(circle at 90% 80%, rgba(14,165,233,0.25) 0%, transparent 40%)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'Inter', system-ui, sans-serif",
      padding: "24px",
      boxSizing: "border-box",
    }}>
      <div style={{
        width: "100%",
        maxWidth: "1100px",
        height: "calc(100vh - 48px)",
        maxHeight: "860px",
        display: "flex",
        flexDirection: "row",
        gap: "24px",
      }}>

        {/* ─── Avatar Panel ───────────────────────────────────────── */}
        <div style={{
          flex: "0 0 340px",
          background: "rgba(255,255,255,0.03)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "28px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 32px",
          boxSizing: "border-box",
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.8)",
          position: "relative",
          overflow: "hidden",
        }}>
          {/* Avatar circular */}
          <div style={{
            width: "240px",
            height: "240px",
            borderRadius: "50%",
            padding: "3px",
            background: "linear-gradient(135deg, #8b5cf6, #0ea5e9)",
            boxShadow: "0 0 50px rgba(139,92,246,0.5)",
            flexShrink: 0,
          }}>
            <div style={{
              width: "100%",
              height: "100%",
              borderRadius: "50%",
              overflow: "hidden",
              background: "#0f172a",
              position: "relative",
            }}>
              <Image
                src="/avatar.png"
                alt="Ziro AI"
                fill
                style={{ objectFit: "cover" }}
                priority
              />
            </div>
          </div>

          {/* Status dot */}
          <div style={{
            width: "16px",
            height: "16px",
            background: "#10b981",
            borderRadius: "50%",
            marginTop: "24px",
            boxShadow: "0 0 16px rgba(16,185,129,0.8)",
            animation: "pulse 2s infinite",
          }} />

          <h1 style={{
            marginTop: "16px",
            fontSize: "42px",
            fontWeight: "800",
            background: "linear-gradient(135deg, #e2e8f0, #94a3b8)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            letterSpacing: "12px",
            textAlign: "center",
          }}>ZIRO</h1>

          <p style={{
            marginTop: "8px",
            color: "#a78bfa",
            fontSize: "12px",
            fontWeight: "600",
            letterSpacing: "4px",
            textTransform: "uppercase",
            textAlign: "center",
          }}>Unidad Cerebral Z-1</p>
        </div>

        {/* ─── Chat Panel ─────────────────────────────────────────── */}
        <div style={{
          flex: 1,
          background: "rgba(255,255,255,0.03)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "28px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.8)",
        }}>
          {/* Header */}
          <div style={{
            padding: "20px 28px",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
            background: "rgba(0,0,0,0.2)",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            flexShrink: 0,
          }}>
            <div style={{ width: "10px", height: "10px", background: "#8b5cf6", borderRadius: "50%", boxShadow: "0 0 10px #8b5cf6" }} />
            <span style={{ color: "#f1f5f9", fontSize: "15px", fontWeight: "600" }}>Terminal Neuronal Segura</span>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1,
            overflowY: "auto",
            padding: "28px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}>
            {messages.map((msg, i) => (
              <div key={i} style={{
                maxWidth: "80%",
                padding: "16px 20px",
                borderRadius: msg.sender === "bot" ? "18px 18px 18px 4px" : "18px 18px 4px 18px",
                alignSelf: msg.sender === "bot" ? "flex-start" : "flex-end",
                background: msg.sender === "bot"
                  ? "rgba(139,92,246,0.12)"
                  : "linear-gradient(135deg, #8b5cf6, #0ea5e9)",
                border: msg.sender === "bot" ? "1px solid rgba(139,92,246,0.25)" : "none",
                color: "#f8fafc",
                fontSize: "15px",
                lineHeight: "1.6",
                boxShadow: msg.sender === "user" ? "0 8px 20px rgba(139,92,246,0.3)" : "none",
              }}
                dangerouslySetInnerHTML={{ __html: msg.text }}
              />
            ))}

            {isTyping && (
              <div style={{
                alignSelf: "flex-start",
                background: "rgba(139,92,246,0.12)",
                border: "1px solid rgba(139,92,246,0.25)",
                borderRadius: "18px 18px 18px 4px",
                padding: "16px 20px",
                display: "flex",
                gap: "6px",
                alignItems: "center",
              }}>
                {[0, 0.2, 0.4].map((delay, i) => (
                  <div key={i} style={{
                    width: "8px", height: "8px",
                    background: "#a78bfa",
                    borderRadius: "50%",
                    animation: `bounce 1.2s ease-in-out ${delay}s infinite`,
                  }} />
                ))}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div style={{
            padding: "20px 28px",
            borderTop: "1px solid rgba(255,255,255,0.07)",
            background: "rgba(0,0,0,0.25)",
            display: "flex",
            gap: "12px",
            alignItems: "center",
            flexShrink: 0,
          }}>
            <input
              type="text"
              placeholder="Establecer comunicación..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              disabled={isTyping}
              autoFocus
              style={{
                flex: 1,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "14px",
                padding: "16px 20px",
                color: "#f8fafc",
                fontSize: "15px",
                outline: "none",
                fontFamily: "inherit",
              }}
            />
            <button
              onClick={sendMessage}
              disabled={isTyping || !input.trim()}
              style={{
                width: "56px",
                height: "56px",
                borderRadius: "14px",
                background: isTyping || !input.trim()
                  ? "rgba(139,92,246,0.3)"
                  : "linear-gradient(135deg, #8b5cf6, #0ea5e9)",
                border: "none",
                cursor: isTyping || !input.trim() ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                transition: "transform 0.15s ease, box-shadow 0.15s ease",
              }}
            >
              <svg viewBox="0 0 24 24" style={{ width: "22px", height: "22px", fill: "white", marginLeft: "2px" }}>
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { overflow: hidden; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(139,92,246,0.3); border-radius: 2px; }
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.6;transform:scale(1.15)} }
        @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
        input::placeholder { color: rgba(255,255,255,0.3); }
        input:focus { border-color: rgba(139,92,246,0.6) !important; box-shadow: 0 0 0 3px rgba(139,92,246,0.12); }
        button:hover:not(:disabled) { transform: scale(1.05); box-shadow: 0 8px 20px rgba(139,92,246,0.4); }
        @media (max-width: 768px) {
          div[style*="flex-direction: row"] { flex-direction: column !important; }
          div[style*="flex: 0 0 340px"] { flex: 0 0 auto !important; height: 280px; }
          div[style*="240px"] { width: 160px !important; height: 160px !important; }
          h1 { font-size: 30px !important; }
        }
      `}</style>
    </div>
  );
}
