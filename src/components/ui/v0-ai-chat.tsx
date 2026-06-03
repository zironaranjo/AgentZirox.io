"use client";

import { useEffect, useRef, useCallback, useState, type ReactNode } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  ArrowUpIcon,
  Clapperboard,
  ListTodo,
  Newspaper,
  Search,
  Share2,
} from "lucide-react";

interface UseAutoResizeTextareaProps {
  minHeight: number;
  maxHeight?: number;
}

function useAutoResizeTextarea({
  minHeight,
  maxHeight,
}: UseAutoResizeTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(
    (reset?: boolean) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      if (reset) {
        textarea.style.height = `${minHeight}px`;
        return;
      }

      textarea.style.height = `${minHeight}px`;
      const newHeight = Math.max(
        minHeight,
        Math.min(
          textarea.scrollHeight,
          maxHeight ?? Number.POSITIVE_INFINITY
        )
      );
      textarea.style.height = `${newHeight}px`;
    },
    [minHeight, maxHeight]
  );

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) textarea.style.height = `${minHeight}px`;
  }, [minHeight]);

  useEffect(() => {
    const handleResize = () => adjustHeight();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [adjustHeight]);

  return { textareaRef, adjustHeight };
}

export type ZiroChatSuggestion = {
  icon: ReactNode;
  label: string;
  prompt: string;
};

const DEFAULT_SUGGESTIONS: ZiroChatSuggestion[] = [
  {
    icon: <Newspaper className="w-4 h-4" />,
    label: "Infografía IA",
    prompt:
      "Crea la infografía diaria de noticias IA con NotebookLM y proponla en LinkedIn",
  },
  {
    icon: <ListTodo className="w-4 h-4" />,
    label: "Pendientes",
    prompt: "lista pendientes",
  },
  {
    icon: <Search className="w-4 h-4" />,
    label: "Buscar noticias",
    prompt: "Busca las últimas noticias de inteligencia artificial de hoy",
  },
  {
    icon: <Share2 className="w-4 h-4" />,
    label: "LinkedIn",
    prompt: "Propón un post profesional en LinkedIn sobre IA",
  },
  {
    icon: <Clapperboard className="w-4 h-4" />,
    label: "Vídeo corto",
    prompt: "Crea un vídeo corto para TikTok sobre un tema de IA",
  },
];

export type ZiroChatInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  suggestions?: ZiroChatSuggestion[];
  showSuggestions?: boolean;
  className?: string;
};

export function ZiroChatInput({
  value,
  onChange,
  onSend,
  disabled = false,
  placeholder = "Escribe un mensaje a Ziro…",
  suggestions = DEFAULT_SUGGESTIONS,
  showSuggestions = true,
  className,
}: ZiroChatInputProps) {
  const { textareaRef, adjustHeight } = useAutoResizeTextarea({
    minHeight: 52,
    maxHeight: 160,
  });

  const submit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    adjustHeight(true);
  }, [value, disabled, onSend, adjustHeight]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className={cn("w-full", className)}>
      <div
        className={cn(
          "relative rounded-2xl border transition-colors",
          "bg-[rgba(255,255,255,0.04)] border-[rgba(255,255,255,0.10)]",
          "focus-within:border-violet-500/50 focus-within:shadow-[0_0_0_1px_rgba(139,92,246,0.25)]"
        )}
      >
        <div className="overflow-y-auto">
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              adjustHeight();
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className={cn(
              "w-full px-4 py-3",
              "resize-none min-h-[52px]",
              "bg-transparent border-none",
              "text-[#f1f5f9] text-sm leading-relaxed",
              "focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0",
              "placeholder:text-zinc-500 placeholder:text-sm",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
            style={{ overflow: "hidden" }}
          />
        </div>

        <div className="flex items-center justify-end px-3 pb-3 pt-0">
          <button
            type="button"
            onClick={submit}
            disabled={disabled || !value.trim()}
            aria-label="Enviar mensaje"
            className={cn(
              "p-2 rounded-full transition-all duration-200 border",
              value.trim() && !disabled
                ? "bg-white text-black border-white hover:bg-violet-50"
                : "bg-transparent text-zinc-500 border-zinc-700/80 cursor-default"
            )}
          >
            <ArrowUpIcon
              className={cn(
                "w-4 h-4",
                value.trim() && !disabled ? "text-black" : "text-zinc-500"
              )}
            />
          </button>
        </div>
      </div>

      {showSuggestions && suggestions.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-2 mt-3 px-0.5">
          {suggestions.map((s) => (
            <SuggestionChip
              key={s.label}
              icon={s.icon}
              label={s.label}
              disabled={disabled}
              onClick={() => onSend(s.prompt)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Demo standalone del diseño 21st (sin cablear al agente). */
export function VercelV0Chat() {
  const [value, setValue] = useState("");
  return (
    <div className="flex flex-col items-center w-full max-w-4xl mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-bold text-white text-center">
        ¿En qué puedo ayudarte?
      </h1>
      <ZiroChatInput
        value={value}
        onChange={setValue}
        onSend={(t) => {
          setValue("");
          console.log("demo send:", t);
        }}
      />
    </div>
  );
}

function SuggestionChip({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs",
        "bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)]",
        "text-zinc-400 hover:text-violet-200 hover:border-violet-500/40 hover:bg-violet-500/10",
        "transition-colors disabled:opacity-40 disabled:pointer-events-none"
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
