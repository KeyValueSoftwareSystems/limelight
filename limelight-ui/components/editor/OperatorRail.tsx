"use client";

import { usePortalStore } from "@/store/portal";
import { SetlistPanel } from "./SetlistPanel";
import { mmss } from "@/lib/grid";

/** What an operator needs on the left: what is loaded, and what plays next. */
export function OperatorRail() {
  const song = usePortalStore((s) => s.song);
  const show = usePortalStore((s) => s.show);
  const room = usePortalStore((s) => s.room);

  return (
    <nav className="h-full flex flex-col min-h-0">
      <SetlistPanel />

      <div className="flex-none px-[16px] pt-[12px] pb-[10px]">
        <span className="block text-[11px] font-medium text-ink-dimmer">Loaded</span>
        <span className="block mt-[6px] text-[13px] font-medium text-ink truncate">
          {song?.title ?? "Nothing loaded"}
        </span>
        <span className="mono block mt-[3px] text-[11px] text-ink-dimmer tabular-nums truncate">
          {song
            ? `${mmss(song.duration_s ?? 0)} · ${Math.round(song.bpm ?? 0)} BPM` +
              (show ? ` · ${show.grid.bars} bars` : "")
            : "—"}
        </span>
      </div>

      <div className="flex-none px-[16px] py-[10px] border-t border-solid border-white/[0.05]">
        <span className="block text-[11px] font-medium text-ink-dimmer">Room</span>
        <span className="block mt-[6px] text-[13px] text-ink-dim truncate">
          {room?.name ?? "Any rig"}
        </span>
      </div>

      <div className="flex-1" />
    </nav>
  );
}
