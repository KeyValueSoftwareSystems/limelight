"use client";

import { usePortalStore } from "@/store/portal";
import { Pill } from "@/components/ui/Pill";
import { Button } from "@/components/ui/Button";
import type { RigStatus } from "@/lib/types";

function rigState(r: RigStatus | null): { state: "off" | "live" | "armed" | "dead" | "unknown"; text: string; detail: string } {
  if (!r) return { state: "dead", text: "portal unreachable", detail: "" };
  if (!r.can_send)
    return { state: "dead", text: "no output", detail: r.why_not ?? "the Art-Net socket is not open" };
  if (r.sending)
    return {
      state: "live",
      text: `sending · ${r.frames_sent.toLocaleString()} frames`,
      detail: `40 fps leaving this machine for Art-Net ${r.gateway} universe ${r.universe}`,
    };
  if (r.armed) {
    if (r.last_error)
      return { state: "dead", text: "send failing", detail: r.last_error };
    return { state: "armed", text: "armed — nothing leaving", detail: `${r.frames_sent.toLocaleString()} frames sent so far` };
  }
  return {
    state: "off",
    text: "standby",
    detail: `${r.conflict ? r.conflict + " · " : ""}socket open to ${r.gateway} universe ${r.universe}, sending nothing`,
  };
}

export function RigControl({ onToggle }: { onToggle: () => void }) {
  const rig = usePortalStore((s) => s.rig);
  const show = usePortalStore((s) => s.show);
  const { state, text, detail } = rigState(rig);

  /* The chip only appears when it has something to say. "standby" on a rig
     nobody is using is a permanent red-ish badge that trains people to ignore
     the one case that matters -- send failing, mid-show. */
  const worthSaying = state !== "off";

  return (
    <div className="flex items-center gap-[var(--spacing-s3)]">
      {worthSaying && (
        <Pill state={state} title={detail}>
          {text}
        </Pill>
      )}
      <Button
        variant="big"
        active={!!rig?.armed}
        disabled={!rig?.can_send || !show}
        onClick={onToggle}
      >
        {rig?.armed ? "Stop sending" : "Send to the rig"}
      </Button>
    </div>
  );
}
