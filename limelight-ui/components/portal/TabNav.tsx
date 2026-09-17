"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePortalStore } from "@/store/portal";
import type { Role } from "@/lib/types";

const TABS: Record<Role, { id: string; label: string; href: string }[]> = {
  creator: [
    { id: "shows", label: "Shows", href: "/shows" },
    { id: "venues", label: "Venues", href: "/venues" },
  ],
  venue: [
    { id: "shows", label: "Shows", href: "/shows" },
    { id: "venues", label: "Rooms", href: "/venues" },
  ],
};

export function TabNav() {
  const pathname = usePathname();
  const role = usePortalStore((s) => s.role);
  const tabs = TABS[role] ?? TABS.creator;

  return (
    <nav
      className="flex items-stretch gap-[3px] h-[var(--control-h)] p-[3px] rounded-[9px]"
      style={{ background: "var(--well-face)", boxShadow: "var(--well-edge)" }}
      aria-label="Sections"
    >
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname?.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`relative flex items-center h-full px-[14px] rounded-[6px] no-underline
              text-[12.5px] font-medium tracking-[-0.004em]
              transition-[color,box-shadow,background] duration-[var(--dur-state)]
              ${active ? "text-ink" : "text-ink-dimmer hover:text-ink-dim"}`}
            style={
              active
                ? { background: "var(--key-on-face)", boxShadow: "var(--key-on-edge)" }
                : undefined
            }
          >
            {active && (
              <span
                aria-hidden
                className="absolute left-[10px] right-[10px] top-[4px] h-[2px] rounded-full"
                style={{ background: "var(--accent)", boxShadow: "0 0 8px 0 var(--accent-glow)" }}
              />
            )}
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
