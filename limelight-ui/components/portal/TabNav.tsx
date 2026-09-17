"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { id: "library", label: "Library", href: "/library" },
  { id: "shows", label: "Shows", href: "/shows" },
  { id: "stage", label: "Stage", href: "/stage" },
];

export function TabNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-[2px]">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname?.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.id}
            href={tab.href}
            className={`flex items-center h-[var(--hit)] px-[14px] rounded-[6px] border-0 no-underline text-[13px] tracking-[0.03em] font-medium transition-colors duration-[var(--dur-state)] ${
              active
                ? "bg-bg-raised text-ink"
                : "text-ink-dimmer hover:text-ink hover:bg-bg-raised/50"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
