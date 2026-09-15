"use client";

import { timeToX } from "@/lib/timeline";
import { useTimeline } from "./Timeline";

/* One high-contrast neutral, never a hue — it has to win against every family
   colour beneath it. Positioned directly; never CSS-transitioned. */
export function Playhead({ t }: { t: number }) {
  const { view, width } = useTimeline();
  const x = timeToX(t, view, width);
  if (x < 0 || x > width) return null;
  return (
    <div className="absolute top-0 bottom-0 pointer-events-none z-20" style={{ left: x }}>
      <span className="absolute top-0 bottom-0 w-[2px] -ml-px" style={{ background: "var(--playhead)" }} />
      <span
        className="absolute top-0 -ml-[5px] w-[10px] h-[9px]"
        style={{ background: "var(--playhead)", clipPath: "polygon(0 0, 100% 0, 50% 100%)" }}
      />
    </div>
  );
}
