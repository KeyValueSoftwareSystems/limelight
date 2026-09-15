"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePortalStore } from "@/store/portal";

const TABS = {
  creator: [
    { id: "library", label: "Library", href: "/library" },
    { id: "venues", label: "Venues", href: "/venues" },
    { id: "marketplace", label: "Marketplace", href: "/marketplace" },
  ],
  venue: [
    { id: "shows", label: "Shows", href: "/shows" },
    { id: "venues", label: "Venues", href: "/venues" },
    { id: "marketplace", label: "Marketplace", href: "/marketplace" },
  ],
} as const;

export function TabNav() {
  const role = usePortalStore((s) => s.role);
  const pathname = usePathname();
  const tabs = TABS[role];

  return (
    <nav className="flex gap-[var(--spacing-s5)]">
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname?.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.id}
            href={tab.href}
            className={`bg-transparent border-0 border-b-2 border-solid px-0 py-[3px] pb-[5px] cursor-pointer text-[length:var(--text-xs)] tracking-[0.18em] uppercase no-underline transition-colors ${
              active
                ? "text-ink border-b-accent"
                : "text-dim border-b-transparent hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
