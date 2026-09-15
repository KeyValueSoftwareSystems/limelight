"use client";

import type { Song } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { CoverCanvas } from "./CoverCanvas";
import { mmss } from "@/lib/grid";

interface SongCardProps {
  song: Song;
  onOpen: (song: Song) => void;
}

export function SongCard({ song, onOpen }: SongCardProps) {
  const playable = !!(song.audio && song.bakeable);
  const q = song.quality;
  const why = song.unavailable
    ? song.unavailable
    : !song.bakeable
      ? "no score here"
      : !song.audio
        ? "no audio"
        : "";

  const sub = [
    q?.key ? q.key + " · " : "",
    song.bpm ? Math.round(song.bpm) + " bpm" : "—",
    q?.tempo_changes ? ` (moves ${q.tempo_changes}×)` : "",
    song.duration_s ? " · " + mmss(song.duration_s) : "",
  ].join("");

  const facts: string[] = [];
  if (q?.bars) facts.push(q.bars + " bars");
  if (q?.moments) facts.push(q.moments + " moments");
  facts.push(q?.per_beat ? (q.stems?.length ?? 0) + " stems" : "no per-beat detail");
  if (q?.stems_absent?.length) facts.push("no " + q.stems_absent.join("/"));

  const lockLevel = q?.lock?.level ?? "unknown";

  return (
    <Card onClick={playable ? () => onOpen(song) : undefined} disabled={!playable}>
      <CoverCanvas song={song} />
      <div className="px-[var(--spacing-s3)] pt-[var(--spacing-s3)] pb-[var(--spacing-s2)] min-w-0">
        <b className="block text-[length:var(--text-lg)] font-medium tracking-[-0.01em] whitespace-nowrap overflow-hidden text-ellipsis">
          {song.title}
        </b>
        <span className="block mt-[2px] text-[length:var(--text-sm)] text-dim">{sub}</span>
        <span className="block mt-[6px] text-[length:var(--text-xs)] text-dimmer leading-[1.45]">
          {facts.join(" · ")}
        </span>
        {q?.lock?.says && (
          <span
            className="block mt-[7px] text-[length:var(--text-sm)] leading-[1.4]"
            data-level={lockLevel}
            style={{
              color:
                lockLevel === "tight"
                  ? "var(--ok)"
                  : lockLevel === "loose"
                    ? "var(--warn)"
                    : lockLevel === "unreliable"
                      ? "var(--danger)"
                      : "var(--dim)",
            }}
          >
            {q.lock.says}
          </span>
        )}
      </div>
      {!playable && why && (
        <span className="block px-[var(--spacing-s3)] pb-[var(--spacing-s3)] text-[length:var(--text-xs)] tracking-[0.14em] uppercase text-dimmer">
          {why}
        </span>
      )}
    </Card>
  );
}
