"use client";

import { Play, AlertCircle } from "lucide-react";
import type { Song } from "@/lib/types";
import { CoverCanvas } from "./CoverCanvas";
import { mmss } from "@/lib/grid";

interface SongCardProps {
  song: Song;
  onOpen: (song: Song) => void;
}

const LOCK_COLOUR: Record<string, string> = {
  tight: "var(--ok)",
  loose: "var(--warn)",
  unreliable: "var(--danger)",
};

export function SongCard({ song, onOpen }: SongCardProps) {
  const playable = !!(song.audio && song.bakeable);
  const q = song.quality;
  const why = song.unavailable
    ? song.unavailable
    : !song.bakeable
      ? "No score"
      : !song.audio
        ? "No audio"
        : "";

  const lockLevel = q?.lock?.level ?? "unknown";
  const lockSays = q?.lock?.says;

  return (
    <button
      type="button"
      onClick={playable ? () => onOpen(song) : undefined}
      disabled={!playable}
      title={song.title}
      className={`group flex flex-col text-left p-0 rounded-[var(--radius-md)] overflow-hidden border border-solid border-white/[0.06] transition-all duration-200 ease-[var(--ease)] ${
        playable
          ? "cursor-pointer hover:border-accent/25 hover:-translate-y-[1px]"
          : "cursor-default opacity-40"
      }`}
      style={{
        background: "linear-gradient(180deg, rgba(139,92,246,0.04) 0%, rgba(139,92,246,0.01) 100%)",
        boxShadow: "var(--elev-card)",
      }}
      onMouseEnter={(e) => {
        if (playable) (e.currentTarget as HTMLElement).style.boxShadow = "var(--elev-card-hover)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "var(--elev-card)";
      }}
    >
      <div className="relative w-full overflow-hidden aspect-[4/3]">
        <CoverCanvas song={song} />

        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />

        {playable && (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200">
            <div className="w-[38px] h-[38px] rounded-full flex items-center justify-center scale-90 group-hover:scale-100 transition-transform duration-300 ease-[var(--ease-spring)]"
              style={{ background: "var(--grad-primary)", boxShadow: "0 0 20px rgba(139,92,246,0.4)" }}>
              <Play size={16} fill="white" stroke="white" className="ml-[1px]" />
            </div>
          </div>
        )}

        {song.duration_s != null && (
          <span className="mono absolute right-[6px] top-[6px] px-[5px] py-[1px] rounded-[4px] bg-black/60 backdrop-blur-md text-[10px] text-white/90 tabular-nums font-medium leading-[16px]">
            {mmss(song.duration_s)}
          </span>
        )}

        {!playable && why && (
          <span className="absolute left-[6px] bottom-[6px] flex items-center gap-[3px] px-[6px] py-[2px] rounded-[4px] bg-black/60 backdrop-blur-md text-[10px] text-white/70 leading-[16px]">
            <AlertCircle size={10} />
            {why}
          </span>
        )}
      </div>

      <div className="h-[48px] px-[10px] pt-[8px] pb-[8px] overflow-hidden">
        <div className="flex items-center gap-[4px] h-[18px]">
          <span className="flex-1 min-w-0 text-[13px] font-semibold tracking-[-0.01em] truncate text-ink leading-[18px]">
            {song.title}
          </span>
          {lockSays && (
            <span
              aria-label={`Beat grid: ${lockLevel}`}
              className="flex-none w-[5px] h-[5px] rounded-full"
              style={{ background: LOCK_COLOUR[lockLevel] ?? "var(--ink-dimmer)" }}
            />
          )}
        </div>

        <div className="flex items-center gap-[5px] mt-[2px] h-[14px]">
          {song.bpm && (
            <span className="mono text-[11px] text-ink-dimmer tabular-nums leading-[14px]">
              {Math.round(song.bpm)} BPM
            </span>
          )}
          {q?.key && (
            <>
              <span className="w-[2px] h-[2px] rounded-full bg-white/20 flex-none" />
              <span className="mono text-[11px] text-ink-dimmer leading-[14px]">{q.key}</span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}
