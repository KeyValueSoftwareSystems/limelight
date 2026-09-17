"use client";

import { useState, useRef, useEffect } from "react";
import { User, ChevronDown } from "lucide-react";
import { TabNav } from "./TabNav";
import { RoleToggle } from "./RoleToggle";
import { RigControl } from "./RigControl";
import { usePortalStore } from "@/store/portal";

interface TopbarProps {
  onRigToggle: () => void;
}

function IdentityControl() {
  const author = usePortalStore((s) => s.author);
  const setAuthor = usePortalStore((s) => s.setAuthor);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const close = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  const initials = author
    ? author.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
    : "";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-[6px] h-[32px] pl-[3px] pr-[8px] rounded-full border-0 bg-transparent cursor-pointer hover:bg-bg-raised transition-all duration-[var(--dur-state)]"
      >
        <span className="w-[26px] h-[26px] rounded-full bg-gradient-to-br from-accent/30 to-accent/10 border border-solid border-accent/20 flex items-center justify-center text-[10px] font-semibold text-accent flex-none">
          {initials || <User size={12} className="text-ink-dimmer" />}
        </span>
        <ChevronDown size={12} className="text-ink-dimmer" />
      </button>

      {open && (
        <div
          className="absolute right-0 top-[calc(100%+6px)] z-50 w-[240px] rounded-[var(--radius-md)] bg-bg-overlay p-[16px] animate-scale-in"
          style={{ boxShadow: "var(--elev-popover)" }}
        >
          <label className="block text-[11px] font-medium text-ink-dimmer mb-[6px]">Your name</label>
          <input
            ref={inputRef}
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setOpen(false); }}
            placeholder="Enter your name"
            className="w-full h-[34px] px-[12px] rounded-[var(--radius-sm)] border border-solid border-line-strong bg-bg-raised text-[13px] text-ink outline-none focus:border-accent transition-colors"
          />
          <p className="text-[11px] text-ink-dimmer mt-[8px] m-0 leading-[1.5]">
            Attached to shows you save.
          </p>
        </div>
      )}
    </div>
  );
}

export function Topbar({ onRigToggle }: TopbarProps) {
  const role = usePortalStore((s) => s.role);

  return (
    <header className="flex-none flex items-center gap-[16px] px-[16px] h-[48px] bg-bg/80 backdrop-blur-xl border-b border-solid border-line z-40">
      <div className="flex items-center gap-[3px] mr-[4px]">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-accent">
          <path d="M12 2L2 7l10 5 10-5-10-5z" fill="currentColor" opacity="0.3" />
          <path d="M2 17l10 5 10-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M2 12l10 5 10-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-[15px] font-bold tracking-[-0.01em] text-ink">
          Limelight
        </span>
      </div>

      <TabNav />

      <span className="flex-1" />

      {role === "venue" && <RigControl onToggle={onRigToggle} />}

      <div className="w-px h-[20px] bg-line flex-none" />

      <IdentityControl />

      <RoleToggle />
    </header>
  );
}
