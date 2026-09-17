"use client";

import { AlertTriangle } from "lucide-react";
import { MediaCard, CardTag } from "@/components/ui";
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
  const colours = showColours(show);

  return (
    <MediaCard
      title={show.name}
      hint={`Open ${show.name}`}
      onOpen={() => onOpen(show)}
      media={
        <>
          {song ? <CoverCanvas song={song} /> : <div className="absolute inset-0 bg-[#0B0E15]" />}
          <span className="absolute inset-x-0 bottom-0 flex items-center gap-[3px] px-[10px] pb-[9px] z-10" aria-hidden>
            {colours.map((c, i) => (
              <span
                key={i}
                className="block h-[3px] flex-1 rounded-full"
                style={{ background: c, boxShadow: `0 0 7px -1px ${c}` }}
              />
            ))}
          </span>
        </>
      }
      overlay={
        show.invalid ? (
          <span className="absolute left-[8px] top-[8px] flex items-center gap-[3px] px-[6px] py-[2px] rounded-[4px] bg-black/65 backdrop-blur-md text-[10px] text-warn leading-[14px] z-10">
            <AlertTriangle size={10} className="flex-none" />
            Needs a look
          </span>
        ) : undefined
      }
      meta={song?.title ?? show.song}
      tags={
        <>
          <CardTag>{show.designed_for?.venue_name ?? "Any rig"}</CardTag>
          {show.author && <CardTag>{show.author}</CardTag>}
        </>
      }
      footer={`v${show.version} · ${show.edits.length} edit${show.edits.length === 1 ? "" : "s"}`}
    />
  );
}
