"use client";

import { usePortalStore } from "@/store/portal";

export function Footer() {
  const song = usePortalStore((s) => s.song);
  const show = usePortalStore((s) => s.show);

  const left = song ? `${song.title} / lighting show` : "Limelight / Portal";
  const right =
    show
      ? `${show.frame_count} frames · ${show.fps} fps · ${show.channels} ch`
      : "";

  return (
    <footer className="flex-none flex items-center justify-between gap-[var(--spacing-s4)] px-[var(--spacing-s6)] py-[var(--spacing-s3)] border-t border-solid border-line text-[length:var(--text-xs)] tracking-[0.16em] uppercase text-dim">
      <span>{left}</span>
      <span>{right}</span>
    </footer>
  );
}
