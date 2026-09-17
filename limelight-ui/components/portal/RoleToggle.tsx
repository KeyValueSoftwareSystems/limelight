"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePortalStore } from "@/store/portal";
import type { Role } from "@/lib/types";

const ROLES: { id: Role; label: string }[] = [
  { id: "creator", label: "Designer" },
  { id: "venue", label: "Operator" },
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
      className="flex h-[var(--hit)] rounded-[6px] border border-solid border-line-strong p-[2px] bg-bg-sunken"
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
            className={`px-[14px] rounded-[4px] border-0 text-[12px] tracking-[0.08em] uppercase cursor-pointer transition-all duration-[var(--dur-state)] ${
              active
                ? "bg-bg-raised text-ink font-medium shadow-[0_1px_3px_rgba(0,0,0,0.3)]"
                : "bg-transparent text-ink-dimmer hover:text-ink-dim"
            }`}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}
