"use client";

import { PaletteTabs } from "./PaletteTabs";
import { PalettePanel } from "./PalettePanel";
import type { Effect, PaletteColour } from "@/lib/types";

const HALF = "flex-1 basis-0 min-h-0 flex flex-col";

interface SidebarProps {
  effects: Effect[];
  onRecolour: (colours: PaletteColour[]) => void;
}

export function Sidebar({ effects, onRecolour }: SidebarProps) {
  return (
    <nav className="h-full flex flex-col min-h-0">
      <div className={`${HALF} border-b border-solid border-white/[0.05]`} style={{ background: "var(--bg)" }}>
        <PalettePanel onRecolour={onRecolour} />
      </div>

      <div className={`${HALF}`} style={{ background: "linear-gradient(180deg, var(--bg-raised) 0%, var(--bg) 100%)" }}>
        <PaletteTabs effects={effects} />
      </div>
    </nav>
  );
}
