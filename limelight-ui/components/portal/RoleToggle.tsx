"use client";

import { useEffect } from "react";
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

  useEffect(() => {
    document.body.dataset.role = role === "creator" ? "designer" : "operator";
  }, [role]);

  /* Switching role no longer navigates. It is a view of the SAME stage - a
     designer sees the palette and the chat, an operator sees the console and
     the rig - so sending them back to the shows index threw away the show they
     were looking at. */
  const handleRole = (r: Role) => setRole(r);

  return (
    <div
      className="liquid-well flex items-center h-[34px] gap-[2px] rounded-[9px] p-[3px]"
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
            title={r.id === "creator" ? "Design shows from songs" : "Play shows to a room"}
            className={`flex items-center gap-[6px] h-full px-[12px] rounded-[6px] border-0 text-[12.5px] cursor-pointer transition-colors duration-200 ease-[var(--ease)] ${
              active ? "liquid liquid-key font-medium text-ink" : "bg-transparent font-normal text-ink-dim hover:text-ink"
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
