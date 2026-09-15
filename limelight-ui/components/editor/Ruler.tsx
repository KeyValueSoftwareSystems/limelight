"use client";

import { barTicks, timeToX } from "@/lib/timeline";
import { mmss } from "@/lib/grid";
import { useTimeline } from "./Timeline";
import type { Grid } from "@/lib/types";

/* Bars are the unit a musician counts in, so they lead. Time is secondary. */
export function Ruler({ grid }: { grid: Grid }) {
  const { view, width } = useTimeline();
  const ticks = barTicks(view, grid, width);

  return (
    <div className="relative h-[var(--ruler-h)] flex-none border-b border-solid border-line cursor-ew-resize">
      {ticks.map((t) => {
        const x = timeToX(t.t, view, width);
        return (
          <div key={t.bar} className="absolute top-0 bottom-0 pointer-events-none" style={{ left: x }}>
            <span className="absolute top-0 bottom-0 w-px bg-line-strong" />
            <span className="absolute left-[4px] top-[1px] mono text-[9px] text-ink-dim whitespace-nowrap">
              {t.bar}
            </span>
            <span className="absolute left-[4px] bottom-0 mono text-[8px] text-ink-dimmer whitespace-nowrap">
              {mmss(t.t)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
