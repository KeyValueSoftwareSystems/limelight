"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PaletteTabs } from "./PaletteTabs";
import { PalettePanel } from "./PalettePanel";
import type { Effect, PaletteColour } from "@/lib/types";

/* The rail. Three equal thirds — where you are, what colours the room works in,
   and what you can put on the timeline — and it never scrolls with the editor.

   Each third sits on its own rung of the surface ladder rather than being marked
   off by a rule alone. A hairline says "these are different"; it does not say
   which of them you are meant to be looking at. The steps are ~6 points of
   lightness on a near-black ground, so the boundary is legible at a glance and
   nothing in it is bright enough to pull the eye off the stage — which is the
   only thing on this screen that is allowed to be. Darkest at the top, where
   navigation should recede; lightest at the foot, which is the surface you
   actually reach into. */

const NAV = [
  { href: "/shows", label: "Shows", icon: "M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1V9.5Z" },
  { href: "/venues", label: "Venues", icon: "M10 2a5 5 0 0 0-5 5c0 3.6 5 11 5 11s5-7.4 5-11a5 5 0 0 0-5-5Zm0 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z" },
  { href: "/library", label: "Explore", icon: "M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm3.4 4.6-2 4.8-4.8 2 2-4.8 4.8-2Z" },
];

/* basis-0 as well as flex-1: without it each third would be "an equal share of
   what is left after my content", and the palette's 25 tiles would claim more
   of the rail than the three navigation links above them. */
const THIRD = "flex-1 basis-0 min-h-0 flex flex-col";

interface SidebarProps {
  effects: Effect[];
  /** send the show through /api/recolour — a colour change rewrites every cue */
  onRecolour: (colours: PaletteColour[]) => void;
}

export function Sidebar({ effects, onRecolour }: SidebarProps) {
  const pathname = usePathname();

  return (
    <nav className="h-full flex flex-col min-h-0 border-r border-solid border-line">
      {/* ── where you are ───────────────────────────────────────────────── */}
      <div className={`${THIRD} bg-bg-sunken overflow-y-auto`}>
        <div className="flex-none px-[var(--spacing-s5)] pt-[var(--spacing-s5)] pb-[var(--spacing-s5)]">
          <span className="text-[13px] tracking-[0.34em] text-ink">LIMELIGHT</span>
        </div>

        <div className="flex-none flex flex-col">
          {NAV.map((n) => {
            const on = pathname === n.href;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`flex items-center gap-[var(--spacing-s3)] px-[var(--spacing-s5)] py-[9px] no-underline border-l-2 border-solid transition-colors duration-[var(--dur-state)] ${
                  on ? "text-ink border-l-accent" : "text-ink-dim border-l-transparent hover:text-ink"
                }`}
              >
                <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden className="flex-none">
                  <path d={n.icon} />
                </svg>
                <span className="text-[11px] tracking-[0.16em] uppercase">{n.label}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* ── what colours the room works in ──────────────────────────────── */}
      <div className={`${THIRD} bg-bg border-t border-solid border-line`}>
        <PalettePanel onRecolour={onRecolour} />
      </div>

      {/* ── what you can put on the timeline ────────────────────────────── */}
      <div className={`${THIRD} bg-bg-raised border-t border-solid border-line`}>
        <PaletteTabs effects={effects} />
      </div>
    </nav>
  );
}
