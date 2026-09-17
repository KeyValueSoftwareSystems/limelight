"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePortalStore } from "@/store/portal";
import type { Role } from "@/lib/types";

const TABS: Record<Role, { id: string; label: string; href: string }[]> = {
  creator: [
    { id: "shows", label: "Shows", href: "/shows" },
    { id: "venues", label: "Venues", href: "/venues" },
    { id: "marketplace", label: "Marketplace", href: "/marketplace" },
  ],
  venue: [
    { id: "shows", label: "Shows", href: "/shows" },
    { id: "venues", label: "Rooms", href: "/venues" },
    { id: "marketplace", label: "Marketplace", href: "/marketplace" },
  ],
};

export function TabNav() {
  const pathname = usePathname();
  const role = usePortalStore((s) => s.role);
  const tabs = TABS[role] ?? TABS.creator;

  return (
    <nav
      className="liquid-well flex items-stretch gap-[2px] h-[30px] p-[2px] rounded-[7px]"
      aria-label="Sections"
    >
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname?.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center h-full px-[15px] rounded-[5px] no-underline
              text-[12.5px] tracking-[-0.004em] transition-colors duration-[var(--dur-state)]
              ${active ? "liquid liquid-key font-medium text-ink" : "font-normal text-ink-dim hover:text-ink"}`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
