"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePortalStore } from "@/store/portal";
import type { Role } from "@/lib/types";

const ROLES: { id: Role; label: string }[] = [
  { id: "creator", label: "Creator" },
  { id: "venue", label: "Venue" },
];

export function RoleToggle() {
  const role = usePortalStore((s) => s.role);
  const setRole = usePortalStore((s) => s.setRole);
  const router = useRouter();

  useEffect(() => {
    document.body.dataset.role = role;
  }, [role]);

  const handleRole = (r: Role) => {
    setRole(r);
    if (r === "creator") router.push("/library");
    else router.push("/shows");
  };

  return (
    <nav className="flex gap-[var(--spacing-s5)]">
      {ROLES.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => handleRole(r.id)}
          className={`bg-transparent border-0 border-b-2 border-solid px-0 py-[3px] pb-[5px] cursor-pointer text-[length:var(--text-xs)] tracking-[0.18em] uppercase transition-colors ${
            role === r.id
              ? "text-ink border-b-accent"
              : "text-dim border-b-transparent hover:text-ink"
          }`}
        >
          {r.label}
        </button>
      ))}
    </nav>
  );
}
