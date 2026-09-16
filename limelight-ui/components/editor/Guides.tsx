"use client";

import { memo, useMemo } from "react";

import { barTicks, beatTicks, energyPeaks, timeTicks, timeToX } from "@/lib/timeline";
import type { Tick } from "@/lib/timeline";
import { useTimeline } from "./Timeline";
import type { Grid, Moment, Section } from "@/lib/types";

/* ── vertical guides ──────────────────────────────────────────────────────────
   A ruled line through the whole editor, at whatever the creator is working
   against. The bands at the top say WHERE the sections and the moments are; a
   line is what lets you see that a clip's left edge and the drop are the same
   instant three lanes down, which no band can do.

   Only measures that exist as INSTANTS are offered, because a line is an
   instant. Energy is a curve over bars, so the honest thing to rule at is the
   bar where it turns over — its peaks — not "energy". Nothing else in a show
   has a position on this axis at all: colour, intensity and family are
   properties of a clip, not places in the song, so they are not on the list. */

export type GuideKind = "bar" | "beat" | "time" | "section" | "moment" | "energy";

export const GUIDES: { id: GuideKind; label: string; hint: string }[] = [
  { id: "bar", label: "Bars", hint: "musical" },
  { id: "beat", label: "Beats", hint: "close zoom" },
  { id: "time", label: "Clock time", hint: "s · ms" },
  { id: "section", label: "Sections", hint: "intro, drop…" },
  { id: "moment", label: "Moments", hint: "what the score found" },
  { id: "energy", label: "Energy peaks", hint: "where it lifts" },
];

/* Each measure has its own weight, and they are deliberately unequal: all six
   at once still has to be readable. The musical grid is faint structure, the
   score's own findings are brighter and dashed so they read as findings rather
   than as ruling, and clock time is the only one that carries text — it is the
   one you turn on to answer a question, not to work against. */
interface Ink { line: string; strong: string; dash?: [number, number]; label?: boolean }
const INK: Record<GuideKind, Ink> = {
  bar:     { line: "rgba(230,234,242,0.13)", strong: "rgba(230,234,242,0.24)" },
  beat:    { line: "rgba(230,234,242,0.06)", strong: "rgba(230,234,242,0.14)" },
  time:    { line: "rgba(105,175,255,0.24)", strong: "rgba(105,175,255,0.44)", label: true },
  section: { line: "rgba(230,234,242,0.32)", strong: "rgba(230,234,242,0.32)" },
  moment:  { line: "rgba(232,163,61,0.30)", strong: "rgba(232,163,61,0.30)", dash: [2, 3] },
  energy:  { line: "rgba(165,212,98,0.28)", strong: "rgba(165,212,98,0.48)", dash: [3, 3] },
};

/** A dashed rule, drawn as a gradient because a 1px border cannot be dashed
 *  vertically in a way that survives a repaint at sub-pixel offsets. */
function paint(ink: Ink, colour: string): React.CSSProperties {
  if (!ink.dash) return { background: colour };
  const [on, off] = ink.dash;
  return {
    backgroundImage:
      `repeating-linear-gradient(to bottom, ${colour} 0 ${on}px, transparent ${on}px ${on + off}px)`,
  };
}

function GuidesBase({
  kinds,
  grid,
  sections,
  moments,
  energy,
}: {
  kinds: GuideKind[];
  grid: Grid;
  sections: Section[];
  moments: Moment[];
  energy: (number | null)[];
}) {
  const { view, width } = useTimeline();

  /* One pass per measure, and only for the ones that are on. Recomputed when
     the view changes — which is what a pan or a zoom is — and never when the
     playhead moves, which is sixty times a second. */
  const layers = useMemo(() => {
    const on = new Set(kinds);
    const out: { kind: GuideKind; ticks: Tick[] }[] = [];
    /* Beats first so a bar line is drawn OVER the beat line at the same place. */
    if (on.has("beat")) out.push({ kind: "beat", ticks: beatTicks(view, grid, width) });
    if (on.has("bar")) out.push({ kind: "bar", ticks: barTicks(view, grid, width).map((b) => ({ t: b.t })) });
    if (on.has("time")) out.push({ kind: "time", ticks: timeTicks(view, width) });
    /* Only clock time carries text, and only because its line is meaningless
       without a number. Sections and moments are named by the band directly
       above, and an energy peak's height is drawn by the curve directly below —
       repeating either into a 12px strip would just stack words on top of the
       times, which are the one thing there to be read. */
    if (on.has("section")) out.push({ kind: "section", ticks: sections.map((s) => ({ t: s.start })) });
    if (on.has("moment")) out.push({ kind: "moment", ticks: moments.map((m) => ({ t: m.t })) });
    if (on.has("energy")) out.push({ kind: "energy", ticks: energyPeaks(energy, grid) });
    return out;
  }, [kinds, view, width, grid, sections, moments, energy]);

  if (!layers.length) return null;

  /** x for a tick that is actually on screen, else null. A section starting a
   *  minute before the view would otherwise put a line at x = -40000. */
  const visible = (t: number) => {
    const x = timeToX(t, view, width);
    return x >= -1 && x <= width + 1 ? x : null;
  };

  return (
    <>
      {/* The lines sit UNDER the clips: z-index auto and first in the DOM, while
          every clip carries a positive one. A guide drawn over a clip would be
          reading as a stripe painted on the clip. */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {layers.map(({ kind, ticks }) =>
          ticks.map((t, i) => {
            const x = visible(t.t);
            if (x === null) return null;
            const ink = INK[kind];
            return (
              <span
                key={`${kind}:${i}`}
                className="absolute top-0 bottom-0 w-px"
                style={{ left: x, ...paint(ink, t.strong ? ink.strong : ink.line) }}
              />
            );
          }),
        )}
      </div>

      {/* Labels live in a strip above the energy band, where there is nothing to
          collide with, and above the clips so they stay readable over one. Below
          the playhead's z-20, because the playhead crosses everything. */}
      <div
        className="absolute left-0 right-0 z-[18] pointer-events-none overflow-hidden h-[12px]"
        style={{ bottom: "calc(var(--energy-h) + 1px)" }}
      >
        {layers.map(({ kind, ticks }) =>
          INK[kind].label
            ? ticks.map((t, i) => {
                const x = t.label ? visible(t.t) : null;
                if (x === null) return null;
                return (
                  <span
                    key={`${kind}:${i}`}
                    className="absolute top-0 mono text-[8px] leading-[12px] px-[3px] rounded-[2px] whitespace-nowrap tabular-nums"
                    style={{
                      left: Math.min(x + 2, Math.max(0, width - 52)),
                      color: INK[kind].strong,
                      background: "rgba(10,11,14,0.74)",
                    }}
                  >
                    {t.label}
                  </span>
                );
              })
            : null,
        )}
      </div>
    </>
  );
}

/* Memoised. Guides are a function of the view and the score; the playhead moves
   sixty times a second and changes neither. */
export const Guides = memo(GuidesBase);
