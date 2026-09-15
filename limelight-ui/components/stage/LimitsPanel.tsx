"use client";

import { usePortalStore } from "@/store/portal";
import { Badge } from "@/components/ui/Badge";

export function LimitsPanel() {
  const limits = usePortalStore((s) => s.limits);
  if (!limits) return null;

  return (
    <div className="px-[var(--spacing-s5)] pt-[var(--spacing-s5)] mt-[var(--spacing-s5)] border-t border-solid border-line">
      <div className="label">Venue limits</div>
      <div className="flex flex-col gap-[var(--spacing-s2)] mt-[var(--spacing-s3)]">
        <div className="flex gap-[var(--spacing-s2)] text-[length:var(--text-sm)] text-dim">
          <span>Max par {Math.round(limits.max_intensity.par * 100)}%</span>
          <span>· max head {Math.round(limits.max_intensity.head * 100)}%</span>
        </div>
        {!limits.strobe.allowed && <Badge variant="warn">Strobe off</Badge>}
        {limits.strobe.allowed && limits.strobe.max < 255 && (
          <Badge>Strobe max {limits.strobe.max}</Badge>
        )}
        {limits.keep_out.length > 0 && (
          <div>
            <div className="text-[length:var(--text-xs)] text-dim">Keep-out zones:</div>
            {limits.keep_out.map((k, i) => (
              <span key={i} className="block text-[length:var(--text-sm)] text-dim">
                {k.name}: {k.from}–{k.to}
              </span>
            ))}
          </div>
        )}
        {limits.frames_clamped != null && limits.frames_clamped > 0 && (
          <span className="text-[length:var(--text-xs)] text-warn">
            {limits.frames_clamped} frames clamped
          </span>
        )}
      </div>
    </div>
  );
}
