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

  const face = [q?.key, song.bpm ? `${Math.round(song.bpm)}` : null]
    .filter(Boolean)
    .join(" · ");

  const detail: string[] = [];
  if (q?.bars) detail.push(`${q.bars} bars`);
  if (q?.moments) detail.push(`${q.moments} moments`);

  const lockLevel = q?.lock?.level ?? "unknown";
  const lockSays = q?.lock?.says;

  return (
    <Card
      onClick={playable ? () => onOpen(song) : undefined}
      disabled={!playable}
      title={[song.title, detail.join(" · "), lockSays].filter(Boolean).join("\n")}
    >
      <div className="relative overflow-hidden">
        <CoverCanvas song={song} />

        <div className="absolute inset-0 bg-gradient-to-t from-[rgba(0,0,0,0.5)] via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--dur-panel)]" />

        {playable && (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-[var(--dur-panel)]">
            <div className="w-[36px] h-[36px] rounded-full bg-accent/90 backdrop-blur-sm flex items-center justify-center shadow-[0_2px_8px_rgba(0,0,0,0.3)] scale-90 group-hover:scale-100 transition-transform duration-[var(--dur-panel)] ease-[var(--ease-spring)]">
              <Play size={16} fill="#0A0B0E" stroke="#0A0B0E" className="ml-[2px]" />
            </div>
          </div>
        )}

        {song.duration_s != null && (
          <span className="mono absolute right-[6px] top-[6px] px-[5px] py-[1px] rounded-[4px] bg-[rgba(0,0,0,0.6)] backdrop-blur-sm text-[10px] text-white/80 tabular-nums">
            {mmss(song.duration_s)}
          </span>
        )}

        {!playable && why && (
          <span className="absolute left-[6px] bottom-[6px] flex items-center gap-[4px] px-[6px] py-[2px] rounded-[4px] bg-[rgba(0,0,0,0.7)] backdrop-blur-sm text-[10px] text-ink-dim">
            <AlertCircle size={10} />
            {why}
          </span>
        )}
      </div>

      <div className="px-[10px] pt-[8px] pb-[8px] min-w-0">
        <div className="flex items-center gap-[5px]">
          <span className="flex-1 min-w-0 block text-[13px] font-medium tracking-[-0.01em] truncate">
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

        <div className="flex items-center gap-[6px] mt-[2px]">
          {song.bpm && (
            <span className="mono text-[10px] text-ink-dimmer tabular-nums">
              {Math.round(song.bpm)} BPM
            </span>
          )}
          {q?.key && (
            <>
              <span className="w-[2px] h-[2px] rounded-full bg-ink-dimmer/50 flex-none" />
              <span className="mono text-[10px] text-ink-dimmer">{q.key}</span>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
