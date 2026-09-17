"use client";

import { useEffect, useCallback, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
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
    <div className="flex flex-col overflow-hidden flex-1 surface-glow animate-in">
      <div className="flex-none px-[24px] pt-[24px] pb-[18px]">
        <div className="flex items-end justify-between gap-[16px]">
          <div>
            <h1 className="text-[28px] font-bold tracking-[-0.03em] m-0 leading-[1.1] bg-clip-text"
              style={{ background: "linear-gradient(180deg, #EDEEF3 30%, #8E93A3 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Library
            </h1>
            <p className="text-[13px] text-ink-dimmer mt-[6px] m-0">
              {loaded ? (songs.length ? `${songs.length} songs · ${playable} ready` : "No songs yet") : "Loading…"}
            </p>
          </div>
          <UploadButton />
        </div>

        <div className="flex items-center gap-[10px] mt-[18px]">
          <div className="relative flex-1 max-w-[340px]">
            <Search size={14} className="absolute left-[12px] top-1/2 -translate-y-1/2 text-ink-dimmer pointer-events-none" />
            <input
              type="text"
              placeholder="Search by name, key, or tempo…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full h-[36px] pl-[34px] pr-[12px] rounded-[var(--radius-sm)] border border-solid border-white/[0.06] bg-white/[0.03] text-[13px] text-ink outline-none focus:border-accent/50 focus:bg-white/[0.05] focus:shadow-[0_0_0_3px_rgba(245,158,11,0.08)] transition-all duration-200 placeholder:text-ink-dimmer"
            />
          </div>

          <div className="flex h-[36px] rounded-[var(--radius-sm)] bg-white/[0.02] border border-solid border-white/[0.05] p-[3px]">
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
                className={`px-[10px] rounded-[6px] border-0 text-[11px] font-medium cursor-pointer transition-all duration-200 ease-[var(--ease)] ${
                  sort === s.id
                    ? "text-ink"
                    : "bg-transparent text-ink-dimmer hover:text-ink-dim"
                }`}
                style={sort === s.id ? {
                  background: "linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.04) 100%)",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.06)",
                } : undefined}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-[24px] pb-[48px]">
        {!loaded && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-[14px] pt-[4px]">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-[var(--radius-md)] overflow-hidden border border-solid border-white/[0.04]" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="aspect-[4/3] skeleton" />
                <div className="p-[12px]">
                  <div className="h-[14px] w-[80%] skeleton mb-[8px]" />
                  <div className="h-[10px] w-[50%] skeleton" />
                </div>
              </div>
            ))}
          </div>
        )}

        {loaded && filtered.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-[14px] pt-[4px]">
            {filtered.map((song, i) => (
              <div key={song.name} className="animate-in" style={{ animationDelay: `${Math.min(i * 40, 400)}ms` }}>
                <SongCard song={song} onOpen={handleOpen} />
              </div>
            ))}
          </div>
        )}

        {loaded && filtered.length === 0 && songs.length > 0 && (
          <div className="flex flex-col items-center justify-center py-[80px] animate-in">
            <div className="w-[48px] h-[48px] rounded-full bg-white/[0.03] flex items-center justify-center mb-[16px] border border-solid border-white/[0.06]">
              <Search size={20} className="text-ink-dimmer" />
            </div>
            <p className="text-[15px] font-medium text-ink m-0">No results for &ldquo;{query}&rdquo;</p>
            <p className="text-[13px] text-ink-dimmer mt-[4px] m-0">Try searching by name, key, or tempo</p>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="mt-[12px] text-[13px] text-accent border-0 bg-transparent cursor-pointer hover:underline font-medium"
            >
              Clear search
            </button>
          </div>
        )}

        {loaded && songs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-[100px] animate-in">
            <div className="w-[64px] h-[64px] rounded-[var(--radius-lg)] flex items-center justify-center mb-[20px]"
              style={{ background: "linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(124,58,237,0.08) 100%)", border: "1px solid rgba(245,158,11,0.15)" }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="text-accent">
                <path d="M9 18V5l12-2v13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </div>
            <p className="text-[17px] font-semibold text-ink m-0">Your library is empty</p>
            <p className="text-[13px] text-ink-dimmer mt-[8px] m-0 text-center max-w-[300px] leading-[1.6]">
              Upload an MP3 to get started. We&apos;ll analyse the track and prepare it for lighting design.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
