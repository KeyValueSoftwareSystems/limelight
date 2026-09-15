"use client";

import { useCallback, useRef, useState } from "react";
import { FIXTURE } from "@/lib/fixture";
import { mmss } from "@/lib/grid";

const MIN_TIMELINE = 180;
const MIN_PREVIEW = 160;

export function EditorLayout({ song }: { song: string }) {
  const [timelineH, setTimelineH] = useState(300);
  const bodyRef = useRef<HTMLDivElement>(null);

  /* Drag the divider. No easing anywhere near a pointer gesture. */
  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      const box = bodyRef.current?.getBoundingClientRect();
      if (!box) return;
      const next = box.bottom - ev.clientY;
      setTimelineH(Math.max(MIN_TIMELINE, Math.min(next, box.height - MIN_PREVIEW)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);

  const show = FIXTURE.show;

  return (
    <div className="h-screen flex flex-col bg-bg text-ink overflow-hidden">
      {/* header */}
      <header className="flex-none flex items-center gap-[var(--spacing-s4)] px-[var(--spacing-s5)] h-[52px] border-b border-solid border-line">
        <a
          href="/studio"
          className="text-[length:var(--text-sm)] text-ink-dim hover:text-ink no-underline transition-colors duration-[var(--dur-state)]"
        >
          ‹ Songs
        </a>
        <div className="flex items-baseline gap-[var(--spacing-s3)] min-w-0">
          <h1 className="text-[length:var(--text-lg)] font-medium truncate">{FIXTURE.title}</h1>
          <span className="mono text-[length:var(--text-xs)] text-ink-dim whitespace-nowrap">
            {Math.round(show.grid.bpm)} bpm · {show.grid.bars} bars · {mmss(show.duration_s ?? 0)}
          </span>
        </div>
        <span className="flex-1" />
        <span className="label">Designing for</span>
        <span className="text-[length:var(--text-sm)]">KeyCode Stage · {show.rig}</span>
      </header>

      <div ref={bodyRef} className="flex-1 min-h-0 flex flex-col">
        {/* palette | preview | inspector */}
        <div className="flex-1 min-h-0 flex">
          <aside className="flex-none w-[190px] border-r border-solid border-line overflow-y-auto p-[var(--spacing-s4)]">
            <div className="label">Effects</div>
          </aside>

          <main className="flex-1 min-w-0 p-[var(--spacing-s4)]">
            <div className="w-full h-full rounded-[7px] bg-[var(--stage)] border border-solid border-line flex items-center justify-center">
              <span className="text-[length:var(--text-xs)] text-ink-dimmer">stage preview</span>
            </div>
          </main>

          <aside className="flex-none w-[260px] border-l border-solid border-line overflow-y-auto p-[var(--spacing-s4)]">
            <div className="label">Inspector</div>
          </aside>
        </div>

        {/* divider */}
        <div
          onPointerDown={startResize}
          className="flex-none h-[7px] cursor-row-resize bg-bg border-y border-solid border-line hover:bg-bg-raised transition-colors duration-[var(--dur-state)]"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize timeline"
        />

        {/* timeline */}
        <section
          style={{ height: timelineH }}
          className="flex-none min-h-0 bg-bg-sunken overflow-hidden flex flex-col"
        >
          <div className="p-[var(--spacing-s4)] text-[length:var(--text-xs)] text-ink-dimmer">
            timeline · {song}
          </div>
        </section>
      </div>
    </div>
  );
}
