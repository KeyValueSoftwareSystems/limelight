"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { User, ChevronDown } from "lucide-react";
import { TabNav } from "./TabNav";
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
        className="flex items-center gap-[6px] h-[36px] pl-[4px] pr-[10px] rounded-full border-0 bg-transparent cursor-pointer hover:bg-white/[0.04] transition-all duration-200"
      >
        <span className="w-[28px] h-[28px] rounded-full flex items-center justify-center text-[10.5px] font-bold flex-none"
          style={{ background: "var(--mat-raised)", color: "var(--ink)", boxShadow: "var(--mat-raised-edge), var(--mat-raised-shadow)" }}>
          {initials || <User size={12} />}
        </span>
        <ChevronDown size={11} className="text-ink-dimmer" />
      </button>

      {open && (
        <div
          className="liquid absolute right-0 top-[calc(100%+8px)] z-50 w-[260px] rounded-[var(--radius-lg)] p-[16px] animate-scale-in"
        >
          <label className="block text-[11px] font-semibold text-ink-dimmer tracking-[0.03em] mb-[8px]">Your name</label>
          <input
            ref={inputRef}
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setOpen(false); }}
            placeholder="Enter your name"
            className="liquid-well w-full h-[var(--control-h)] px-[12px] rounded-[var(--radius-sm)] text-[13px] text-ink outline-none"
          />
          <p className="text-[11px] text-ink-dimmer mt-[10px] m-0 leading-[1.6]">
            Attached to every show you save.
          </p>
        </div>
      )}
    </div>
  );
}

function Beam() {
  return (
    <span
      className="relative w-[28px] h-[28px] rounded-[8px] flex-none overflow-hidden"
      style={{ background: "#03070E", boxShadow: "inset 0 0 0 1px rgba(59,227,255,0.22), 0 0 14px -4px var(--accent-glow)" }}
    >
      <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden className="absolute inset-0">
        <defs>
          <linearGradient id="lml-beam" x1="12" y1="7" x2="12" y2="22" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#8FF3FF" stopOpacity="0.92" />
            <stop offset="1" stopColor="#8FF3FF" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M12 7.5 L19 21.5 H5 Z" fill="url(#lml-beam)" />
        <rect x="8.5" y="3.5" width="7" height="4.2" rx="1.4" fill="#C9F9FF" />
      </svg>
    </span>
  );
}

export function Topbar({ onRigToggle }: TopbarProps) {
  const role = usePortalStore((s) => s.role);

  return (
    <header className="liquid liquid-flush flex-none flex items-center gap-[16px] px-[20px] h-[62px] z-40">
      <Link
        href="/shows"
        aria-label="Limelight \u2014 your shows"
        className="group flex items-center gap-[10px] mr-[10px] h-[38px] pl-[6px] pr-[12px] -ml-[6px] rounded-[10px] no-underline transition-colors duration-200 hover:bg-white/[0.04]"
      >
        <Beam />
        <span className="text-[17px] font-semibold tracking-[-0.022em] text-ink transition-colors duration-200">
          Limelight
        </span>
      </Link>

      <TabNav />

      <span className="flex-1" />

      {role === "venue" && <RigControl onToggle={onRigToggle} />}

      <IdentityControl />
    </header>
  );
}
