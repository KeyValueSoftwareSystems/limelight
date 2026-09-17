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
      className="flex h-[32px] rounded-[var(--radius-sm)] bg-bg-raised/50 p-[2px]"
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
            className={`flex items-center gap-[5px] px-[10px] rounded-[4px] border-0 text-[12px] font-medium cursor-pointer transition-all duration-[var(--dur-state)] ease-[var(--ease)] ${
              active
                ? "bg-bg-overlay text-ink shadow-[0_1px_2px_rgba(0,0,0,0.2)]"
                : "bg-transparent text-ink-dimmer hover:text-ink-dim"
            }`}
          >
            <r.Icon size={12} strokeWidth={active ? 2 : 1.5} />
            {r.label}
          </button>
        );
      })}
    </div>
  );
}
