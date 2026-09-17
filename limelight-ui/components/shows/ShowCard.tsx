"use client";

import { AlertTriangle, Play } from "lucide-react";
import { ShowThumb } from "./ShowThumb";
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

  return (
    <button
      type="button"
      onClick={() => onOpen(show)}
      title={show.name}
      className="panel panel-lift group flex flex-col text-left p-0 rounded-[var(--radius-lg)] overflow-hidden cursor-pointer w-full"

    >
      <div className="relative w-full overflow-hidden" style={{ paddingBottom: "62%" }}>
        <div className="absolute inset-0">
          <ShowThumb show={show} song={song} className="absolute inset-0" />
        </div>

        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />

        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <span
            className="w-[36px] h-[36px] rounded-full flex items-center justify-center scale-90 group-hover:scale-100 transition-transform duration-300 ease-[var(--ease-spring)]"
            style={{ background: "var(--mat-accent)", boxShadow: "var(--mat-accent-edge), var(--mat-accent-shadow)" }}
          >
            <Play size={15} fill="var(--lit-ink-on)" stroke="var(--lit-ink-on)" className="ml-[1px]" />
          </span>
        </div>

        <span className="mono absolute right-[7px] top-[7px] px-[5px] py-[1px] rounded-[4px] bg-black/60 backdrop-blur-md text-[10px] text-white/90 tabular-nums font-medium leading-[16px]">
          v{show.version}
        </span>

        {show.invalid && (
          <span className="absolute left-[7px] top-[7px] flex items-center gap-[3px] px-[5px] py-[1px] rounded-[4px] bg-black/65 backdrop-blur-md text-[10px] text-warn leading-[16px]">
            <AlertTriangle size={10} className="flex-none" />
            Needs a look
          </span>
        )}

        <span className="absolute left-[9px] right-[9px] bottom-[7px] block">
          <span className="block text-[13px] font-semibold text-white leading-[17px] truncate">
            {show.name}
          </span>
          <span className="block text-[11px] text-white/60 leading-[15px] truncate">
            {song?.title ?? show.song}
          </span>
        </span>
      </div>

      <div className="h-[34px] px-[10px] flex items-center gap-[6px] overflow-hidden flex-none">
        <span className="flex-1 min-w-0 text-[11px] text-ink-dim truncate">
          {room ?? <span className="text-ink-dimmer">Any rig</span>}
        </span>
        <span className="mono text-[11px] text-ink-dimmer tabular-nums flex-none">
          {show.edits.length} edit{show.edits.length === 1 ? "" : "s"}
        </span>
      </div>
    </button>
  );
}
