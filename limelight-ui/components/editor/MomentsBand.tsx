"use client";

import { memo, useMemo } from "react";

import { timeToX } from "@/lib/timeline";
import { useTimeline } from "./Timeline";
import type { Moment } from "@/lib/types";

const LEAD = 0;
const CLEAR = 16;
const MAX_CHARS = 42;
const FONT = "10px Geist, system-ui, sans-serif";

let pen: CanvasRenderingContext2D | null = null;
function textWidth(s: string): number {
  if (typeof document === "undefined") return s.length * 5.4;
  if (!pen) {
    pen = document.createElement("canvas").getContext("2d");
    if (pen) pen.font = FONT;
  }
  return pen ? pen.measureText(s).width : s.length * 5.4;
}

function sentence(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (!t) return t;
  const head = t[0].toUpperCase() + t.slice(1);
  return head.length > MAX_CHARS ? head.slice(0, MAX_CHARS - 1).trimEnd() + "…" : head;
}

function MomentsBandBase({ moments }: { moments: Moment[] }) {
  const { view, width } = useTimeline();

  const placed = useMemo(() => {
    const marks = moments
      .map((m, i) => ({
        i,
        t: m.t,
        x: timeToX(m.t, view, width),
        weight: m.weight ?? 0.5,
        title: `${m.kind}${m.what ? " · " + m.what : ""}`,
        text: sentence(m.what ?? m.kind ?? ""),
      }))
      .filter((m) => m.x >= -40 && m.x <= width + 40);

    const taken: Array<[number, number]> = [];
    const byWeight = [...marks].sort((a, b) => b.weight - a.weight || a.x - b.x);
    const labelled = new Set<number>();

    for (const m of byWeight) {
      if (!m.text) continue;
      const left = m.x + LEAD;
      const right = left + textWidth(m.text);
      if (right > width - 4) continue;
      if (taken.some(([a, b]) => left < b + CLEAR && right + CLEAR > a)) continue;
      taken.push([left, right]);
      labelled.add(m.i);
    }

    return marks.map((m) => ({ ...m, label: labelled.has(m.i) }));
  }, [moments, view, width]);

  return (
    <div className="relative h-[var(--moments-h)] flex-none">
      {placed.map((m) => {
        const d = 3 + m.weight * 3;
        return (
          <div
            key={m.i}
            className="absolute top-0 bottom-0 flex flex-col justify-start pointer-events-none"
            style={{ left: m.x }}
            title={m.title}
          >
            <span
              className="block rounded-full bg-ink flex-none"
              style={{
                width: d,
                height: d,
                marginTop: (7 - d) / 2,
                marginLeft: -d / 2,
                opacity: 0.3 + m.weight * 0.5,
              }}
            />
            {m.label && (
              <span
                className="mt-[3px] text-[10px] leading-none whitespace-nowrap"
                style={{ color: "var(--ink-dim)", opacity: 0.55 + m.weight * 0.45 }}
              >
                {m.text}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export const MomentsBand = memo(MomentsBandBase);
