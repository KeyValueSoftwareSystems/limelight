"use client";

import { usePortalStore } from "@/store/portal";

export function Footer() {
  const song = usePortalStore((s) => s.song);
  const show = usePortalStore((s) => s.show);

  const right = show
    ? `${show.frame_count.toLocaleString()} frames \u00b7 ${show.fps} fps \u00b7 ${show.channels} ch`
    : "";

  return (
    <footer className="flex-none flex items-center justify-between gap-[16px] px-[20px] h-[28px] border-t border-solid border-white/[0.04] glass">
      <span className="text-[11px] text-ink-dimmer truncate font-medium">
        {song?.title ?? "Limelight"}
      </span>
      {right && <span className="mono text-[11px] text-ink-dimmer tabular-nums flex-none">{right}</span>}
    </footer>
  );
}
