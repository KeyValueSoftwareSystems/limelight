"use client";

import { timeToX } from "@/lib/timeline";
import { makeGridClock } from "@/lib/grid";
import { useTimeline } from "./Timeline";
import type { Grid } from "@/lib/types";

/* The score's per-bar intensity as a filled area. The closest thing this product
   has to a waveform, and where a creator's eye goes to find the lift. */
export function EnergyBand({ energy, grid }: { energy: (number | null)[]; grid: Grid }) {
  const { view, width } = useTimeline();
  const { secondsAtBar } = makeGridClock(grid);
  const H = 28;

  const pts: string[] = [];
  for (let i = 0; i < energy.length; i++) {
    const v = energy[i];
    if (v === null || v === undefined) continue;
    const t = secondsAtBar(i + 1);
    if (t < view.from - 5 || t > view.to + 5) continue;
    pts.push(`${timeToX(t, view, width).toFixed(1)},${(H - v * H).toFixed(1)}`);
  }

  return (
    <div className="relative h-[var(--energy-h)] flex-none border-b border-solid border-line">
      {pts.length > 1 && (
        <svg width={width} height={H} className="absolute inset-0 pointer-events-none">
          <polygon
            points={`${pts[0].split(",")[0]},${H} ${pts.join(" ")} ${pts[pts.length - 1].split(",")[0]},${H}`}
            fill="var(--ink)"
            opacity="0.12"
          />
          <polyline points={pts.join(" ")} fill="none" stroke="var(--ink)" strokeOpacity="0.38" strokeWidth="1" />
        </svg>
      )}
      <span className="absolute left-[6px] top-[2px] text-[9px] uppercase tracking-[0.12em] text-ink-dimmer pointer-events-none">
        Energy
      </span>
    </div>
  );
}
