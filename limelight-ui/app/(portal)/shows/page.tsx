"use client";

import { useEffect, useCallback, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search, Play, AlertTriangle, Music, ChevronRight } from "lucide-react";
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
    api.shows.list().then((d) => { setShowList(d.shows); setLoading(false); }).catch(() => setLoading(false));
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
    [resetForShow, songs, setSong, setSeed, setEdits, setVenue, setShowId, setShowVersion, setWant, setPendingPlan, setPlanText, router],
  );

  const grouped = useMemo(() => {
    const q = query.toLowerCase();
    const filtered = q
      ? showList.filter((sf) => sf.name.toLowerCase().includes(q) || sf.song.toLowerCase().includes(q) || sf.author.toLowerCase().includes(q))
      : showList;
    const map = new Map<string, ShowFile[]>();
    for (const sf of filtered) {
      const arr = map.get(sf.song) || [];
      arr.push(sf);
      map.set(sf.song, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [showList, query]);

  const songForName = useCallback((name: string): Song | undefined => songs.find((s) => s.name === name), [songs]);

  return (
    <div className="flex flex-col overflow-hidden flex-1 animate-in">
      <div className="flex-none px-[20px] pt-[20px] pb-[16px]">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em] m-0 leading-[1.1]">Shows</h1>
        <p className="text-[13px] text-ink-dimmer mt-[6px] m-0">
          {loading ? "Loading…" : `${showList.length} saved show${showList.length === 1 ? "" : "s"}`}
        </p>

        {showList.length > 0 && (
          <div className="mt-[16px] relative max-w-[320px]">
            <Search size={14} className="absolute left-[10px] top-1/2 -translate-y-1/2 text-ink-dimmer pointer-events-none" />
            <input
              type="text"
              placeholder="Search shows…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full h-[34px] pl-[32px] pr-[12px] rounded-[var(--radius-sm)] border border-solid border-line bg-bg-raised/60 text-[13px] text-ink outline-none focus:border-accent focus:bg-bg-raised transition-all duration-[var(--dur-state)] placeholder:text-ink-dimmer"
            />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-[20px] pb-[48px]">
        {loading && (
          <div className="flex flex-col gap-[16px] pt-[8px]">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} style={{ animationDelay: `${i * 80}ms` }}>
                <div className="h-[16px] w-[120px] skeleton mb-[10px]" />
                <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-[10px]">
                  <div className="h-[80px] skeleton rounded-[var(--radius-md)]" />
                  <div className="h-[80px] skeleton rounded-[var(--radius-md)]" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && grouped.map(([songName, shows], gi) => {
          const s = songForName(songName);
          return (
            <div key={songName} className="mb-[28px] animate-in" style={{ animationDelay: `${Math.min(gi * 50, 200)}ms` }}>
              <div className="flex items-center gap-[8px] mb-[10px]">
                <Music size={14} className="text-ink-dimmer flex-none" />
                <h2 className="text-[15px] font-semibold m-0 truncate">{s?.title ?? songName}</h2>
                {s?.bpm && <span className="mono text-[11px] text-ink-dimmer tabular-nums flex-none">{Math.round(s.bpm)} BPM</span>}
                <span className="mono text-[11px] text-ink-dimmer flex-none">{shows.length} show{shows.length > 1 ? "s" : ""}</span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-[8px]">
                {shows.map((sf, si) => (
                  <button
                    key={sf.id}
                    type="button"
                    onClick={() => handleOpen(sf)}
                    className="group text-left p-[14px] rounded-[var(--radius-md)] border border-solid border-line bg-bg-raised/60 cursor-pointer transition-all duration-[var(--dur-state)] ease-[var(--ease)] hover:bg-bg-raised hover:border-line-strong hover:shadow-[var(--elev-card-hover)] hover:-translate-y-[1px] active:scale-[0.99] animate-in"
                    style={{ animationDelay: `${Math.min((gi * 3 + si) * 40, 300)}ms` }}
                  >
                    <div className="flex items-start justify-between gap-[8px]">
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium m-0 truncate text-ink group-hover:text-accent transition-colors duration-[var(--dur-state)]">
                          {sf.name}
                        </p>
                        <p className="mono text-[11px] text-ink-dimmer m-0 mt-[4px] tabular-nums leading-[1.5]">
                          v{sf.version} · {sf.author} · {sf.edits.length} edits
                        </p>
                      </div>
                      <ChevronRight size={14} className="text-ink-dimmer group-hover:text-accent flex-none mt-[2px] transition-all duration-[var(--dur-state)] group-hover:translate-x-[2px]" />
                    </div>
                    {sf.designed_for && (
                      <p className="text-[11px] text-ink-dimmer m-0 mt-[8px] flex items-center gap-[4px]">
                        <span className="w-[3px] h-[3px] rounded-full bg-ink-dimmer/50 flex-none" />
                        {sf.designed_for.venue_name}
                        {sf.designed_for.layout ? ` · ${sf.designed_for.layout}` : ""}
                      </p>
                    )}
                    {sf.invalid && (
                      <p className="text-[11px] text-warn m-0 mt-[6px] flex items-center gap-[4px]">
                        <AlertTriangle size={10} />
                        {sf.invalid}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        {!loading && !showList.length && (
          <div className="flex flex-col items-center justify-center py-[80px] animate-in">
            <div className="w-[56px] h-[56px] rounded-[var(--radius-lg)] bg-bg-raised flex items-center justify-center mb-[16px]">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-ink-dimmer">
                <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.5" />
                <path d="M10 8l6 4-6 4V8z" fill="currentColor" opacity="0.3" />
              </svg>
            </div>
            <p className="text-[16px] font-medium text-ink m-0">No saved shows</p>
            <p className="text-[13px] text-ink-dimmer mt-[6px] m-0 text-center max-w-[280px] leading-[1.5]">
              Open a song from the Library, design your show, and save it here.
            </p>
          </div>
        )}

        {!loading && showList.length > 0 && grouped.length === 0 && (
          <div className="flex flex-col items-center justify-center py-[60px] animate-in">
            <Search size={32} className="text-ink-dimmer/30 mb-[12px]" />
            <p className="text-[14px] text-ink-dim m-0">No shows match &ldquo;{query}&rdquo;</p>
            <button type="button" onClick={() => setQuery("")} className="mt-[8px] text-[13px] text-accent border-0 bg-transparent cursor-pointer hover:underline">
              Clear search
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
