"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Music, Layers } from "lucide-react";

const TABS = [
  { id: "library", label: "Songs", href: "/library", Icon: Music },
  { id: "shows", label: "Shows", href: "/shows", Icon: Layers },
];

export function TabNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-[2px] h-[36px] rounded-[10px] p-[3px]"
      style={{ background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.08)" }}>
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname?.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.id}
            href={tab.href}
            className={`relative flex items-center gap-[6px] h-full px-[14px] rounded-[var(--radius-sm)] no-underline text-[13px] font-semibold transition-all duration-200 ease-[var(--ease)] ${
              active ? "text-ink" : "text-ink-dimmer hover:text-ink-dim"
            }`}
            style={active ? {
              background: "linear-gradient(180deg, rgba(139,92,246,0.15) 0%, rgba(139,92,246,0.08) 100%)",
              boxShadow: "0 1px 3px rgba(0,0,0,0.3), inset 0 1px 0 rgba(139,92,246,0.15)",
            } : undefined}
          >
            <tab.Icon size={14} strokeWidth={active ? 2 : 1.5} className={active ? "text-accent" : ""} />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
