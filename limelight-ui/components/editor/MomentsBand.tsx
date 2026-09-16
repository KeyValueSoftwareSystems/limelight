"use client";

import { memo } from "react";

import { timeToX } from "@/lib/timeline";
import { useTimeline } from "./Timeline";
import type { Moment } from "@/lib/types";

/* The events the score itself found — where the drums enter, where the riff
   lands, where tension releases. The strongest "put something here" hints the
   product has, and snap targets once placing arrives. */
function MomentsBandBase({ moments }: { moments: Moment[] }) {
  const { view, width } = useTimeline();

  return (
    <div className="relative h-[var(--moments-h)] flex-none border-b border-solid border-line">
      {moments.map((m, i) => {
        const x = timeToX(m.t, view, width);
        if (x < -40 || x > width + 40) return null;
        const weight = m.weight ?? 0.5;
        const d = 3 + weight * 4;
        return (
          <div
            key={i}
            className="absolute top-0 bottom-0 flex items-center gap-[3px] pointer-events-none"
            style={{ left: x }}
            title={`${m.kind}${m.what ? " · " + m.what : ""}`}
          >
            <span
              className="block rounded-full bg-ink flex-none"
              style={{ width: d, height: d, opacity: 0.35 + weight * 0.55 }}
            />
            <span className="text-[8px] text-ink-dim whitespace-nowrap">{m.what ?? m.kind}</span>
          </div>
        );
      })}
    </div>
  );
}

/* Memoised. Moments do not change while a show plays.
 */
export const MomentsBand = memo(MomentsBandBase);
