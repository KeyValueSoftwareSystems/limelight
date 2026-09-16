"use client";

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

/* A library card is a thing you scan, not a thing you read. It carries the
   cover, the name, and the two numbers you pick a song by — key and tempo.
   Everything else the analysis knows (bar count, moments, stems, how well the
   beat grid locked) is held on hover, so 40 songs fit on a screen instead of 8
   and every card is the same height. */
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

  /* Key and tempo sit on the face; both are how a song gets chosen. Duration
     rides the cover instead — three numbers on one 152px line only ever
     truncated the last one. */
  const face = [q?.key, song.bpm ? `${Math.round(song.bpm)} bpm` : null]
    .filter(Boolean)
    .join("  ·  ");

  const detail: string[] = [];
  if (q?.bars) detail.push(`${q.bars} bars`);
  if (q?.moments) detail.push(`${q.moments} moments`);
  detail.push(q?.per_beat ? `${q.stems?.length ?? 0} stems` : "no per-beat detail");
  if (q?.stems_absent?.length) detail.push(`no ${q.stems_absent.join("/")}`);
  if (q?.tempo_changes) detail.push(`tempo moves ${q.tempo_changes}×`);

  const lockLevel = q?.lock?.level ?? "unknown";
  const lockSays = q?.lock?.says;

  return (
    <Card
      onClick={playable ? () => onOpen(song) : undefined}
      disabled={!playable}
      title={[song.title, detail.join(" · "), lockSays].filter(Boolean).join("\n")}
    >
      <div className="relative">
        <CoverCanvas song={song} />
        {song.duration_s != null && (
          <span className="mono absolute right-[var(--spacing-s2)] top-[var(--spacing-s2)] px-[4px] py-[1px] rounded-[3px] bg-bg-sunken/70 text-[length:var(--text-2xs)] text-ink/85">
            {mmss(song.duration_s)}
          </span>
        )}
        {!playable && why && (
          <span className="absolute left-[var(--spacing-s2)] bottom-[var(--spacing-s2)] px-[5px] py-[1px] rounded-[3px] bg-bg-sunken/85 border border-solid border-line-strong text-[length:var(--text-2xs)] text-dim">
            {why}
          </span>
        )}
      </div>

      <div className="flex items-center gap-[6px] px-[var(--spacing-s2)] pt-[7px] pb-[2px] min-w-0">
        <b className="flex-1 min-w-0 block text-[length:var(--text-sm)] font-medium tracking-[-0.005em] truncate">
          {song.title}
        </b>
        {lockSays && (
          <span
            aria-label={`Beat grid: ${lockLevel}`}
            className="flex-none w-[5px] h-[5px] rounded-full"
            style={{ background: LOCK_COLOUR[lockLevel] ?? "var(--ink-dimmer)" }}
          />
        )}
      </div>

      <span className="mono block px-[var(--spacing-s2)] pb-[var(--spacing-s2)] text-[length:var(--text-2xs)] text-dimmer truncate">
        {face || "—"}
      </span>
    </Card>
  );
}
