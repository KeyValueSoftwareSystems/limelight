"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
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
        className="flex items-center gap-[6px] h-[34px] pl-[4px] pr-[10px] rounded-full border-0 bg-transparent cursor-pointer hover:bg-white/[0.04] transition-all duration-200"
      >
        <span className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-[10px] font-bold flex-none"
          style={{ background: "var(--key-face)", color: "var(--ink)", boxShadow: "var(--key-edge), var(--key-lift)" }}>
          {initials || <User size={12} />}
        </span>
        <ChevronDown size={11} className="text-ink-dimmer" />
      </button>

      {open && (
        <div
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-[260px] rounded-[var(--radius-md)] p-[16px] animate-scale-in"
          style={{ background: "linear-gradient(180deg, #1A1B2E 0%, #12131F 100%)", boxShadow: "var(--elev-popover)" }}
        >
          <label className="block text-[11px] font-semibold text-ink-dimmer tracking-[0.03em] mb-[8px]">Your name</label>
          <input
            ref={inputRef}
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setOpen(false); }}
            placeholder="Enter your name"
            className="w-full h-[36px] px-[12px] rounded-[var(--radius-sm)] border border-solid border-white/10 bg-white/[0.04] text-[14px] text-ink outline-none focus:border-accent/60 focus:bg-white/[0.06] transition-all duration-200"
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
      className="relative w-[24px] h-[24px] rounded-[7px] flex-none overflow-hidden"
      style={{ background: "#03070E", boxShadow: "inset 0 0 0 1px rgba(59,227,255,0.22), 0 0 14px -4px var(--accent-glow)" }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden className="absolute inset-0">
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
    <header className="flex-none flex items-center gap-[16px] px-[16px] h-[52px] glass border-b border-solid border-white/[0.05] z-40">
      <Link
        href="/shows"
        aria-label="Limelight \u2014 your shows"
        className="group flex items-center gap-[9px] mr-[6px] h-[34px] pl-[5px] pr-[10px] -ml-[5px] rounded-[9px] no-underline transition-colors duration-200 hover:bg-white/[0.04]"
      >
        <Beam />
        <span className="text-[16px] font-semibold tracking-[-0.021em] text-ink transition-colors duration-200">
          Limelight
        </span>
      </Link>

      <TabNav />

      <span className="flex-1" />

      {role === "venue" && <RigControl onToggle={onRigToggle} />}

      <RoleToggle />

      <IdentityControl />
    </header>
  );
}
