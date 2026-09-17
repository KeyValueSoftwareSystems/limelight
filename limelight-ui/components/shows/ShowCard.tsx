"use client";

import { AlertTriangle, Play } from "lucide-react";
import { CoverCanvas } from "@/components/library/CoverCanvas";
import { showColours } from "./showColours";
import type { ShowFile, Song } from "@/lib/types";

export function ShowCard({
  show,
  song,
  onOpen,
}: {
  show: ShowFile;
  song?: Song;
  onOpen: (show: ShowFile) => void;
}) {
  const room = show.designed_for?.venue_name;
  const colours = showColours(show);

  return (
    <button
      type="button"
      onClick={() => onOpen(show)}
      title={show.name}
      className="panel panel-lift group flex flex-col text-left p-0 rounded-[var(--radius-lg)] overflow-hidden cursor-pointer w-full"
    >
      <div className="relative w-full overflow-hidden" style={{ paddingBottom: "100%" }}>
        {song ? (
          <CoverCanvas song={song} />
        ) : (
          <div className="absolute inset-0 bg-[#0B0E15]" />
        )}

        <div
          className="absolute inset-x-0 bottom-0 h-[62%] pointer-events-none"
          style={{ background: "linear-gradient(180deg, rgba(4,5,11,0) 0%, rgba(4,5,11,0.88) 72%, rgba(4,5,11,0.96) 100%)" }}
        />

        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors duration-200 flex items-center justify-center">
          <span
            className="w-[36px] h-[36px] rounded-full flex items-center justify-center opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 transition-all duration-250 ease-[var(--ease-spring)]"
            style={{ background: "rgba(236,238,246,0.95)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6), 0 2px 10px rgba(0,0,0,0.45)" }}
          >
            <Play size={15} fill="#0B0E15" stroke="#0B0E15" className="ml-[1px]" />
          </span>
        </div>

        {show.invalid && (
          <span className="absolute left-[9px] top-[9px] flex items-center gap-[3px] px-[6px] py-[2px] rounded-[4px] bg-black/60 backdrop-blur-md text-[10px] text-warn leading-[14px]">
            <AlertTriangle size={10} className="flex-none" />
            Needs a look
          </span>
        )}

        <div className="absolute inset-x-0 bottom-0 px-[11px] pb-[10px]">
          <span className="flex items-center gap-[3px] mb-[7px]" aria-hidden>
            {colours.map((c, i) => (
              <span
                key={i}
                className="block h-[3px] flex-1 rounded-full"
                style={{ background: c, boxShadow: `0 0 7px -1px ${c}` }}
              />
            ))}
          </span>
          <span className="block text-[13px] font-semibold text-white leading-[17px] truncate">
            {show.name}
          </span>
          <span className="block text-[11.5px] text-white/55 leading-[15px] truncate">
            {song?.title ?? show.song}
          </span>
        </div>
      </div>

      <div className="flex items-baseline gap-[8px] px-[11px] py-[9px] min-w-0">
        <span className="text-[11px] text-ink-dim truncate flex-1">{room ?? "Any rig"}</span>
        <span className="mono text-[10.5px] text-ink-dimmer tabular-nums flex-none">
          v{show.version} · {show.edits.length}
        </span>
      </div>
    </button>
  );
}
