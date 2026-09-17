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
    <nav className="flex items-center gap-[2px] h-[36px] rounded-[10px] bg-white/[0.03] border border-solid border-white/[0.04] p-[3px]">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname?.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.id}
            href={tab.href}
            className={`relative flex items-center gap-[6px] h-full px-[14px] rounded-[var(--radius-sm)] no-underline text-[13px] font-medium transition-all duration-200 ease-[var(--ease)] ${
              active
                ? "text-ink"
                : "text-ink-dimmer hover:text-ink-dim"
            }`}
            style={active ? {
              background: "linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.04) 100%)",
              boxShadow: "0 1px 3px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)",
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
