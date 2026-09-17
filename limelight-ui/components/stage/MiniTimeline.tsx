"use client";

import { useCallback, useRef } from "react";
import { mmss } from "@/lib/grid";
import type { Section } from "@/lib/types";

/** The whole song in one bar: every section, where you are, and click to go. */
export function MiniTimeline({
  sections,
  duration,
  currentTime,
  onSeek,
}: {
  sections: Section[];
  duration: number;
  currentTime: number;
  onSeek: (t: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const seekAt = useCallback(
    (clientX: number) => {
      const r = ref.current?.getBoundingClientRect();
      if (!r || !duration) return;
      onSeek(Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration)));
    },
    [duration, onSeek],
  );

  const at = duration ? Math.max(0, Math.min(1, currentTime / duration)) : 0;

  return (
    <div className="flex flex-col gap-[6px]">
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label="Song position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(currentTime)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seekAt(e.clientX);
        }}
        onPointerMove={(e) => { if (e.buttons === 1) seekAt(e.clientX); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") onSeek(Math.max(0, currentTime - 5));
          if (e.key === "ArrowRight") onSeek(Math.min(duration, currentTime + 5));
        }}
        className="liquid-well relative h-[34px] w-full rounded-[var(--radius-sm)] overflow-hidden cursor-pointer select-none"
      >
        {sections.map((sec, i) => {
          const left = duration ? (sec.start / duration) * 100 : 0;
          const width = duration ? ((sec.end - sec.start) / duration) * 100 : 0;
          const live = currentTime >= sec.start && currentTime < sec.end;
          const name = sec.name ? sec.name.charAt(0).toUpperCase() + sec.name.slice(1) : "";
          return (
            <span
              key={i}
              title={`${name} · ${mmss(sec.start)}`}
              className="absolute inset-y-0 flex items-center justify-center overflow-hidden border-r border-solid border-black/40"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                background: live ? "rgba(110,151,206,0.22)" : "rgba(255,255,255,0.035)",
              }}
            >
              <span
                className={`px-[4px] text-[10px] truncate ${live ? "text-ink" : "text-ink-dimmer"}`}
              >
                {name}
              </span>
            </span>
          );
        })}

        <span
          aria-hidden
          className="absolute top-0 bottom-0 w-px pointer-events-none"
          style={{ left: `${at * 100}%`, background: "var(--playhead)", boxShadow: "0 0 6px rgba(255,255,255,0.5)" }}
        />
      </div>

      <div className="flex items-baseline justify-between">
        <span className="mono text-[10px] text-ink-dimmer tabular-nums">{mmss(currentTime)}</span>
        <span className="mono text-[10px] text-ink-dimmer tabular-nums">{mmss(duration)}</span>
      </div>
    </div>
  );
}
