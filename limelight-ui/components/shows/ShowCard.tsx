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
      <div className="relative w-full aspect-[3/2] overflow-hidden">
        {song ? <CoverCanvas song={song} /> : <div className="absolute inset-0 bg-[#0B0E15]" />}

        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors duration-200 flex items-center justify-center">
          <span
            className="w-[34px] h-[34px] rounded-full flex items-center justify-center opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 transition-all duration-250 ease-[var(--ease-spring)]"
            style={{ background: "rgba(236,238,246,0.95)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6), 0 2px 10px rgba(0,0,0,0.45)" }}
          >
            <Play size={14} fill="#0B0E15" stroke="#0B0E15" className="ml-[1px]" />
          </span>
        </div>

        {show.invalid && (
          <span className="absolute left-[8px] top-[8px] flex items-center gap-[3px] px-[6px] py-[2px] rounded-[4px] bg-black/65 backdrop-blur-md text-[10px] text-warn leading-[14px]">
            <AlertTriangle size={10} className="flex-none" />
            Needs a look
          </span>
        )}

        <span className="absolute inset-x-0 bottom-0 flex items-center gap-[3px] px-[10px] pb-[9px]" aria-hidden>
          {colours.map((c, i) => (
            <span
              key={i}
              className="block h-[3px] flex-1 rounded-full"
              style={{ background: c, boxShadow: `0 0 7px -1px ${c}` }}
            />
          ))}
        </span>
      </div>

      <div className="flex flex-col gap-[7px] px-[14px] pt-[12px] pb-[13px] min-w-0">
        <div className="min-w-0">
          <span className="block text-[14px] font-semibold tracking-[-0.012em] text-ink truncate">
            {show.name}
          </span>
          <span className="block mt-[3px] text-[11.5px] text-ink-dim truncate">
            {song?.title ?? show.song}
          </span>
        </div>

        <span className="liquid-well self-start px-[7px] py-[2px] rounded-full text-[10.5px] text-ink-dim leading-[15px] max-w-full truncate">
          {room ?? "Any rig"}
        </span>

        <span className="mono text-[10.5px] text-ink-dimmer tabular-nums">
          v{show.version} · {show.edits.length} edit{show.edits.length === 1 ? "" : "s"}
        </span>
      </div>
    </button>
  );
}
