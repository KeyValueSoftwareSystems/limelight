"use client";

import { useEffect, useCallback, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
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

  useEffect(() => {
    if (songs.length) return;
    api.songs.list().then((d) => setSongs(d.songs)).catch(() => {});
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
      case "bpm":
        sorted.sort((a, b) => (a.bpm ?? 0) - (b.bpm ?? 0));
        break;
      case "duration":
        sorted.sort((a, b) => (a.duration_s ?? 0) - (b.duration_s ?? 0));
        break;
      case "recent":
        sorted.reverse();
        break;
      default:
        sorted.sort((a, b) => a.title.localeCompare(b.title));
    }
    return sorted;
  }, [songs, query, sort]);

  const playable = songs.filter((s) => s.audio && s.bakeable).length;

  return (
    <div className="flex flex-col overflow-hidden flex-1">
      <div className="flex-none px-[16px] pt-[16px] pb-[12px]">
        <div className="flex items-center justify-between gap-[16px]">
          <div>
            <h1 className="text-[22px] font-medium tracking-[-0.01em] m-0">Library</h1>
            <p className="text-[12px] text-ink-dimmer mt-[2px] m-0">
              {songs.length ? `${songs.length} songs · ${playable} playable` : "Loading…"}
            </p>
          </div>
          <UploadButton />
        </div>

        <div className="flex items-center gap-[8px] mt-[12px]">
          <div className="relative flex-1 max-w-[320px]">
            <svg className="absolute left-[10px] top-1/2 -translate-y-1/2 text-ink-dimmer pointer-events-none" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="7" cy="7" r="5" />
              <path d="M11 11l3.5 3.5" />
            </svg>
            <input
              type="text"
              placeholder="Search songs…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full h-[32px] pl-[32px] pr-[10px] rounded-[6px] border border-solid border-line-strong bg-bg-raised text-[13px] text-ink outline-none focus:border-accent placeholder:text-ink-dimmer"
            />
          </div>
          <div className="flex h-[32px] rounded-[6px] border border-solid border-line-strong bg-bg-raised p-[2px]">
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
                className={`px-[10px] rounded-[4px] border-0 text-[11px] tracking-[0.04em] cursor-pointer transition-colors duration-[var(--dur-state)] ${
                  sort === s.id
                    ? "bg-bg-overlay text-ink font-medium"
                    : "bg-transparent text-ink-dimmer hover:text-ink-dim"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] auto-rows-max gap-[12px] px-[16px] pt-[4px] pb-[40px] content-start">
        {songs.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center py-[60px]">
            <div className="w-[48px] h-[48px] rounded-full bg-bg-raised flex items-center justify-center mb-[12px]">
              <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="var(--ink-dimmer)" strokeWidth="1.5">
                <circle cx="8" cy="8" r="6.5" />
                <path d="M8 5v6M5 8h6" />
              </svg>
            </div>
            <p className="text-[13px] text-ink-dimmer m-0">Loading songs…</p>
          </div>
        )}
        {filtered.map((song) => (
          <SongCard key={song.name} song={song} onOpen={handleOpen} />
        ))}
        {filtered.length === 0 && songs.length > 0 && (
          <div className="col-span-full text-center text-ink-dimmer py-[40px] text-[13px]">
            No songs match &ldquo;{query}&rdquo;
          </div>
        )}
      </div>
    </div>
  );
}
