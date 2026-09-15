"use client";

import { useEffect, useRef, useState } from "react";

/* The conversation rail. What a creator types here is meant to become edits —
   that needs a model on the other end, which does not exist yet, so the panel
   is honest about it rather than faking a reply. */

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
      <div className="flex-none px-[var(--spacing-s4)] py-[var(--spacing-s3)] border-b border-solid border-line">
        <span className="label">Conversation</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-[var(--spacing-s4)] py-[var(--spacing-s4)] flex flex-col gap-[var(--spacing-s4)]">
        {turns.length === 0 && (
          <p className="text-[11px] text-ink-dimmer leading-[16px]">
            Ask for a change in plain English — &ldquo;warmer in the chorus&rdquo;,
            &ldquo;calmer intro&rdquo;. Not wired up yet.
          </p>
        )}

        {turns.map((t) => (
          <div key={t.id} className="flex flex-col gap-[5px]">
            <div className="flex items-baseline gap-[7px]">
              <span className="text-[11px] text-ink">{t.who === "you" ? "You" : "Limelight"}</span>
              <span className="mono text-[9px] text-ink-dimmer">{t.at}</span>
            </div>

            {t.who === "you" ? (
              <div className="self-end max-w-[86%] rounded-[8px] bg-accent-soft border border-solid border-line px-[10px] py-[7px] text-[12px] text-ink leading-[17px]">
                {t.text}
              </div>
            ) : (
              <div className="text-[12px] text-ink-dim leading-[17px]">{t.text}</div>
            )}

            {t.changes && t.changes.length > 0 && (
              <div className="flex flex-wrap gap-[6px] mt-[2px]">
                {t.changes.map((c) => (
                  <span
                    key={c.label}
                    className="px-[9px] py-[3px] rounded-full border border-solid border-line text-[10px] text-ink-dim"
                  >
                    {c.label}
                  </span>
                ))}
                {t.undoable && (
                  <button
                    type="button"
                    className="px-[9px] py-[3px] rounded-full border border-solid border-line text-[10px] text-ink-dim hover:text-ink hover:border-line-strong bg-transparent cursor-pointer transition-colors duration-[var(--dur-state)]"
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

      <div className="flex-none p-[var(--spacing-s3)] border-t border-solid border-line">
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
            placeholder="say what you'd change…"
            className="w-full resize-none rounded-[7px] bg-bg-sunken border border-solid border-line-strong outline-none focus:border-ink-dimmer text-[12px] text-ink px-[10px] py-[8px] pr-[38px] transition-colors duration-[var(--dur-state)]"
          />
          <button
            type="button"
            onClick={send}
            disabled={!draft.trim()}
            aria-label="Send"
            className="absolute right-[7px] bottom-[9px] w-[26px] h-[26px] rounded-[5px] border-0 cursor-pointer disabled:cursor-default disabled:opacity-30 text-[12px] transition-opacity duration-[var(--dur-state)]"
            style={{ background: "var(--accent)", color: "var(--bg)" }}
          >
            <span aria-hidden>➤</span>
          </button>
        </div>
      </div>
    </div>
  );
}
