"use client";

import { useCallback } from "react";
import { usePortalStore } from "@/store/portal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import * as api from "@/lib/api";

export function RigPanel() {
  const rig = usePortalStore((s) => s.rig);
  const job = usePortalStore((s) => s.job);
  const swapping = usePortalStore((s) => s.swapping);

  const anchorPost = useCallback(async () => {
    if (!job) return;
    try {
      await api.rig.at(job, 0);
    } catch { /* noop */ }
  }, [job]);

  if (!rig) return null;

  const rm = rig.rigmap;
  const sending = rig.sending;
  const loaded = rig.loaded;

  return (
    <div className="px-[var(--spacing-s5)] pt-[var(--spacing-s5)] mt-[var(--spacing-s5)] border-t border-solid border-line">
      <div className="label">Rig</div>
      <div className="flex flex-col gap-[var(--spacing-s2)] mt-[var(--spacing-s3)]">
        <div className="flex items-center gap-[var(--spacing-s2)]">
          <Badge variant={sending ? "ok" : loaded ? "accent" : "default"}>
            {sending ? "sending" : loaded ? "loaded" : "standby"}
          </Badge>
          {rm && (
            <span className="text-[length:var(--text-sm)] text-dim">
              {rm.pars} pars · {rm.heads} heads · {rm.channels} ch
            </span>
          )}
        </div>
        {sending && (
          <span className="text-[length:var(--text-sm)] text-dim tabular-nums">
            {rig.frames_sent.toLocaleString()} frames sent
            {rig.anchor_age_ms != null ? ` · anchor ${(rig.anchor_age_ms / 1000).toFixed(1)}s ago` : ""}
          </span>
        )}
        {rig.last_error && (
          <span className="text-[length:var(--text-sm)] text-danger">{rig.last_error}</span>
        )}
        {rig.conflict && (
          <span className="text-[length:var(--text-sm)] text-warn">{rig.conflict}</span>
        )}
        <div className="flex gap-[var(--spacing-s2)] mt-1">
          <Button
            variant="link"
            disabled={!sending}
            onClick={anchorPost}
          >
            Post anchor
          </Button>
        </div>
        {swapping && (
          <span className="text-[length:var(--text-sm)] text-accent">Swapping on the next bar…</span>
        )}
      </div>
    </div>
  );
}
