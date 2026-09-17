"use client";

import { memo } from "react";

import { timeToX } from "@/lib/timeline";
import { phaseTint } from "@/lib/tokens";
import { useTimeline } from "./Timeline";
import type { Section } from "@/lib/types";

/* Tinted from the score's own phase context, at low chroma on purpose: sections
   are background, clips are foreground, and they must never compete. */
/** Breathing room between a section's edge and its name. */
const PAD = 6;

/** The score writes section names in lower case; the UI does not. */
function titled(name: string | null | undefined): string {
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "";
}

function SectionBandBase({ sections }: { sections: Section[] }) {
  const { view, width } = useTimeline();

  return (
    <div className="relative h-[var(--section-h)] flex-none border-b border-solid border-line">
      {sections.map((s, i) => {
        const x0 = timeToX(s.start, view, width);
        const x1 = timeToX(s.end, view, width);
        if (x1 < 0 || x0 > width) return null;
        const w = Math.max(1, x1 - x0);
        /* The name rides with the window, not with the section's start. Pinned
           at PAD from the start it walked off the left edge the moment you
           zoomed into the middle of a section, and since the block clips its own
           overflow the name came back as "NTRO", "OLO", "REAKDOWN" — or as
           nothing at all. Which section you are inside is the one thing this
           band is for, and it went blank exactly when you had zoomed in far
           enough to need telling.

           It slides along instead: PAD from whichever edge is visible, and never
           past the section's own end, so a section on its way out hands the
           label over at its trailing edge rather than letting the next one
           claim it. */
        const labelX = Math.min(Math.max(PAD, PAD - x0), Math.max(PAD, w - PAD));
        return (
          <div
            key={i}
            className="absolute top-0 bottom-0 overflow-hidden border-l border-solid border-line"
            style={{ left: x0, width: w, background: phaseTint(s.phase) }}
          >
            <span
              className="absolute top-[8px] text-[10px] font-medium tracking-[0.01em] text-ink-dim whitespace-nowrap pointer-events-none"
              style={{ left: labelX }}
            >
              {titled(s.name) || "\u2014"}
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
