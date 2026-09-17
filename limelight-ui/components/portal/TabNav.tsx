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
    <nav className="flex items-stretch gap-[22px] h-full" aria-label="Sections">
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname?.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`group relative flex items-center h-full no-underline text-[13px] font-medium
              tracking-[-0.006em] transition-colors duration-[var(--dur-state)]
              ${active ? "text-ink" : "text-ink-dimmer hover:text-ink-dim"}`}
          >
            {tab.label}
            <span
              aria-hidden
              className={`absolute left-0 right-0 bottom-0 h-[2px] rounded-full transition-opacity duration-[var(--dur-state)]
                ${active ? "opacity-100" : "opacity-0 group-hover:opacity-40"}`}
              style={{ background: "var(--accent)", boxShadow: "0 -5px 12px -2px var(--accent-glow)" }}
            />
          </Link>
        );
      })}
    </nav>
  );
}
