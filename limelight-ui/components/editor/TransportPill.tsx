"use client";

import { mmss, mmssms, positionAt } from "@/lib/grid";
import type { Grid } from "@/lib/types";

export function TransportPill({
  currentTime,
  duration,
  grid,
  playing,
  onToggle,
}: {
  currentTime: number;
  duration: number;
  grid: Grid | null;
  playing: boolean;
  onToggle: () => void;
}) {
  const pos = grid ? positionAt(currentTime, grid) : null;

  return (
    <div
      data-transport-pill
      className="liquid flex-none flex items-center gap-[11px] h-[40px] pl-[5px] pr-[15px] rounded-full"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={playing}
        title={playing ? "Pause (space)" : "Play (space)"}
        className="liquid liquid-key liquid-accent flex-none inline-flex items-center justify-center w-[30px] h-[30px] rounded-full cursor-pointer"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
          {playing ? (
            <>
              <rect x="2" y="1.5" width="3" height="9" rx="1" />
              <rect x="7" y="1.5" width="3" height="9" rx="1" />
            </>
          ) : (
            <path d="M3 1.8v8.4a.6.6 0 0 0 .93.5l6.3-4.2a.6.6 0 0 0 0-1L3.93 1.3A.6.6 0 0 0 3 1.8z" />
          )}
        </svg>
        <span className="sr-only">{playing ? "Pause" : "Play"}</span>
      </button>

      <span className="flex flex-col leading-none gap-[3px]" title="Playhead \u00b7 song length">
        <span className="mono text-[13.5px] tabular-nums text-ink leading-none tracking-[-0.01em]">
          {mmssms(currentTime)}
          <span className="text-ink-dimmer text-[11px]"> / {mmss(duration)}</span>
        </span>
        <span className="mono text-[10px] tabular-nums text-ink-dimmer leading-none">
          Bar <span className="text-ink-dim">{pos ? pos.bar : "\u2014"}</span>
          {"\u00b7"}
          {pos ? pos.beat : "\u2014"}
        </span>
      </span>
    </div>
  );
}
