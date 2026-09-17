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
    router.push("/shows");
  };

  return (
    <div
      className="flex items-center h-[var(--control-h)] gap-[3px] rounded-[9px] p-[3px]"
      style={{ background: "var(--well-face)", boxShadow: "var(--well-edge)" }}
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
            className={`flex items-center gap-[6px] h-full px-[10px] rounded-[6px] border-0 text-[12px] font-medium cursor-pointer transition-colors duration-200 ease-[var(--ease)] ${
              active ? "text-ink" : "bg-transparent text-ink-dimmer hover:text-ink-dim"
            }`}
            style={active ? { background: "var(--key-on-face)", boxShadow: "var(--key-on-edge)" } : undefined}
          >
            <r.Icon size={12} strokeWidth={active ? 2 : 1.5} style={active ? { color: "var(--accent)" } : undefined} />
            {r.label}
          </button>
        );
      })}
    </div>
  );
}
