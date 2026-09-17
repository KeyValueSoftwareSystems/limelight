"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Palette, Radio } from "lucide-react";
import { usePortalStore } from "@/store/portal";
import type { Role } from "@/lib/types";

const ROLES: { id: Role; label: string; Icon: typeof Palette }[] = [
  { id: "creator", label: "Designer", Icon: Palette },
  { id: "venue", label: "Operator", Icon: Radio },
];

export function RoleToggle() {
  const role = usePortalStore((s) => s.role);
  const setRole = usePortalStore((s) => s.setRole);
  const router = useRouter();

  useEffect(() => {
    document.body.dataset.role = role === "creator" ? "designer" : "operator";
  }, [role]);

  const handleRole = (r: Role) => {
    setRole(r);
    if (r === "creator") router.push("/library");
    else router.push("/shows");
  };

  return (
    <div
      className="flex h-[34px] rounded-[10px] bg-white/[0.03] border border-solid border-white/[0.04] p-[3px]"
      role="radiogroup"
      aria-label="Mode"
    >
      {ROLES.map((r) => {
        const active = role === r.id;
        return (
          <button
            key={r.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => handleRole(r.id)}
            className={`flex items-center gap-[5px] px-[11px] rounded-[var(--radius-sm)] border-0 text-[12px] font-medium cursor-pointer transition-all duration-200 ease-[var(--ease)] ${
              active ? "text-ink" : "bg-transparent text-ink-dimmer hover:text-ink-dim"
            }`}
            style={active ? {
              background: "linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.04) 100%)",
              boxShadow: "0 1px 3px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)",
            } : undefined}
          >
            <r.Icon size={12} strokeWidth={active ? 2 : 1.5} className={active ? "text-accent" : ""} />
            {r.label}
          </button>
        );
      })}
    </div>
  );
}
