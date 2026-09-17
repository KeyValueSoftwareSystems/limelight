"use client";

import { useRouter } from "next/navigation";
import { usePortalStore } from "@/store/portal";
import { SongThumb } from "@/components/library/SongThumb";
import { mmss } from "@/lib/grid";

export function SetlistPanel() {
  const setlist = usePortalStore((s) => s.setlist);
  const songs = usePortalStore((s) => s.songs);
  const song = usePortalStore((s) => s.song);
  const router = useRouter();

  if (setlist.length < 2) return null;

  const total = setlist.reduce((sum, n) => {
    const s = songs.find((x) => x.name === n);
    return sum + (s?.duration_s ?? 0);
  }, 0);

  return (
    <div className="flex-none flex flex-col min-h-0 max-h-[36%] border-b border-solid border-white/[0.05]">
      <div className="flex-none flex items-baseline gap-[8px] px-[16px] pt-[12px] pb-[8px]">
        <span className="text-[11px] font-medium text-ink-dimmer">Setlist</span>
        <span className="flex-1" />
        <span className="mono text-[10px] text-ink-dimmer tabular-nums">
          {setlist.length} · {mmss(total)}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-[8px] pb-[10px]">
        {setlist.map((name, i) => {
          const s = songs.find((x) => x.name === name);
          const on = song?.name === name;
          return (
            <button
              key={name}
              type="button"
              onClick={() => {
                if (on) return;
                router.push(
                  `/stage?song=${encodeURIComponent(name)}&seed=1&songs=${setlist.map(encodeURIComponent).join(",")}`,
                );
              }}
              className={`w-full flex items-center gap-[9px] px-[8px] py-[6px] rounded-[6px] border-0 text-left cursor-pointer transition-colors duration-150 ${
                on ? "mat-on" : "bg-transparent hover:bg-[var(--surface-1)]"
              }`}
            >
              <span
                className="mono flex-none w-[14px] text-[10px] tabular-nums text-right"
                style={{ color: on ? "var(--accent)" : "var(--ink-dimmer)" }}
              >
                {i + 1}
              </span>
              {s ? <SongThumb song={s} size={28} /> : <span className="w-[28px] h-[28px] rounded-[5px] bg-bg-sunken flex-none" />}
              <span className="min-w-0 flex-1">
                <span className={`block text-[12px] truncate ${on ? "text-ink font-medium" : "text-ink-dim"}`}>
                  {s?.title ?? name}
                </span>
                <span className="mono block text-[10px] text-ink-dimmer tabular-nums truncate">
                  {s?.bpm ? `${Math.round(s.bpm)} BPM` : "—"}
                  {s?.duration_s != null ? ` · ${mmss(s.duration_s)}` : ""}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
