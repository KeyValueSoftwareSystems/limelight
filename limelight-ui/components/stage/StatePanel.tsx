"use client";

import { usePortalStore } from "@/store/portal";

export function StatePanel() {
  const show = usePortalStore((s) => s.show);
  const rig = usePortalStore((s) => s.rig);

  if (!show || !rig?.sending) return null;

  return (
    <div className="px-[var(--spacing-s5)] pt-[var(--spacing-s5)] mt-[var(--spacing-s5)] border-t border-solid border-line">
      <div className="label">Live state</div>
      <div className="flex flex-col gap-1 mt-[var(--spacing-s3)]">
        <span className="text-[length:var(--text-sm)] text-dim tabular-nums">
          frame {rig.last_index ?? "—"} · {rig.sending ? "sending" : "paused"}
        </span>
        {rig.trim && (
          <span className="text-[length:var(--text-sm)] text-dim tabular-nums">
            master {Math.round(rig.trim.master * 100)}% · par {Math.round(rig.trim.par * 100)}% · head{" "}
            {Math.round(rig.trim.head * 100)}%
            {rig.trim.blackout ? " · BLACKOUT" : ""}
          </span>
        )}
      </div>
    </div>
  );
}
