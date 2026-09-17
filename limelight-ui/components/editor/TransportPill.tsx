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
    <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-[14px] z-20">
      <div className="liquid pointer-events-auto flex items-center gap-[12px] h-[52px] pl-[7px] pr-[18px] rounded-full">
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={playing}
          title={playing ? "Pause (space)" : "Play (space)"}
          className="liquid liquid-key liquid-accent flex-none inline-flex items-center justify-center w-[38px] h-[38px] rounded-full cursor-pointer"
        >
          <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
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

        <span className="flex flex-col leading-none gap-[4px]" title="Playhead · song length">
          <span className="mono text-[15px] tabular-nums text-ink leading-none tracking-[-0.01em]">
            {mmssms(currentTime)}
            <span className="text-ink-dimmer text-[12px]"> / {mmss(duration)}</span>
          </span>
          <span className="mono text-[10px] tabular-nums text-ink-dimmer leading-none">
            Bar <span className="text-ink-dim">{pos ? pos.bar : "—"}</span>
            {"·"}
            {pos ? pos.beat : "—"}
          </span>
        </span>
      </div>
    </div>
  );
}
