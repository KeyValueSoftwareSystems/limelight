"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

interface Message {
  role: "user" | "system";
  text: string;
  ts: number;
}

interface ConversationProps {
  /** When the user submits a plain-English edit */
  onSubmit: (text: string) => void;
}

/**
 * The "seam" for plain-English editing. Users type instructions like
 * "make the chorus more blue" and the system echoes back what it did.
 *
 * This component is the plumbing — the AI/NLP integration sits upstream
 * and calls addMessage() or passes messages via props.
 */
export function Conversation({ onSubmit }: ConversationProps) {
  const [messages, setMessages] = useState<Message[]>(() => [
    { role: "system", text: 'Describe what you want changed \u2014 for example, \u201cmake the chorus bluer\u201d or \u201cadd a strobe on the drop\u201d.', ts: Date.now() },
  ]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setMessages((prev) => [...prev, { role: "user", text, ts: Date.now() }]);
    setInput("");
    onSubmit(text);
    /* The parent will eventually call back with a system message via setMessages */
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        { role: "system", text: `Got it — "${text}". (Natural-language editing is a future feature; for now, use the effect palette.)`, ts: Date.now() },
      ]);
    }, 600);
  }, [input, onSubmit]);

  return (
    <div className="flex flex-col gap-[var(--spacing-s2)] px-[var(--spacing-s6)] py-[var(--spacing-s3)] border-t border-solid border-line">
      <div className="label">Plain English</div>
      <div
        ref={scrollRef}
        className="flex flex-col gap-[6px] max-h-[120px] overflow-y-auto text-[length:var(--text-sm)]"
      >
        {messages.map((m, i) => (
          <div
            key={i}
            className={`leading-[1.5] ${m.role === "user" ? "text-ink" : "text-dim"}`}
          >
            {m.role === "user" ? "→ " : ""}
            {m.text}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-[var(--spacing-s2)]">
        <Input
          placeholder="describe a change…"
          wide
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
        />
        <Button variant="link" onClick={handleSend}>
          Go
        </Button>
      </div>
    </div>
  );
}
