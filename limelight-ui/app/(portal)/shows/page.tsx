"use client";

import { useEffect, useCallback, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { usePortalStore } from "@/store/portal";
import * as api from "@/lib/api";
import type { ShowFile, Song } from "@/lib/types";

export default function ShowsPage() {
  const [showList, setShowList] = useState<ShowFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const setSong = usePortalStore((s) => s.setSong);
  const setSeed = usePortalStore((s) => s.setSeed);
  const setEdits = usePortalStore((s) => s.setEdits);
  const setVenue = usePortalStore((s) => s.setVenue);
  const setShowId = usePortalStore((s) => s.setShowId);
  const setShowVersion = usePortalStore((s) => s.setShowVersion);
  const setWant = usePortalStore((s) => s.setWant);
  const setPendingPlan = usePortalStore((s) => s.setPendingPlan);
  const setPlanText = usePortalStore((s) => s.setPlanText);
  const resetForShow = usePortalStore((s) => s.resetForShow);
  const songs = usePortalStore((s) => s.songs);
  const setSongs = usePortalStore((s) => s.setSongs);
  const router = useRouter();

  useEffect(() => {
    api.shows.list().then((d) => {
      setShowList(d.shows);
      setLoading(false);
    }).catch(() => setLoading(false));
    if (!songs.length) api.songs.list().then((d) => setSongs(d.songs)).catch(() => {});
  }, []);

  const handleOpen = useCallback(
    (sf: ShowFile) => {
      resetForShow();
      const match = songs.find((s) => s.name === sf.song);
      if (match) setSong(match);
      setSeed(sf.seed);
      setEdits(sf.edits);
      setVenue(sf);
      setShowId(sf.id);
      setShowVersion(sf.version);
      setWant(sf.appetite ?? null);
      setPendingPlan(sf.plan ?? null);
      setPlanText(sf.plan_text ?? "");
      router.push(`/stage?song=${encodeURIComponent(sf.song)}&seed=${sf.seed}`);
    },
    [resetForShow, songs, setSong, setSeed, setEdits, setVenue, setShowId, setShowVersion, setWant,
     setPendingPlan, setPlanText, router],
  );

  const grouped = useMemo(() => {
    const q = query.toLowerCase();
    const filtered = q
      ? showList.filter(
          (sf) =>
            sf.name.toLowerCase().includes(q) ||
            sf.song.toLowerCase().includes(q) ||
            sf.author.toLowerCase().includes(q),
        )
      : showList;

    const map = new Map<string, ShowFile[]>();
    for (const sf of filtered) {
      const arr = map.get(sf.song) || [];
      arr.push(sf);
      map.set(sf.song, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [showList, query]);

  const songForName = useCallback(
    (name: string): Song | undefined => songs.find((s) => s.name === name),
    [songs],
  );

  return (
    <div className="flex flex-col overflow-hidden flex-1">
      <div className="flex-none px-[16px] pt-[16px] pb-[12px]">
        <div className="flex items-center justify-between gap-[16px]">
          <div>
            <h1 className="text-[22px] font-medium tracking-[-0.01em] m-0">Shows</h1>
            <p className="text-[12px] text-ink-dimmer mt-[2px] m-0">
              {loading ? "Loading…" : `${showList.length} saved show${showList.length === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>

        <div className="mt-[12px] relative max-w-[320px]">
          <svg className="absolute left-[10px] top-1/2 -translate-y-1/2 text-ink-dimmer pointer-events-none" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="7" cy="7" r="5" />
            <path d="M11 11l3.5 3.5" />
          </svg>
          <input
            type="text"
            placeholder="Search shows…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full h-[32px] pl-[32px] pr-[10px] rounded-[6px] border border-solid border-line-strong bg-bg-raised text-[13px] text-ink outline-none focus:border-accent placeholder:text-ink-dimmer"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-[16px] pb-[40px]">
        {grouped.map(([songName, shows]) => {
          const s = songForName(songName);
          return (
            <div key={songName} className="mb-[24px]">
              <div className="flex items-baseline gap-[10px] mb-[8px]">
                <h2 className="text-[15px] font-medium m-0 truncate">{s?.title ?? songName}</h2>
                <span className="mono text-[11px] text-ink-dimmer tabular-nums flex-none">
                  {s ? `${Math.round(s.bpm ?? 0)} BPM` : ""}
                </span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-[10px]">
                {shows.map((sf) => (
                  <button
                    key={sf.id}
                    type="button"
                    onClick={() => handleOpen(sf)}
                    className="text-left p-[14px] rounded-[8px] border border-solid border-line bg-bg-raised cursor-pointer transition-all duration-[var(--dur-state)] hover:border-line-strong hover:bg-bg-overlay group"
                  >
                    <div className="flex items-start justify-between gap-[8px]">
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium m-0 truncate text-ink group-hover:text-accent transition-colors">
                          {sf.name}
                        </p>
                        <p className="mono text-[11px] text-ink-dimmer m-0 mt-[4px] tabular-nums">
                          v{sf.version} · by {sf.author} · {sf.edits.length} edits
                        </p>
                      </div>
                      <span className="flex-none text-[11px] text-ink-dimmer tracking-[0.04em] uppercase mt-[2px]">
                        Open
                      </span>
                    </div>
                    {sf.designed_for && (
                      <p className="text-[11px] text-ink-dimmer m-0 mt-[6px]">
                        For {sf.designed_for.venue_name}
                        {sf.designed_for.layout ? ` · ${sf.designed_for.layout}` : ""}
                      </p>
                    )}
                    {sf.invalid && (
                      <p className="text-[11px] text-warn m-0 mt-[4px]">{sf.invalid}</p>
                    )}
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        {!loading && !showList.length && (
          <div className="flex flex-col items-center justify-center py-[60px]">
            <div className="w-[48px] h-[48px] rounded-full bg-bg-raised flex items-center justify-center mb-[12px]">
              <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="var(--ink-dimmer)" strokeWidth="1.5">
                <rect x="2" y="2" width="12" height="12" rx="2" />
                <path d="M6 6l4 4M10 6l-4 4" />
              </svg>
            </div>
            <p className="text-[13px] text-ink-dimmer m-0">No saved shows yet</p>
            <p className="text-[12px] text-ink-dimmer m-0 mt-[4px]">
              Open a song from the Library and save your first show.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
