"use client";

import { useEffect, useCallback, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search, AlertTriangle, Music, ChevronRight } from "lucide-react";
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
      /* The show's id goes in the URL. Without it a saved show had no address:
         opening one and then refreshing silently swapped it for the song's own
         generated show - 44 edits became 112 and nothing said so. */
      router.push(
        `/stage?song=${encodeURIComponent(sf.song)}&seed=${sf.seed}&show=${encodeURIComponent(sf.id)}`,
      );
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
    <div className="flex flex-col overflow-hidden flex-1 surface-glow animate-in">
      <div className="flex-none px-[28px] pt-[28px] pb-[20px]">
        <div className="flex items-end justify-between gap-[16px]">
          <div>
            <h1 className="text-[32px] font-bold tracking-[-0.03em] m-0 leading-[1.1]"
              style={{ background: "linear-gradient(180deg, #ECEEF6 20%, #9095AD 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Shows
            </h1>
            <p className="text-[14px] text-ink-dimmer mt-[8px] m-0 font-medium">
              {loading ? "Loading saved shows\u2026" : `${showList.length} saved show${showList.length === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>

        {showList.length > 0 && (
          <div className="mt-[20px] relative max-w-[360px]">
            <Search size={15} className="absolute left-[12px] top-1/2 -translate-y-1/2 text-ink-dimmer pointer-events-none" />
            <input
              type="text"
              placeholder="Search by name or author"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full h-[38px] pl-[36px] pr-[12px] rounded-[var(--radius-sm)] border border-solid border-white/[0.06] bg-white/[0.03] text-[14px] font-medium text-ink outline-none focus:border-accent/50 focus:bg-white/[0.06] focus:shadow-[0_0_0_3px_rgba(255, 217, 163,0.1)] transition-all duration-200 placeholder:text-ink-dimmer placeholder:font-normal"
            />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-[28px] pb-[48px]">
        {loading && (
          <div className="flex flex-col gap-[24px] pt-[8px]">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="animate-in" style={{ animationDelay: `${i * 80}ms` }}>
                <div className="h-[14px] w-[140px] skeleton mb-[12px]" />
                <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-[10px]">
                  <div className="h-[76px] skeleton rounded-[var(--radius-md)]" />
                  <div className="h-[76px] skeleton rounded-[var(--radius-md)]" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && grouped.map(([songName, shows], gi) => {
          const s = songForName(songName);
          return (
            <div key={songName} className="mb-[28px] animate-in" style={{ animationDelay: `${Math.min(gi * 50, 200)}ms` }}>
              <div className="flex items-center gap-[10px] mb-[10px]">
                <div className="w-[22px] h-[22px] rounded-[6px] flex items-center justify-center flex-none"
                  style={{ background: "linear-gradient(135deg, rgba(255, 217, 163,0.18) 0%, rgba(255, 217, 163,0.12) 100%)", border: "1px solid rgba(255, 217, 163,0.15)" }}>
                  <Music size={11} className="text-accent" />
                </div>
                <h2 className="text-[15px] font-bold m-0 truncate text-ink tracking-[-0.01em]">{s?.title ?? songName}</h2>
                {s?.bpm && <span className="mono text-[11px] text-ink-dimmer tabular-nums flex-none font-medium">{Math.round(s.bpm)} BPM</span>}
                <span className="text-[11px] text-ink-dimmer flex-none rounded-full px-[8px] py-[1px] font-semibold"
                  style={{ background: "rgba(255, 217, 163,0.06)", border: "1px solid rgba(255, 217, 163,0.08)" }}>
                  {shows.length} show{shows.length > 1 ? "s" : ""}
                </span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-[10px]">
                {shows.map((sf, si) => (
                  <button
                    key={sf.id}
                    type="button"
                    onClick={() => handleOpen(sf)}
                    className="group text-left h-[76px] p-[14px] rounded-[var(--radius-md)] border border-solid border-white/[0.06] cursor-pointer transition-all duration-200 ease-[var(--ease)] hover:border-accent/25 hover:-translate-y-[1px] active:scale-[0.995] overflow-hidden animate-in"
                    style={{
                      background: "linear-gradient(180deg, rgba(255, 217, 163,0.04) 0%, rgba(255, 217, 163,0.01) 100%)",
                      boxShadow: "var(--elev-card)",
                      animationDelay: `${Math.min((gi * 3 + si) * 40, 300)}ms`,
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "var(--elev-card-hover)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "var(--elev-card)"; }}
                  >
                    <div className="flex items-start justify-between gap-[8px]">
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <p className="text-[13px] font-semibold m-0 truncate text-ink group-hover:text-accent transition-colors duration-200">
                          {sf.name}
                        </p>
                        <p className="mono text-[11px] text-ink-dimmer m-0 mt-[4px] tabular-nums leading-[1.5] truncate">
                          v{sf.version} · {sf.author} · {sf.edits.length} edit{sf.edits.length === 1 ? "" : "s"}
                          {sf.designed_for ? ` · ${sf.designed_for.venue_name}` : ""}
                        </p>
                      </div>
                      <ChevronRight size={14} className="text-ink-dimmer group-hover:text-accent flex-none mt-[2px] transition-all duration-200 group-hover:translate-x-[2px]" />
                    </div>
                    {sf.invalid && (
                      <p className="text-[11px] text-warn m-0 mt-[6px] flex items-center gap-[4px] truncate font-medium">
                        <AlertTriangle size={10} className="flex-none" />
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
          <div className="flex flex-col items-center justify-center py-[100px] animate-in">
            <div className="w-[64px] h-[64px] rounded-[var(--radius-lg)] flex items-center justify-center mb-[20px]"
              style={{ background: "linear-gradient(135deg, rgba(255, 217, 163,0.15) 0%, rgba(255, 217, 163,0.1) 100%)", border: "1px solid rgba(255, 217, 163,0.12)" }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="text-accent">
                <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.5" />
                <path d="M10 8l6 4-6 4V8z" fill="currentColor" opacity="0.4" />
              </svg>
            </div>
            <p className="text-[18px] font-bold text-ink m-0">No saved shows yet</p>
            <p className="text-[14px] text-ink-dimmer mt-[8px] m-0 text-center max-w-[320px] leading-[1.6] font-medium">
              Design a light show for any track, then save it here.
            </p>
          </div>
        )}

        {!loading && showList.length > 0 && grouped.length === 0 && (
          <div className="flex flex-col items-center justify-center py-[80px] animate-in">
            <div className="w-[48px] h-[48px] rounded-full flex items-center justify-center mb-[16px] glow-border"
              style={{ background: "rgba(255, 217, 163,0.06)" }}>
              <Search size={20} className="text-ink-dimmer" />
            </div>
            <p className="text-[16px] font-semibold text-ink m-0">No results for &ldquo;{query}&rdquo;</p>
            <p className="text-[13px] text-ink-dimmer mt-[6px] m-0 font-medium">Try a different search term.</p>
            <button type="button" onClick={() => setQuery("")} className="mt-[12px] text-[13px] text-accent border-0 bg-transparent cursor-pointer hover:underline font-semibold">
              Clear search
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
