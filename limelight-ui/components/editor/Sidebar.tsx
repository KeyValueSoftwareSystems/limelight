"use client";

import { PaletteTabs } from "./PaletteTabs";
import { SetlistPanel } from "./SetlistPanel";
import { PalettePanel } from "./PalettePanel";
import type { Effect, PaletteColour } from "@/lib/types";

const PANEL = "min-h-0 flex flex-col";

interface SidebarProps {
  effects: Effect[];
  onRecolour: (colours: PaletteColour[]) => void;
}

export function Sidebar({ effects, onRecolour }: SidebarProps) {
  return (
    <nav className="h-full flex flex-col min-h-0">
      <SetlistPanel />

      <div className={`${PANEL} flex-none max-h-[38%] border-b border-solid border-white/[0.05]`} style={{ background: "var(--bg)" }}>
        <PalettePanel onRecolour={onRecolour} />
      </div>

      <div className={`${PANEL} flex-1`} style={{ background: "linear-gradient(180deg, var(--bg-raised) 0%, var(--bg) 100%)" }}>
        <PaletteTabs effects={effects} />
      </div>
    </nav>
  );
}
