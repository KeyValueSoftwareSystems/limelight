"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PaletteTabs } from "./PaletteTabs";
import type { Effect } from "@/lib/types";

/* The rail. It owns navigation and the two palettes, and it never scrolls with
   the editor — only the timeline in the middle moves. */

const NAV = [
  { href: "/shows", label: "Shows", icon: "M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1V9.5Z" },
  { href: "/venues", label: "Venues", icon: "M10 2a5 5 0 0 0-5 5c0 3.6 5 11 5 11s5-7.4 5-11a5 5 0 0 0-5-5Zm0 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z" },
  { href: "/library", label: "Explore", icon: "M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm3.4 4.6-2 4.8-4.8 2 2-4.8 4.8-2Z" },
];

export function Sidebar({ effects }: { effects: Effect[] }) {
  const pathname = usePathname();

  return (
    <nav className="h-full flex flex-col min-h-0 bg-bg border-r border-solid border-line">
      <div className="flex-none px-[var(--spacing-s5)] pt-[var(--spacing-s5)] pb-[var(--spacing-s6)]">
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

      {/* the palette sits at the foot of the rail, flush to the bottom */}
      <span className="flex-1 min-h-[var(--spacing-s5)]" />

      <div className="flex-none">
        <PaletteTabs effects={effects} />
      </div>

    </nav>
  );
}
