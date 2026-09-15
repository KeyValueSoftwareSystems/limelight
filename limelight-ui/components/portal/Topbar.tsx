"use client";

import { TabNav } from "./TabNav";
import { RoleToggle } from "./RoleToggle";
import { RigControl } from "./RigControl";

interface TopbarProps {
  onRigToggle: () => void;
}

export function Topbar({ onRigToggle }: TopbarProps) {
  return (
    <header className="flex-none flex items-center gap-[var(--spacing-s4)] px-[var(--spacing-s6)] py-[var(--spacing-s2)] border-b border-solid border-line min-h-[46px]">
      <span className="text-[length:var(--text-xs)] tracking-[0.2em] uppercase text-dim">
        Limelight
      </span>
      <TabNav />
      <span className="flex-1" />
      <RigControl onToggle={onRigToggle} />
      <RoleToggle />
    </header>
  );
}
