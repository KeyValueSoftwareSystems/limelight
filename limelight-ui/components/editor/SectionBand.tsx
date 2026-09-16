"use client";

import { memo } from "react";

import { timeToX } from "@/lib/timeline";
import { phaseTint } from "@/lib/tokens";
import { useTimeline } from "./Timeline";
import type { Section } from "@/lib/types";

/* Tinted from the score's own phase context, at low chroma on purpose: sections
   are background, clips are foreground, and they must never compete. */
function SectionBandBase({ sections }: { sections: Section[] }) {
  const { view, width } = useTimeline();

  return (
    <div className="relative h-[var(--section-h)] flex-none border-b border-solid border-line">
      {sections.map((s, i) => {
        const x0 = timeToX(s.start, view, width);
        const x1 = timeToX(s.end, view, width);
        if (x1 < 0 || x0 > width) return null;
        return (
          <div
            key={i}
            className="absolute top-0 bottom-0 overflow-hidden border-l border-solid border-line"
            style={{ left: x0, width: Math.max(1, x1 - x0), background: phaseTint(s.phase) }}
          >
            <span className="absolute left-[6px] top-[7px] text-[9px] uppercase tracking-[0.12em] text-ink whitespace-nowrap pointer-events-none">
              {s.name || "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* Memoised. Sections do not change while a show plays.
 */
export const SectionBand = memo(SectionBandBase);
