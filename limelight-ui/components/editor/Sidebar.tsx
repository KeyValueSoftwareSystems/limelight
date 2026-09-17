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
    <nav className="h-full flex flex-col min-h-0 border-r border-solid border-line">
      <div className={`${THIRD} bg-bg-sunken overflow-y-auto`}>
        <div className="flex-none px-[16px] pt-[14px] pb-[10px]">
          <span className="text-[13px] font-bold tracking-[-0.01em] text-ink">Limelight</span>
        </div>

        <div className="flex-none flex flex-col gap-[1px] px-[8px]">
          {NAV.map((n) => {
            const on = pathname === n.href;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`flex items-center gap-[10px] px-[10px] py-[8px] no-underline rounded-[var(--radius-sm)] transition-all duration-[var(--dur-state)] ease-[var(--ease)] ${
                  on ? "text-ink bg-bg-raised" : "text-ink-dimmer hover:text-ink hover:bg-bg-raised/50"
                }`}
              >
                <n.Icon size={15} strokeWidth={on ? 2 : 1.5} className="flex-none" />
                <span className="text-[12px] font-medium">{n.label}</span>
              </Link>
            );
          })}
        </div>
      </div>

      <div className={`${THIRD} bg-bg border-t border-solid border-line`}>
        <PalettePanel onRecolour={onRecolour} />
      </div>

      <div className={`${THIRD} bg-bg-raised border-t border-solid border-line`}>
        <PaletteTabs effects={effects} />
      </div>
    </nav>
  );
}
