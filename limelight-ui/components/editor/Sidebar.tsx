"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Layers, MapPin, Music } from "lucide-react";
import { PaletteTabs } from "./PaletteTabs";
import { PalettePanel } from "./PalettePanel";
import type { Effect, PaletteColour } from "@/lib/types";

const NAV = [
  { href: "/shows", label: "Shows", Icon: Layers },
  { href: "/venues", label: "Venues", Icon: MapPin },
  { href: "/library", label: "Library", Icon: Music },
];

const THIRD = "flex-1 basis-0 min-h-0 flex flex-col";

interface SidebarProps {
  effects: Effect[];
  onRecolour: (colours: PaletteColour[]) => void;
}

export function Sidebar({ effects, onRecolour }: SidebarProps) {
  const pathname = usePathname();

  return (
    <nav className="h-full flex flex-col min-h-0">
      <div className={`${THIRD} overflow-y-auto`} style={{ background: "linear-gradient(180deg, rgba(7,8,11,0.95) 0%, rgba(12,13,18,1) 100%)" }}>
        <div className="flex-none px-[16px] pt-[14px] pb-[10px]">
          <span className="text-[13px] font-bold tracking-[-0.01em] text-ink">Limelight</span>
        </div>

        <div className="flex-none flex flex-col gap-[2px] px-[8px]">
          {NAV.map((n) => {
            const on = pathname === n.href;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`flex items-center gap-[10px] px-[10px] py-[7px] no-underline rounded-[var(--radius-sm)] transition-all duration-200 ease-[var(--ease)] ${
                  on ? "text-ink" : "text-ink-dimmer hover:text-ink-dim hover:bg-white/[0.04]"
                }`}
                style={on ? {
                  background: "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.03) 100%)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                } : undefined}
              >
                <n.Icon size={15} strokeWidth={on ? 2 : 1.5} className={`flex-none ${on ? "text-accent" : ""}`} />
                <span className="text-[12px] font-medium">{n.label}</span>
              </Link>
            );
          })}
        </div>
      </div>

      <div className={`${THIRD} border-t border-solid border-white/[0.05]`} style={{ background: "var(--bg)" }}>
        <PalettePanel onRecolour={onRecolour} />
      </div>

      <div className={`${THIRD} border-t border-solid border-white/[0.05]`} style={{ background: "linear-gradient(180deg, var(--bg-raised) 0%, var(--bg) 100%)" }}>
        <PaletteTabs effects={effects} />
      </div>
    </nav>
  );
}
