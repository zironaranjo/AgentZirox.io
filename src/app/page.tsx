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
    if (!input.trim()) return;

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
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          text: "[ERROR DE CONEXIÓN] Mis sistemas neuronales centrales están caídos en este momento.",
          sender: "bot",
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="w-full flex justify-center items-center min-h-screen p-4">
      <div className="w-full max-w-6xl h-[85vh] flex flex-col md:flex-row gap-8 z-10">
        
        {/* Avatar Section */}
        <div className="flex-1 glass-card rounded-[30px] p-10 flex flex-col items-center justify-center relative overflow-hidden animate-[float_8s_ease-in-out_infinite]">
          <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
          
          <div className="relative w-[280px] h-[280px] rounded-full p-1.5 bg-gradient-to-br from-[#8b5cf6] to-[#0ea5e9] shadow-[0_0_40px_rgba(139,92,246,0.4)] transition-transform duration-300 hover:scale-[1.02] hover:shadow-[0_0_60px_rgba(139,92,246,0.4)] md:w-[240px] md:h-[240px]">
            <div className="w-full h-full rounded-full overflow-hidden border-[6px] border-[#0f172a] bg-[#0f172a] relative">
              <Image 
                src="/avatar.png" 
                alt="Ziro AI" 
                fill
                className="object-cover"
                priority
              />
            </div>
            
            {/* Status Dot */}
            <div className="absolute bottom-5 right-5 w-[22px] h-[22px] bg-[#10b981] rounded-full border-[4px] border-[#0f172a] shadow-[0_0_20px_rgba(16,185,129,0.8)] animate-[pulse_2s_infinite]" />
          </div>

          <h1 className="mt-10 text-5xl font-extrabold bg-gradient-to-r from-slate-200 to-slate-400 bg-clip-text text-transparent tracking-widest text-center md:text-4xl md:mt-8">
            ZIRO
          </h1>
          <p className="mt-2 text-[#8b5cf6] font-semibold text-center uppercase tracking-[4px]">
            Unidad Cerebral Z-1
          </p>
        </div>

        {/* Chat Section */}
        <div className="flex-[1.5] flex flex-col glass-card rounded-[30px] overflow-hidden">
          <div className="p-6 border-b border-[rgba(255,255,255,0.08)] bg-black/20 flex items-center">
            <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-3">
              <span className="inline-block w-2.5 h-2.5 bg-[#8b5cf6] rounded-full shadow-[0_0_10px_#8b5cf6]"></span>
              Terminal Neuronal Segura
            </h2>
          </div>

          <div className="flex-1 p-8 overflow-y-auto flex flex-col gap-5 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`max-w-[85%] p-5 rounded-2xl leading-relaxed text-base animate-[slideUp_0.4s_cubic-bezier(0.16,1,0.3,1)_forwards] ${
                  msg.sender === "bot"
                    ? "self-start bg-[#8b5cf6]/15 border border-[#8b5cf6]/30 rounded-bl-sm text-slate-50 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1)]"
                    : "self-end bg-gradient-to-br from-[#8b5cf6] to-[#0ea5e9] text-white rounded-br-sm shadow-[0_10px_20px_-5px_rgba(139,92,246,0.4)]"
                }`}
                dangerouslySetInnerHTML={{ __html: msg.text }}
              />
            ))}
            
            {isTyping && (
              <div className="self-start bg-[#8b5cf6]/15 border border-[#8b5cf6]/30 px-6 py-5 rounded-2xl rounded-bl-sm flex gap-1.5">
                <span className="w-2 h-2 bg-slate-50 rounded-full animate-[bounce_1.4s_infinite_ease-in-out_both] delay-[-0.32s]"></span>
                <span className="w-2 h-2 bg-slate-50 rounded-full animate-[bounce_1.4s_infinite_ease-in-out_both] delay-[-0.16s]"></span>
                <span className="w-2 h-2 bg-slate-50 rounded-full animate-[bounce_1.4s_infinite_ease-in-out_both]"></span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-6 bg-black/30 border-t border-[rgba(255,255,255,0.08)] flex gap-4 items-center">
            <input
              type="text"
              className="flex-1 bg-white/[0.03] border border-white/10 rounded-2xl px-6 py-5 text-slate-50 text-base outline-none transition-all focus:border-[#8b5cf6] focus:bg-white/5 focus:shadow-[0_0_0_4px_rgba(139,92,246,0.1)] placeholder:text-white/30"
              placeholder="Establecer comunicación..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              disabled={isTyping}
              autoFocus
            />
            <button
              onClick={sendMessage}
              disabled={isTyping || !input.trim()}
              className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#8b5cf6] to-[#0ea5e9] flex justify-center items-center cursor-pointer transition-all hover:scale-105 hover:shadow-[0_10px_25px_-5px_#8b5cf6] disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed"
            >
              <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white ml-1">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
