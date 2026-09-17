"use client";

import { useEffect, useCallback, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search, Plus, ArrowLeft } from "lucide-react";
import { SongPicker } from "@/components/library/SongPicker";
import { ShowCard } from "@/components/shows/ShowCard";
import { usePortalStore } from "@/store/portal";
import * as api from "@/lib/api";
import type { ShowFile, Song } from "@/lib/types";

type SortKey = "recent" | "name" | "song" | "room";

export default function ShowsPage() {
  const [showList, setShowList] = useState<ShowFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
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
  const setSetlist = usePortalStore((s) => s.setSetlist);
  const router = useRouter();

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("new") === "1") setPicking(true);
  }, []);

  const toggleChoice = useCallback((song: Song) => {
    setChosen((cur) =>
      cur.includes(song.name) ? cur.filter((n) => n !== song.name) : [...cur, song.name],
    );
  }, []);

  const startShow = useCallback(
    (names: string[]) => {
      if (!names.length) return;
      const first = songs.find((s) => s.name === names[0]);
      resetForShow();
      setSetlist(names);
      if (first) setSong(first);
      setSeed(1);
      setEdits([]);
      setVenue(null);
      setWant(null);
      const q = names.length > 1 ? `&songs=${names.map(encodeURIComponent).join(",")}` : "";
      router.push(`/stage?song=${encodeURIComponent(names[0])}&seed=1${q}`);
    },
    [songs, resetForShow, setSetlist, setSong, setSeed, setEdits, setVenue, setWant, router],
  );

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
      router.push(
        `/stage?song=${encodeURIComponent(sf.song)}&seed=${sf.seed}&show=${encodeURIComponent(sf.id)}`,
      );
    },
    [resetForShow, songs, setSong, setSeed, setEdits, setVenue, setShowId, setShowVersion, setWant, setPendingPlan, setPlanText, router],
  );

  const songForName = useCallback(
    (name: string): Song | undefined => songs.find((s) => s.name === name),
    [songs],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const titleOf = (sf: ShowFile) => songForName(sf.song)?.title ?? sf.song;
    const roomOf = (sf: ShowFile) => sf.designed_for?.venue_name ?? "";
    const filtered = q
      ? showList.filter(
          (sf) =>
            sf.name.toLowerCase().includes(q) ||
            titleOf(sf).toLowerCase().includes(q) ||
            sf.author.toLowerCase().includes(q) ||
            roomOf(sf).toLowerCase().includes(q),
        )
      : showList;
    const by: Record<SortKey, (a: ShowFile, b: ShowFile) => number> = {
      recent: (a, b) => (b.version - a.version) || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name),
      song: (a, b) => titleOf(a).localeCompare(titleOf(b)) || a.name.localeCompare(b.name),
      room: (a, b) => roomOf(a).localeCompare(roomOf(b)) || a.name.localeCompare(b.name),
    };
    return [...filtered].sort(by[sort]);
  }, [showList, query, sort, songForName]);

  const songCount = useMemo(() => new Set(showList.map((s) => s.song)).size, [showList]);
  const roomCount = useMemo(
    () => new Set(showList.map((s) => s.designed_for?.venue_name).filter(Boolean)).size,
    [showList],
  );

  const SORTS: { id: SortKey; label: string }[] = [
    { id: "recent", label: "Recent" },
    { id: "name", label: "Name" },
    { id: "song", label: "Song" },
    { id: "room", label: "Room" },
  ];

  if (picking) {
    return (
      <div className="flex flex-col overflow-hidden flex-1 animate-in">
        <div className="flex-none px-[28px] pt-[26px] pb-[4px]">
          <button
            type="button"
            onClick={() => setPicking(false)}
            className="inline-flex items-center gap-[6px] mb-[12px] p-0 border-0 bg-transparent text-[13px] text-ink-dim hover:text-ink cursor-pointer transition-colors duration-200"
          >
            <ArrowLeft size={14} />
            All shows
          </button>
          <h1 className="text-[30px] font-semibold tracking-[-0.028em] m-0 leading-[1.1] text-ink">
            New show
          </h1>
          <p className="text-[13px] text-ink-dim mt-[7px] mb-[18px]">
            Pick the songs this show plays, in order. You choose the room on the next screen.
          </p>
        </div>
        <div className="flex-1 min-h-0 flex flex-col px-[28px]">
          <SongPicker
            multi
            chosen={chosen}
            onToggle={toggleChoice}
            onPick={(s) => startShow([s.name])}
          />
        </div>

        <div
          className="flex-none flex items-center gap-[14px] px-[28px] h-[62px] border-t border-solid border-[var(--edge)]"
          style={{ background: "var(--bg-raised)" }}
        >
          <span className="text-[13px] text-ink-dim min-w-0 truncate">
            {chosen.length === 0 ? (
              "Pick one song, or several to build a setlist."
            ) : (
              <>
                <span className="text-ink font-medium">
                  {chosen.length} song{chosen.length === 1 ? "" : "s"}
                </span>
                <span className="text-ink-dimmer">
                  {" \u00b7 "}
                  {chosen
                    .map((n) => songs.find((s) => s.name === n)?.title ?? n)
                    .join(" \u2192 ")}
                </span>
              </>
            )}
          </span>
          <span className="flex-1" />
          {chosen.length > 0 && (
            <button
              type="button"
              onClick={() => setChosen([])}
              className="flex-none p-0 border-0 bg-transparent text-[13px] text-ink-dim hover:text-ink cursor-pointer transition-colors duration-200"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            disabled={chosen.length === 0}
            onClick={() => startShow(chosen)}
            className="flex-none inline-flex items-center h-[var(--control-h)] px-[16px] rounded-[var(--radius-sm)] border-0 text-[13px] font-semibold cursor-pointer transition-[filter,transform] duration-200 hover:brightness-[1.06] active:scale-[0.98] disabled:opacity-40 disabled:cursor-default"
            style={{ background: "var(--lit)", color: "var(--lit-ink)" }}
          >
            {chosen.length > 1 ? `Design ${chosen.length} songs` : "Design this show"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col overflow-hidden flex-1 animate-in">
      <div className="flex-none px-[28px] pt-[26px] pb-[16px]">
        <div className="flex items-start justify-between gap-[16px]">
          <div className="min-w-0">
            <h1 className="text-[30px] font-semibold tracking-[-0.028em] m-0 leading-[1.1] text-ink">
              Shows
            </h1>
            <p className="text-[13px] text-ink-dim mt-[7px] m-0">
              {loading
                ? "Loading…"
                : showList.length === 0
                  ? "A show is one song, lit for one room."
                  : `${showList.length} show${showList.length === 1 ? "" : "s"} · ${songCount} song${songCount === 1 ? "" : "s"}${roomCount ? ` · ${roomCount} room${roomCount === 1 ? "" : "s"}` : ""}`}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setPicking(true)}
            className="flex-none inline-flex items-center gap-[7px] h-[var(--control-h)] px-[15px] rounded-[var(--radius-sm)] border-0 text-[13px] font-semibold cursor-pointer transition-[filter,transform] duration-200 hover:brightness-[1.06] active:scale-[0.98]"
            style={{
              background: "var(--lit)",
              color: "var(--lit-ink)",
              boxShadow: "0 1px 2px rgba(0,0,0,0.35), 0 0 18px -6px var(--accent-glow)",
            }}
          >
            <Plus size={15} strokeWidth={2.4} />
            New show
          </button>
        </div>

        {showList.length > 0 && (
          <div className="mt-[18px] flex items-center gap-[20px] flex-wrap">
            <div className="relative w-[300px] max-w-full">
              <Search
                size={15}
                className="absolute left-[12px] top-1/2 -translate-y-1/2 text-ink-dimmer pointer-events-none"
              />
              <input
                type="text"
                placeholder="Search shows, songs, rooms or people"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full h-[var(--control-h)] pl-[35px] pr-[12px] rounded-[var(--radius-sm)] border border-solid border-[var(--edge)] bg-[var(--surface-1)] text-[13px] text-ink outline-none transition-colors duration-200 placeholder:text-ink-dimmer"
              />
            </div>

            <div role="tablist" aria-label="Sort shows" className="inline-flex items-stretch gap-[18px] h-[var(--control-h)]">
              {SORTS.map((s) => {
                const on = s.id === sort;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setSort(s.id)}
                    className={`group relative h-full border-0 bg-transparent px-0 cursor-pointer text-[13px] font-medium transition-colors duration-[var(--dur-state)] ${
                      on ? "text-ink" : "text-ink-dimmer hover:text-ink-dim"
                    }`}
                  >
                    {s.label}
                    <span
                      aria-hidden
                      className={`absolute left-0 right-0 bottom-[7px] h-[2px] rounded-full transition-opacity duration-[var(--dur-state)] ${
                        on ? "opacity-100" : "opacity-0 group-hover:opacity-40"
                      }`}
                      style={{ background: "var(--accent)", boxShadow: "0 -5px 12px -2px var(--accent-glow)" }}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-[28px] pb-[48px]">
        {loading && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-[14px] pt-[4px]">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="rounded-[var(--radius-md)] overflow-hidden" style={{ animationDelay: `${i * 50}ms` }}>
                <div className="aspect-[210/130] skeleton" />
                <div className="h-[34px] skeleton mt-px" />
              </div>
            ))}
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-[14px] pt-[4px]">
            {rows.map((sf, i) => (
              <div
                key={sf.id}
                className="animate-in overflow-hidden"
                style={{ animationDelay: `${Math.min(i * 26, 360)}ms` }}
              >
                <ShowCard show={sf} song={songForName(sf.song)} onOpen={handleOpen} />
              </div>
            ))}
          </div>
        )}

        {!loading && !showList.length && (
          <div className="flex flex-col items-center justify-center py-[92px]">
            <p className="text-[17px] font-semibold text-ink m-0">No shows yet</p>
            <p className="text-[13px] text-ink-dim mt-[8px] mb-0 text-center max-w-[380px] leading-[1.6]">
              Pick a song, choose the room you are lighting, and Limelight builds the
              first pass for you to shape.
            </p>
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="mt-[18px] inline-flex items-center gap-[7px] h-[var(--control-h)] px-[15px] rounded-[var(--radius-sm)] border-0 text-[13px] font-semibold cursor-pointer hover:brightness-[1.06] active:scale-[0.98] transition-[filter,transform] duration-200"
              style={{ background: "var(--lit)", color: "var(--lit-ink)" }}
            >
              <Plus size={15} strokeWidth={2.4} />
              New show
            </button>
          </div>
        )}

        {!loading && showList.length > 0 && rows.length === 0 && (
          <div className="flex flex-col items-center justify-center py-[76px]">
            <p className="text-[15px] font-semibold text-ink m-0">
              Nothing matches &ldquo;{query}&rdquo;
            </p>
            <p className="text-[13px] text-ink-dim mt-[6px] m-0">
              Try a show name, a song, a room or a designer.
            </p>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="mt-[14px] text-[13px] text-ink border-0 bg-transparent cursor-pointer hover:underline font-medium p-0"
            >
              Clear search
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
