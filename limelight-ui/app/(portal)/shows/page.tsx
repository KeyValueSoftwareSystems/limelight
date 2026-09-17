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
    <div className="flex flex-col overflow-hidden flex-1 surface-glow animate-in">
      <div className="flex-none px-[24px] pt-[24px] pb-[18px]">
        <h1 className="text-[28px] font-bold tracking-[-0.03em] m-0 leading-[1.1] bg-clip-text"
          style={{ background: "linear-gradient(180deg, #EDEEF3 30%, #8E93A3 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          Shows
        </h1>
        <p className="text-[13px] text-ink-dimmer mt-[6px] m-0">
          {loading ? "Loading…" : `${showList.length} saved show${showList.length === 1 ? "" : "s"}`}
        </p>

        {showList.length > 0 && (
          <div className="mt-[18px] relative max-w-[340px]">
            <Search size={14} className="absolute left-[12px] top-1/2 -translate-y-1/2 text-ink-dimmer pointer-events-none" />
            <input
              type="text"
              placeholder="Search shows…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full h-[36px] pl-[34px] pr-[12px] rounded-[var(--radius-sm)] border border-solid border-white/[0.06] bg-white/[0.03] text-[13px] text-ink outline-none focus:border-accent/50 focus:bg-white/[0.05] focus:shadow-[0_0_0_3px_rgba(245,158,11,0.08)] transition-all duration-200 placeholder:text-ink-dimmer"
            />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-[24px] pb-[48px]">
        {loading && (
          <div className="flex flex-col gap-[20px] pt-[8px]">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="animate-in" style={{ animationDelay: `${i * 80}ms` }}>
                <div className="h-[14px] w-[120px] skeleton mb-[12px]" />
                <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-[10px]">
                  <div className="h-[88px] skeleton rounded-[var(--radius-md)]" />
                  <div className="h-[88px] skeleton rounded-[var(--radius-md)]" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && grouped.map(([songName, shows], gi) => {
          const s = songForName(songName);
          return (
            <div key={songName} className="mb-[32px] animate-in" style={{ animationDelay: `${Math.min(gi * 50, 200)}ms` }}>
              <div className="flex items-center gap-[8px] mb-[12px]">
                <div className="w-[24px] h-[24px] rounded-[6px] flex items-center justify-center flex-none"
                  style={{ background: "linear-gradient(135deg, rgba(124,58,237,0.15) 0%, rgba(59,130,246,0.1) 100%)", border: "1px solid rgba(124,58,237,0.12)" }}>
                  <Music size={12} className="text-[#A78BFA]" />
                </div>
                <h2 className="text-[15px] font-semibold m-0 truncate text-ink">{s?.title ?? songName}</h2>
                {s?.bpm && <span className="mono text-[11px] text-ink-dimmer tabular-nums flex-none">{Math.round(s.bpm)}</span>}
                <span className="text-[11px] text-ink-dimmer flex-none rounded-full px-[8px] py-[1px] bg-white/[0.03] border border-solid border-white/[0.05]">
                  {shows.length} show{shows.length > 1 ? "s" : ""}
                </span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-[10px]">
                {shows.map((sf, si) => (
                  <button
                    key={sf.id}
                    type="button"
                    onClick={() => handleOpen(sf)}
                    className="group text-left p-[16px] rounded-[var(--radius-md)] border border-solid border-white/[0.06] cursor-pointer transition-all duration-200 ease-[var(--ease)] hover:border-white/[0.12] hover:-translate-y-[1px] active:scale-[0.995] animate-in"
                    style={{
                      background: "linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)",
                      boxShadow: "var(--elev-card)",
                      animationDelay: `${Math.min((gi * 3 + si) * 40, 300)}ms`,
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "var(--elev-card-hover)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "var(--elev-card)"; }}
                  >
                    <div className="flex items-start justify-between gap-[8px]">
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium m-0 truncate text-ink group-hover:text-accent transition-colors duration-200">
                          {sf.name}
                        </p>
                        <p className="mono text-[11px] text-ink-dimmer m-0 mt-[5px] tabular-nums leading-[1.5]">
                          v{sf.version} · {sf.author} · {sf.edits.length} edits
                        </p>
                      </div>
                      <ChevronRight size={14} className="text-ink-dimmer group-hover:text-accent flex-none mt-[2px] transition-all duration-200 group-hover:translate-x-[2px]" />
                    </div>
                    {sf.designed_for && (
                      <p className="text-[11px] text-ink-dimmer m-0 mt-[10px] flex items-center gap-[4px]">
                        <span className="w-[3px] h-[3px] rounded-full bg-white/20 flex-none" />
                        {sf.designed_for.venue_name}
                        {sf.designed_for.layout ? ` · ${sf.designed_for.layout}` : ""}
                      </p>
                    )}
                    {sf.invalid && (
                      <p className="text-[11px] text-warn m-0 mt-[8px] flex items-center gap-[4px]">
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
          <div className="flex flex-col items-center justify-center py-[100px] animate-in">
            <div className="w-[64px] h-[64px] rounded-[var(--radius-lg)] flex items-center justify-center mb-[20px]"
              style={{ background: "linear-gradient(135deg, rgba(124,58,237,0.12) 0%, rgba(59,130,246,0.08) 100%)", border: "1px solid rgba(124,58,237,0.1)" }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="text-[#A78BFA]">
                <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.5" />
                <path d="M10 8l6 4-6 4V8z" fill="currentColor" opacity="0.4" />
              </svg>
            </div>
            <p className="text-[17px] font-semibold text-ink m-0">No saved shows</p>
            <p className="text-[13px] text-ink-dimmer mt-[8px] m-0 text-center max-w-[300px] leading-[1.6]">
              Open a song from the Library, design your show, and save it here.
            </p>
          </div>
        )}

        {!loading && showList.length > 0 && grouped.length === 0 && (
          <div className="flex flex-col items-center justify-center py-[80px] animate-in">
            <div className="w-[48px] h-[48px] rounded-full bg-white/[0.03] flex items-center justify-center mb-[16px] border border-solid border-white/[0.06]">
              <Search size={20} className="text-ink-dimmer" />
            </div>
            <p className="text-[15px] font-medium text-ink m-0">No results for &ldquo;{query}&rdquo;</p>
            <p className="text-[13px] text-ink-dimmer mt-[4px] m-0">Try a different search term</p>
            <button type="button" onClick={() => setQuery("")} className="mt-[12px] text-[13px] text-accent border-0 bg-transparent cursor-pointer hover:underline font-medium">
              Clear search
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
