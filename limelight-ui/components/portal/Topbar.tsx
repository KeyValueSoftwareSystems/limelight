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
        className="flex items-center gap-[6px] h-[34px] pl-[4px] pr-[10px] rounded-full border-0 bg-transparent cursor-pointer hover:bg-white/[0.04] transition-all duration-[var(--dur-state)]"
      >
        <span className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-[10px] font-bold flex-none"
          style={{ background: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)", color: "#0C0D12" }}>
          {initials || <User size={12} />}
        </span>
        <ChevronDown size={11} className="text-ink-dimmer" />
      </button>

      {open && (
        <div
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-[260px] rounded-[var(--radius-md)] p-[16px] animate-scale-in"
          style={{ background: "linear-gradient(180deg, #1C1D28 0%, #14151D 100%)", boxShadow: "var(--elev-popover)" }}
        >
          <label className="block text-[11px] font-semibold text-ink-dimmer tracking-[0.03em] mb-[8px]">Your name</label>
          <input
            ref={inputRef}
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setOpen(false); }}
            placeholder="Enter your name"
            className="w-full h-[36px] px-[12px] rounded-[var(--radius-sm)] border border-solid border-white/10 bg-white/[0.04] text-[14px] text-ink outline-none focus:border-accent/60 focus:bg-white/[0.06] transition-all duration-[var(--dur-state)]"
          />
          <p className="text-[11px] text-ink-dimmer mt-[10px] m-0 leading-[1.6]">
            This name is attached to every show you save.
          </p>
        </div>
      )}
    </div>
  );
}

export function Topbar({ onRigToggle }: TopbarProps) {
  const role = usePortalStore((s) => s.role);

  return (
    <header className="flex-none flex items-center gap-[16px] px-[16px] h-[52px] glass border-b border-solid border-white/[0.06] z-40">
      <div className="flex items-center gap-[6px] mr-[6px]">
        <div className="w-[24px] h-[24px] rounded-[6px] flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#0C0D12">
            <path d="M12 2L2 7l10 5 10-5-10-5z" opacity="0.6" />
            <path d="M2 17l10 5 10-5M2 12l10 5 10-5" stroke="#0C0D12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        </div>
        <span className="text-[15px] font-bold tracking-[-0.02em] text-ink">
          Limelight
        </span>
      </div>

      <TabNav />

      <span className="flex-1" />

      {role === "venue" && <RigControl onToggle={onRigToggle} />}

      <div className="w-px h-[20px] bg-white/[0.06] flex-none" />

      <IdentityControl />

      <RoleToggle />
    </header>
  );
}
