"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";

export interface ChatChange {
  label: string;
}

export interface ChatTurn {
  id: string;
  who: "you" | "limelight";
  at: string;
  text: string;
  changes?: ChatChange[];
  undoable?: boolean;
}

const clock = () =>
  new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function ChatPanel() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    const now = clock();
    setTurns((t) => [
      ...t,
      { id: `${Date.now()}-you`, who: "you", at: now, text },
      {
        id: `${Date.now()}-ll`,
        who: "limelight",
        at: now,
        text: "Plain-English editing isn't connected yet — nothing was changed. Place effects on the timeline in the meantime.",
      },
    ]);
    setDraft("");
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex-none px-[16px] py-[12px] border-b border-solid border-white/[0.05]">
        <span className="text-[12px] font-semibold tracking-[0.01em] text-ink-dim">Chat</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-[16px] py-[16px] flex flex-col gap-[16px]">
        {turns.length === 0 && (
          <p className="text-[12px] text-ink-dimmer leading-[1.6] m-0">
            Describe a change in plain English — &ldquo;warmer in the chorus&rdquo;,
            &ldquo;calmer intro&rdquo;. This feature is not connected yet.
          </p>
        )}

        {turns.map((t) => (
          <div key={t.id} className="flex flex-col gap-[5px]">
            <div className="flex items-baseline gap-[7px]">
              <span className="text-[11px] font-medium text-ink">{t.who === "you" ? "You" : "Limelight"}</span>
              <span className="mono text-[9px] text-ink-dimmer">{t.at}</span>
            </div>

            {t.who === "you" ? (
              <div className="self-end max-w-[86%] rounded-[10px] px-[12px] py-[8px] text-[12px] text-ink leading-[1.5]"
                style={{ background: "linear-gradient(135deg, rgba(255, 217, 163,0.12) 0%, rgba(255, 217, 163,0.08) 100%)", border: "1px solid rgba(255, 217, 163,0.15)" }}>
                {t.text}
              </div>
            ) : (
              <div className="text-[12px] text-ink-dim leading-[1.5]">{t.text}</div>
            )}

            {t.changes && t.changes.length > 0 && (
              <div className="flex flex-wrap gap-[6px] mt-[2px]">
                {t.changes.map((c) => (
                  <span
                    key={c.label}
                    className="px-[9px] py-[3px] rounded-full border border-solid border-white/[0.08] text-[10px] text-ink-dim bg-white/[0.02]"
                  >
                    {c.label}
                  </span>
                ))}
                {t.undoable && (
                  <button
                    type="button"
                    className="px-[9px] py-[3px] rounded-full border border-solid border-white/[0.08] text-[10px] text-ink-dim hover:text-ink hover:border-white/[0.15] hover:bg-white/[0.04] bg-transparent cursor-pointer transition-all duration-200"
                  >
                    Undo
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="flex-none p-[12px] border-t border-solid border-white/[0.05]">
        <div className="relative">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder="Describe a change…"
            className="w-full resize-none rounded-[var(--radius-sm)] bg-white/[0.03] border border-solid border-white/[0.06] outline-none focus:border-accent/40 focus:bg-white/[0.05] focus:shadow-[0_0_0_2px_rgba(245,158,11,0.06)] text-[12px] text-ink px-[12px] py-[9px] pr-[40px] transition-all duration-200 placeholder:text-ink-dimmer"
          />
          <button
            type="button"
            onClick={send}
            disabled={!draft.trim()}
            aria-label="Send"
            className="absolute right-[8px] bottom-[10px] w-[28px] h-[28px] rounded-[var(--radius-sm)] border-0 cursor-pointer disabled:cursor-default disabled:opacity-30 flex items-center justify-center transition-all duration-200 hover:brightness-110"
            style={{ background: "var(--lit)", color: "var(--lit-ink)" }}
          >
            <Send size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
