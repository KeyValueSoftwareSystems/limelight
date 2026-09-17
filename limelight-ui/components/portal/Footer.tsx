"use client";

import { usePortalStore } from "@/store/portal";

export function Footer() {
  const song = usePortalStore((s) => s.song);
  const show = usePortalStore((s) => s.show);

  const left = song ? song.title : "Limelight";
  const right = show
    ? `${show.frame_count.toLocaleString()} frames · ${show.fps} fps · ${show.channels} ch`
    : "";

  return (
    <footer className="flex-none flex items-center justify-between gap-[16px] px-[20px] h-[28px] border-t border-solid border-white/[0.05] glass">
      <span className="text-[11px] text-ink-dimmer truncate tracking-[0.01em]">{left}</span>
      {right && <span className="mono text-[10px] text-ink-dimmer tabular-nums flex-none tracking-[0.01em]">{right}</span>}
    </footer>
  );
}
