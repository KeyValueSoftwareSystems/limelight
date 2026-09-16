"use client";

import { TabNav } from "./TabNav";
import { RoleToggle } from "./RoleToggle";
import { RigControl } from "./RigControl";
import { usePortalStore } from "@/store/portal";

interface TopbarProps {
  onRigToggle: () => void;
}

export function Topbar({ onRigToggle }: TopbarProps) {
  /* Driving the lamps is a VENUE action, so the control lives in the venue role
     and nowhere else. In the creator role it was two pieces of noise: a chip
     saying the portal was unreachable -- which, now that the portal and this
     page are one address, means the page you are reading could not have loaded
     -- and a button to send to a rig a creator is not standing in front of. */
  const role = usePortalStore((s) => s.role);
  return (
    <header className="flex-none flex items-center gap-[var(--spacing-s4)] px-[var(--spacing-s6)] py-[var(--spacing-s2)] border-b border-solid border-line min-h-[46px]">
      <span className="text-[length:var(--text-xs)] tracking-[0.2em] uppercase text-dim">
        Limelight
      </span>
      <TabNav />
      <span className="flex-1" />
      {role === "venue" && <RigControl onToggle={onRigToggle} />}
      <RoleToggle />
    </header>
  );
}
