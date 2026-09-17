"use client";

import { Play, AlertCircle } from "lucide-react";
import type { Song } from "@/lib/types";
import { Card } from "@/components/ui/Card";
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
      ? "no score"
      : !song.audio
        ? "no audio"
        : "";

  const lockLevel = q?.lock?.level ?? "unknown";
  const lockSays = q?.lock?.says;

  const detail: string[] = [];
  if (q?.bars) detail.push(`${q.bars} bars`);
  if (q?.moments) detail.push(`${q.moments} moments`);

  return (
    <Card
      onClick={playable ? () => onOpen(song) : undefined}
      disabled={!playable}
      title={[song.title, detail.join(" · "), lockSays].filter(Boolean).join("\n")}
    >
      <div className="relative overflow-hidden aspect-[4/3]">
        <CoverCanvas song={song} />

        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />

        {playable && (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200">
            <div className="w-[40px] h-[40px] rounded-full flex items-center justify-center shadow-[0_4px_16px_rgba(0,0,0,0.4)] scale-90 group-hover:scale-100 transition-transform duration-300 ease-[var(--ease-spring)]"
              style={{ background: "linear-gradient(135deg, #FBBF24 0%, #F59E0B 100%)" }}>
              <Play size={18} fill="#0C0D12" stroke="#0C0D12" className="ml-[2px]" />
            </div>
          </div>
        )}

        {song.duration_s != null && (
          <span className="mono absolute right-[8px] top-[8px] px-[6px] py-[2px] rounded-[6px] bg-black/60 backdrop-blur-md text-[10px] text-white/90 tabular-nums font-medium">
            {mmss(song.duration_s)}
          </span>
        )}

        {!playable && why && (
          <span className="absolute left-[8px] bottom-[8px] flex items-center gap-[4px] px-[8px] py-[3px] rounded-[6px] bg-black/60 backdrop-blur-md text-[10px] text-white/70">
            <AlertCircle size={10} />
            {why}
          </span>
        )}
      </div>

      <div className="px-[12px] pt-[10px] pb-[10px] min-w-0">
        <div className="flex items-center gap-[5px]">
          <span className="flex-1 min-w-0 block text-[13px] font-medium tracking-[-0.01em] truncate text-ink">
            {song.title}
          </span>
          {lockSays && (
            <span
              aria-label={`Beat grid: ${lockLevel}`}
              className="flex-none w-[6px] h-[6px] rounded-full"
              style={{ background: LOCK_COLOUR[lockLevel] ?? "var(--ink-dimmer)" }}
            />
          )}
        </div>

        <div className="flex items-center gap-[6px] mt-[3px]">
          {song.bpm && (
            <span className="mono text-[10px] text-ink-dimmer tabular-nums font-medium">
              {Math.round(song.bpm)} BPM
            </span>
          )}
          {q?.key && (
            <>
              <span className="w-[2px] h-[2px] rounded-full bg-white/20 flex-none" />
              <span className="mono text-[10px] text-ink-dimmer font-medium">{q.key}</span>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
