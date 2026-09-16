"use client";

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { usePortalStore } from "@/store/portal";
import * as api from "@/lib/api";
import { SongCard } from "@/components/library/SongCard";
import { UploadButton } from "@/components/library/UploadButton";
import { Input } from "@/components/ui/Input";
import type { Song } from "@/lib/types";

export default function LibraryPage() {
  const songs = usePortalStore((s) => s.songs);
  const setSongs = usePortalStore((s) => s.setSongs);
  const author = usePortalStore((s) => s.author);
  const setAuthor = usePortalStore((s) => s.setAuthor);
  const setSong = usePortalStore((s) => s.setSong);
  const setSeed = usePortalStore((s) => s.setSeed);
  const setEdits = usePortalStore((s) => s.setEdits);
  const setVenue = usePortalStore((s) => s.setVenue);
  const setWant = usePortalStore((s) => s.setWant);
  const resetForShow = usePortalStore((s) => s.resetForShow);
  const router = useRouter();

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

  const playable = songs.filter((s) => s.audio && s.bakeable).length;
  const meta = songs.length
    ? `${songs.length} songs · ${playable} playable`
    : "reading the hub…";

  return (
    <div className="flex flex-col overflow-hidden flex-1">
      <div className="flex-none px-[var(--spacing-s5)] pt-[var(--spacing-s4)] pb-[var(--spacing-s3)] border-b border-solid border-line">
        <div className="flex items-end justify-between gap-[var(--spacing-s4)]">
          <div>
            <div className="display">My-Library</div>
            <div className="label mt-[3px]">{meta}</div>
          </div>
          <div className="flex items-center gap-[var(--spacing-s3)] flex-wrap">
            <UploadButton />
            <div className="w-px h-[var(--hit)] bg-line self-center" />
            <label className="label" htmlFor="authorName">
              You are
            </label>
            <Input
              id="authorName"
              placeholder="your name"
              autoComplete="off"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            />
          </div>
        </div>
      </div>
      {/* Covers are the index here, so they stay a grid — but at 168px a row
          holds five or six songs instead of two, which is the difference
          between scanning a library and scrolling one. */}
      <div className="flex-1 overflow-y-auto grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] auto-rows-max gap-[var(--spacing-s3)] px-[var(--spacing-s5)] pt-[var(--spacing-s4)] pb-[var(--spacing-s7)] content-start">
        {songs.length === 0 && (
          <div className="col-span-full text-dim text-center py-[var(--spacing-s8)]">
            reading the hub…
          </div>
        )}
        {songs.map((song) => (
          <SongCard key={song.name} song={song} onOpen={handleOpen} />
        ))}
      </div>
    </div>
  );
}
