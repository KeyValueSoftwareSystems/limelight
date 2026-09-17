"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Music, Layers, Zap } from "lucide-react";

const TABS = [
  { id: "library", label: "Library", href: "/library", Icon: Music },
  { id: "shows", label: "Shows", href: "/shows", Icon: Layers },
  { id: "stage", label: "Stage", href: "/stage", Icon: Zap },
];

export function TabNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-[2px] h-[32px] rounded-[var(--radius-sm)] bg-bg-raised/50 p-[2px]">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname?.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.id}
            href={tab.href}
            className={`flex items-center gap-[6px] h-full px-[12px] rounded-[4px] no-underline text-[13px] font-medium transition-all duration-[var(--dur-state)] ease-[var(--ease)] ${
              active
                ? "bg-bg-overlay text-ink shadow-[0_1px_2px_rgba(0,0,0,0.2)]"
                : "text-ink-dimmer hover:text-ink-dim"
            }`}
          >
            <tab.Icon size={14} strokeWidth={active ? 2 : 1.5} />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
