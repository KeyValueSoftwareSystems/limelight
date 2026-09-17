"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Music, Layers, Building2 } from "lucide-react";

/* Venues was a finished page - four rooms, rig specs, "design for this room" -
   reachable only by typing the URL. A destination the app has and never offers
   is worse than one it does not have. */
const TABS = [
  { id: "library", label: "Songs", href: "/library", Icon: Music },
  { id: "shows", label: "Shows", href: "/shows", Icon: Layers },
  { id: "venues", label: "Venues", href: "/venues", Icon: Building2 },
];

export function TabNav() {
  const pathname = usePathname();

  return (
    <nav
      className="flex items-center gap-[2px] h-[var(--control-h)] rounded-[10px] p-[3px]"
      style={{ background: "var(--surface-1)", border: "1px solid var(--edge)" }}
    >
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname?.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            /* inactive was --ink-dimmer, the tertiary step, which put an entire
               destination under the contrast floor; secondary reads without
               competing with the selected one */
            className={`relative flex items-center gap-[7px] h-full px-[14px] rounded-[6px] no-underline
              text-[13px] font-semibold transition-[color,background-color,box-shadow] duration-150 ease-[var(--ease)]
              ${active ? "text-ink" : "text-ink-dim hover:text-ink"}`}
            style={
              active
                ? { background: "var(--surface-3)", boxShadow: "var(--elev-1), var(--inset-hi)" }
                : undefined
            }
          >
            <tab.Icon size={14} strokeWidth={active ? 2.1 : 1.7} className={active ? "text-accent" : ""} />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
