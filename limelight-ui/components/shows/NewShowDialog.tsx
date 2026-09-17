"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, Check } from "lucide-react";
import { usePortalStore } from "@/store/portal";
import * as api from "@/lib/api";
import { SongThumb } from "@/components/library/SongThumb";
import { UploadButton } from "@/components/library/UploadButton";
import { mmss } from "@/lib/grid";
import type { Song } from "@/lib/types";

export function NewShowDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (names: string[]) => void;
}) {
  const songs = usePortalStore((s) => s.songs);
  const setSongs = usePortalStore((s) => s.setSongs);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (!songs.length) api.songs.list().then((d) => setSongs(d.songs)).catch(() => {});
    searchRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, songs.length, setSongs, onClose]);

  useEffect(() => { if (!open) { setChosen([]); setQuery(""); } }, [open]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? songs.filter(
          (s) =>
            s.title.toLowerCase().includes(q) ||
            s.name.toLowerCase().includes(q) ||
            (s.quality?.key ?? "").toLowerCase().includes(q),
        )
      : songs;
    return [...list].sort((a, b) => a.title.localeCompare(b.title));
  }, [songs, query]);

  if (!open) return null;

  const toggle = (s: Song) => {
    if (!(s.audio && s.bakeable)) return;
    setChosen((cur) => (cur.includes(s.name) ? cur.filter((n) => n !== s.name) : [...cur, s.name]));
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-[20px]"
      style={{ background: "rgba(2,3,8,0.72)", backdropFilter: "blur(6px)" }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="New show"
    >
      <div
        className="mat-glass flex flex-col w-full max-w-[760px] max-h-[82vh] rounded-[var(--radius-xl)] overflow-hidden animate-scale-in"
      >
        <div className="flex-none flex items-start gap-[14px] px-[22px] pt-[20px] pb-[14px]">
          <div className="min-w-0 flex-1">
            <h2 className="text-[19px] font-semibold tracking-[-0.02em] m-0 text-ink leading-[1.2]">
              New show
            </h2>
            <p className="text-[13px] text-ink-dim mt-[5px] m-0">
              Choose the songs this show plays, in order.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex-none flex items-center justify-center w-[28px] h-[28px] rounded-[6px] border-0 bg-transparent text-ink-dimmer hover:text-ink hover:bg-[var(--surface-2)] cursor-pointer transition-colors duration-150"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex-none flex items-center gap-[12px] px-[22px] pb-[12px]">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-[12px] top-1/2 -translate-y-1/2 text-ink-dimmer pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search songs"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="mat-well w-full h-[var(--control-h)] pl-[35px] pr-[12px] rounded-[var(--radius-sm)] text-[13px] text-ink outline-none placeholder:text-ink-dimmer"
            />
          </div>
          <UploadButton />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-[12px] pb-[10px]">
          {rows.map((s) => {
            const at = chosen.indexOf(s.name);
            const on = at >= 0;
            const playable = !!(s.audio && s.bakeable);
            const why = !s.bakeable ? "No score" : !s.audio ? "No audio" : "";
            return (
              <button
                key={s.name}
                type="button"
                disabled={!playable}
                onClick={() => toggle(s)}
                aria-pressed={on}
                className={`w-full flex items-center gap-[12px] px-[10px] py-[7px] rounded-[7px] border-0 text-left transition-colors duration-150 ${
                  playable ? "cursor-pointer hover:bg-[var(--surface-1)]" : "cursor-default opacity-40"
                }`}
                style={on ? { background: "var(--surface-accent-2)" } : { background: "transparent" }}
              >
                <SongThumb song={s} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-ink truncate">{s.title}</span>
                  <span className="mono block text-[11px] text-ink-dimmer tabular-nums truncate">
                    {s.bpm ? `${Math.round(s.bpm)} BPM` : "—"}
                    {s.quality?.key ? ` · ${s.quality.key}` : ""}
                    {s.duration_s != null ? ` · ${mmss(s.duration_s)}` : ""}
                    {why ? ` · ${why}` : ""}
                  </span>
                </span>
                <span
                  className="flex-none flex items-center justify-center w-[22px] h-[22px] rounded-full text-[11px] font-semibold tabular-nums"
                  style={
                    on
                      ? { background: "var(--mat-accent)", color: "var(--lit-ink-on)", boxShadow: "var(--mat-accent-edge)" }
                      : { boxShadow: "inset 0 0 0 1px var(--edge-strong)", color: "transparent" }
                  }
                >
                  {on ? (chosen.length > 1 ? at + 1 : <Check size={13} strokeWidth={3} />) : ""}
                </span>
              </button>
            );
          })}

          {rows.length === 0 && (
            <p className="text-[13px] text-ink-dim text-center py-[40px] m-0">
              Nothing matches &ldquo;{query}&rdquo;.
            </p>
          )}
        </div>

        <div
          className="flex-none flex items-center gap-[12px] px-[22px] h-[62px] border-t border-solid border-[var(--edge)]"
        >
          <span className="text-[13px] text-ink-dim min-w-0 truncate">
            {chosen.length === 0 ? (
              "Pick one song, or several for a setlist."
            ) : (
              <>
                <span className="text-ink font-medium">
                  {chosen.length} song{chosen.length === 1 ? "" : "s"}
                </span>
                <span className="text-ink-dimmer">
                  {" · "}
                  {chosen.map((n) => songs.find((s) => s.name === n)?.title ?? n).join(" → ")}
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
            onClick={() => onCreate(chosen)}
            className="mat-accent-key gloss flex-none inline-flex items-center h-[var(--control-h)] px-[16px] rounded-[var(--radius-sm)] text-[13px] font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-default"
          >
            {chosen.length > 1 ? `Design ${chosen.length} songs` : "Design this show"}
          </button>
        </div>
      </div>
    </div>
  );
}
