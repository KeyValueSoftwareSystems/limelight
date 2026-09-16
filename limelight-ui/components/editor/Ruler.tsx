"use client";

import { memo } from "react";

import { barTicks, beatTicks, timeToX } from "@/lib/timeline";
import { mmss } from "@/lib/grid";
import { useTimeline } from "./Timeline";
import type { Grid } from "@/lib/types";

/* Bars are the unit a musician counts in, so they lead. Time is secondary. */
function RulerBase({ grid }: { grid: Grid }) {
  const { view, width } = useTimeline();
  const ticks = barTicks(view, grid, width);
  /* the beats inside each bar, drawn faint, and only once they are far enough
     apart to read. Without them a cue can only be placed by eye against a bar
     line four beats wide. */
  const beats = beatTicks(view, grid, width).filter((b) => !b.down);

  return (
    <div className="relative h-[var(--ruler-h)] flex-none border-b border-solid border-line cursor-ew-resize">
      {beats.map((b) => (
        <span
          key={"b" + b.bar + "." + b.beat}
          className="absolute bottom-0 h-[6px] w-px bg-line pointer-events-none"
          style={{ left: timeToX(b.t, view, width) }}
        />
      ))}
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

/* Memoised. The ruler is a function of the grid alone; the playhead is drawn over it.
 */
export const Ruler = memo(RulerBase);
