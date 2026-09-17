"use client";

import { useEffect, useCallback, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search, SlidersHorizontal } from "lucide-react";
import { usePortalStore } from "@/store/portal";
import * as api from "@/lib/api";
import { SongCard } from "@/components/library/SongCard";
import { UploadButton } from "@/components/library/UploadButton";
import type { Song } from "@/lib/types";

type SortKey = "name" | "bpm" | "duration" | "recent";

export default function LibraryPage() {
  const songs = usePortalStore((s) => s.songs);
  const setSongs = usePortalStore((s) => s.setSongs);
  const setSong = usePortalStore((s) => s.setSong);
  const setSeed = usePortalStore((s) => s.setSeed);
  const setEdits = usePortalStore((s) => s.setEdits);
  const setVenue = usePortalStore((s) => s.setVenue);
  const setWant = usePortalStore((s) => s.setWant);
  const resetForShow = usePortalStore((s) => s.resetForShow);
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("name");
  const [loaded, setLoaded] = useState(songs.length > 0);

  useEffect(() => {
    if (songs.length) { setLoaded(true); return; }
    api.songs.list().then((d) => { setSongs(d.songs); setLoaded(true); }).catch(() => setLoaded(true));
  }, [songs.length, setSongs]);

  const handleOpen = useCallback(
    (song: Song) => {
      resetForShow();
      setSong(song);
      setSeed(1);
      setEdits([]);
      setVenue(null);
      setWant(null);
      router.push(`/stage?song=${encodeURIComponent(song.name)}&seed=1`);
    },
    [resetForShow, setSong, setSeed, setEdits, setVenue, setWant, router],
  );

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

  const playable = songs.filter((s) => s.audio && s.bakeable).length;

  return (
    <div className="flex flex-col overflow-hidden flex-1 animate-in">
      <div className="flex-none px-[20px] pt-[20px] pb-[16px]">
        <div className="flex items-end justify-between gap-[16px]">
          <div>
            <h1 className="text-[28px] font-semibold tracking-[-0.02em] m-0 leading-[1.1]">Library</h1>
            <p className="text-[13px] text-ink-dimmer mt-[6px] m-0">
              {loaded ? (songs.length ? `${songs.length} songs · ${playable} ready to play` : "No songs yet") : "Loading…"}
            </p>
          </div>
          <UploadButton />
        </div>

        <div className="flex items-center gap-[8px] mt-[16px]">
          <div className="relative flex-1 max-w-[320px]">
            <Search size={14} className="absolute left-[10px] top-1/2 -translate-y-1/2 text-ink-dimmer pointer-events-none" />
            <input
              type="text"
              placeholder="Search by name, key, or tempo…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full h-[34px] pl-[32px] pr-[12px] rounded-[var(--radius-sm)] border border-solid border-line bg-bg-raised/60 text-[13px] text-ink outline-none focus:border-accent focus:bg-bg-raised transition-all duration-[var(--dur-state)] placeholder:text-ink-dimmer"
            />
          </div>

          <div className="flex h-[34px] rounded-[var(--radius-sm)] bg-bg-raised/40 border border-solid border-line p-[3px]">
            {(
              [
                { id: "name", label: "A–Z" },
                { id: "bpm", label: "BPM" },
                { id: "duration", label: "Length" },
                { id: "recent", label: "Recent" },
              ] as { id: SortKey; label: string }[]
            ).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSort(s.id)}
                className={`px-[10px] rounded-[4px] border-0 text-[11px] font-medium cursor-pointer transition-all duration-[var(--dur-state)] ease-[var(--ease)] ${
                  sort === s.id
                    ? "bg-bg-overlay text-ink shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
                    : "bg-transparent text-ink-dimmer hover:text-ink-dim"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-[20px] pb-[48px]">
        {!loaded && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-[12px] pt-[4px]">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-[var(--radius-md)] overflow-hidden" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="aspect-square skeleton" />
                <div className="p-[10px]">
                  <div className="h-[14px] w-[80%] skeleton mb-[6px]" />
                  <div className="h-[10px] w-[50%] skeleton" />
                </div>
              </div>
            ))}
          </div>
        )}

        {loaded && filtered.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-[12px] pt-[4px]">
            {filtered.map((song, i) => (
              <div key={song.name} className="animate-in" style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}>
                <SongCard song={song} onOpen={handleOpen} />
              </div>
            ))}
          </div>
        )}

        {loaded && filtered.length === 0 && songs.length > 0 && (
          <div className="flex flex-col items-center justify-center py-[60px] animate-in">
            <Search size={32} className="text-ink-dimmer/30 mb-[12px]" />
            <p className="text-[14px] text-ink-dim m-0">No songs match &ldquo;{query}&rdquo;</p>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="mt-[8px] text-[13px] text-accent border-0 bg-transparent cursor-pointer hover:underline"
            >
              Clear search
            </button>
          </div>
        )}

        {loaded && songs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-[80px] animate-in">
            <div className="w-[56px] h-[56px] rounded-[var(--radius-lg)] bg-accent/10 flex items-center justify-center mb-[16px]">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-accent">
                <path d="M9 18V5l12-2v13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </div>
            <p className="text-[16px] font-medium text-ink m-0">Your library is empty</p>
            <p className="text-[13px] text-ink-dimmer mt-[6px] m-0 text-center max-w-[280px] leading-[1.5]">
              Upload an MP3 to get started. We&apos;ll analyse the track and prepare it for lighting.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
