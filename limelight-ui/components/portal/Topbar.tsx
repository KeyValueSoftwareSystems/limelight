"use client";

import { useState, useRef, useEffect } from "react";
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
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const initials = author
    ? author.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
    : "?";

  if (editing) {
    return (
      <div className="flex items-center gap-[8px]">
        <span className="w-[28px] h-[28px] rounded-full bg-accent/20 text-accent flex items-center justify-center text-[11px] font-medium flex-none">
          {initials}
        </span>
        <input
          ref={inputRef}
          type="text"
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditing(false); }}
          placeholder="Your name"
          className="h-[28px] w-[140px] px-[8px] rounded-[4px] border border-solid border-line-strong bg-bg-raised text-[13px] text-ink outline-none focus:border-accent"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="flex items-center gap-[8px] px-[6px] h-[var(--hit)] rounded-[6px] border-0 bg-transparent cursor-pointer hover:bg-bg-raised transition-colors duration-[var(--dur-state)]"
      title={author || "Set your name"}
    >
      <span className="w-[28px] h-[28px] rounded-full bg-accent/20 text-accent flex items-center justify-center text-[11px] font-medium flex-none">
        {initials}
      </span>
      <span className="text-[13px] text-ink-dim max-w-[120px] truncate">
        {author || "Set name"}
      </span>
    </button>
  );
}

export function Topbar({ onRigToggle }: TopbarProps) {
  const role = usePortalStore((s) => s.role);

  return (
    <header className="flex-none flex items-center gap-[12px] px-[16px] h-[52px] border-b border-solid border-line bg-bg">
      <span className="text-[15px] font-semibold tracking-[0.12em] uppercase text-accent mr-[4px]">
        Limelight
      </span>

      <TabNav />

      <span className="flex-1" />

      {role === "venue" && <RigControl onToggle={onRigToggle} />}

      <span className="w-px h-[24px] bg-line flex-none" />

      <IdentityControl />

      <span className="w-px h-[24px] bg-line flex-none" />

      <RoleToggle />
    </header>
  );
}
