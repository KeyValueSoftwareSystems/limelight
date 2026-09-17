"use client";

import { useEffect, useState, useMemo } from "react";
import { Search } from "lucide-react";
import { Field, SegmentedControl } from "@/components/ui";
import { usePortalStore } from "@/store/portal";
import * as api from "@/lib/api";
import { SongCard } from "./SongCard";
import { UploadButton } from "./UploadButton";
import type { Song } from "@/lib/types";

type SortKey = "name" | "bpm" | "duration" | "recent";

export function SongPicker({
  onPick,
  multi = false,
  chosen = [],
  onToggle,
}: {
  onPick: (song: Song) => void;
  multi?: boolean;
  chosen?: string[];
  onToggle?: (song: Song) => void;
}) {
  const songs = usePortalStore((s) => s.songs);
  const setSongs = usePortalStore((s) => s.setSongs);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("name");
  const [loaded, setLoaded] = useState(songs.length > 0);

  useEffect(() => {
    if (songs.length) { setLoaded(true); return; }
    api.songs.list().then((d) => { setSongs(d.songs); setLoaded(true); }).catch(() => setLoaded(true));
  }, [songs.length, setSongs]);

  const filtered = useMemo(() => {
    let list = songs;
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          (s.quality?.key ?? "").toLowerCase().includes(q),
      );
    }
    const sorted = [...list];
    switch (sort) {
      case "bpm": sorted.sort((a, b) => (a.bpm ?? 0) - (b.bpm ?? 0)); break;
      case "duration": sorted.sort((a, b) => (a.duration_s ?? 0) - (b.duration_s ?? 0)); break;
      case "recent": sorted.reverse(); break;
      default: sorted.sort((a, b) => a.title.localeCompare(b.title));
    }
    return sorted;
  }, [songs, query, sort]);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex-none flex items-center gap-[20px] flex-wrap pb-[16px]">
        <div className="w-[300px] max-w-full">
          <Field
            icon={<Search size={15} />}
            type="text"
            placeholder="Search by name, key or tempo"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search songs"
          />
        </div>
        <SegmentedControl
          aria-label="Sort songs"
          value={sort}
          onChange={setSort}
          segments={[
            { id: "name" as SortKey, label: "A–Z" },
            { id: "bpm" as SortKey, label: "Tempo" },
            { id: "duration" as SortKey, label: "Length" },
            { id: "recent" as SortKey, label: "Recent" },
          ]}
        />
        <span className="flex-1" />
        <UploadButton />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pb-[48px]">
        {!loaded && (
          <div className="card-grid pt-[4px]">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="rounded-[var(--radius-md)] overflow-hidden" style={{ animationDelay: `${i * 50}ms` }}>
                <div className="aspect-[4/3] skeleton" />
                <div className="h-[48px] p-[10px]">
                  <div className="h-[12px] w-[75%] skeleton mb-[6px]" />
                  <div className="h-[10px] w-[45%] skeleton" />
                </div>
              </div>
            ))}
          </div>
        )}

        {loaded && filtered.length > 0 && (
          <div className="card-grid pt-[4px]">
            {filtered.map((song, i) => (
              <div key={song.name} className="animate-in h-full" style={{ animationDelay: `${Math.min(i * 26, 360)}ms` }}>
                <SongCard
                  song={song}
                  onOpen={multi && onToggle ? onToggle : onPick}
                  position={multi ? (chosen.indexOf(song.name) >= 0 ? chosen.indexOf(song.name) + 1 : null) : null}
                />
              </div>
            ))}
          </div>
        )}

        {loaded && filtered.length === 0 && songs.length > 0 && (
          <div className="flex flex-col items-center justify-center py-[76px]">
            <p className="text-[15px] font-semibold text-ink m-0">Nothing matches &ldquo;{query}&rdquo;</p>
            <p className="text-[13px] text-ink-dim mt-[6px] m-0">Try a title, a key or a tempo.</p>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="mt-[14px] text-[13px] text-ink border-0 bg-transparent cursor-pointer hover:underline font-medium p-0"
            >
              Clear search
            </button>
          </div>
        )}

        {loaded && songs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-[92px]">
            <p className="text-[17px] font-semibold text-ink m-0">No songs yet</p>
            <p className="text-[13px] text-ink-dim mt-[8px] mb-0 text-center max-w-[360px] leading-[1.6]">
              Upload an MP3 and Limelight will analyse the track, find its beats and
              sections, and get it ready to light.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
