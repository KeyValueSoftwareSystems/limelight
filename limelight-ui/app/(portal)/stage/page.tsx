"use client";

import { useEffect, useCallback, useRef, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { usePortalStore } from "@/store/portal";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { useAnimationLoop } from "@/hooks/useAnimationLoop";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { placeFixtures } from "@/lib/fixtures";
import { mmss, clamp } from "@/lib/grid";
import * as api from "@/lib/api";

import { StageCanvas } from "@/components/stage/StageCanvas";
import { TargetLine } from "@/components/stage/TargetLine";
import { ConsolePanel } from "@/components/stage/ConsolePanel";
import { RigPanel } from "@/components/stage/RigPanel";
import { LimitsPanel } from "@/components/stage/LimitsPanel";
import { StatePanel } from "@/components/stage/StatePanel";
import { VenuePicker } from "@/components/venues/VenuePicker";
import { StageTimeline } from "@/components/editor/StageTimeline";
import { Sidebar } from "@/components/editor/Sidebar";
import { ChatPanel } from "@/components/editor/ChatPanel";
import { buildClips } from "@/lib/clips";
import type { Clip } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { Venue } from "@/lib/types";

export default function StagePage() {
  const router = useRouter();
  const { clockRef, load, pause, seek, toggle, position, playing } = useAudioPlayer();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [stageMsg, setStageMsg] = useState<string | null>("select a song");
  const rebuildTokenRef = useRef(0);
  const [showNameInput, setShowNameInput] = useState("");
  const [venuePickerOpen, setVenuePickerOpen] = useState(false);

  /* The editor's height is the creator's to choose: pull it up while placing
     clips, push it down while judging the look. A fixed ratio is always wrong
     for one of those. */
  const [editorH, setEditorH] = useState(300);
  const columnRef = useRef<HTMLDivElement>(null);

  const MIN_EDITOR = 160;
  const MIN_PREVIEW = 150;

  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      const box = columnRef.current?.getBoundingClientRect();
      if (!box) return;
      const next = box.bottom - ev.clientY;
      setEditorH(Math.max(MIN_EDITOR, Math.min(next, box.height - MIN_PREVIEW)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);
  const rehydratedRef = useRef(false);

  /* read URL params once on mount (safe for SSR since guarded by typeof window) */
  const urlParams = useMemo(() => {
    if (typeof window === "undefined") return { song: null, seed: null };
    const sp = new URLSearchParams(window.location.search);
    return { song: sp.get("song"), seed: sp.get("seed") };
  }, []);

  const song = usePortalStore((s) => s.song);
  const setSong = usePortalStore((s) => s.setSong);
  const setSeed = usePortalStore((s) => s.setSeed);
  const setSongs = usePortalStore((s) => s.setSongs);
  const show = usePortalStore((s) => s.show);
  const seed = usePortalStore((s) => s.seed);
  const edits = usePortalStore((s) => s.edits);
  const venue = usePortalStore((s) => s.venue);
  const role = usePortalStore((s) => s.role);
  const layout = usePortalStore((s) => s.layout);
  const want = usePortalStore((s) => s.want);
  const sel = usePortalStore((s) => s.sel);
  const arm = usePortalStore((s) => s.arm);
  const effects = usePortalStore((s) => s.effects);

  const setShow = usePortalStore((s) => s.setShow);
  const setFrames = usePortalStore((s) => s.setFrames);
  const setApplied = usePortalStore((s) => s.setApplied);
  const setJob = usePortalStore((s) => s.setJob);
  const setPlace = usePortalStore((s) => s.setPlace);
  const setNatural = usePortalStore((s) => s.setNatural);
  const setSecIndex = usePortalStore((s) => s.setSecIndex);
  const setView = usePortalStore((s) => s.setView);
  const setShowId = usePortalStore((s) => s.setShowId);
  const setShowVersion = usePortalStore((s) => s.setShowVersion);
  const setArm = usePortalStore((s) => s.setArm);
  const setSel = usePortalStore((s) => s.setSel);
  const removeEdit = usePortalStore((s) => s.removeEdit);
  const addEdit = usePortalStore((s) => s.addEdit);
  const updateEdit = usePortalStore((s) => s.updateEdit);
  const setRoom = usePortalStore((s) => s.setRoom);
  const setLayout = usePortalStore((s) => s.setLayout);
  const author = usePortalStore((s) => s.author);
  const room = usePortalStore((s) => s.room);
  const showId = usePortalStore((s) => s.showId);

  /* ── rehydrate song from URL params on page refresh ──────────────────── */
  useEffect(() => {
    if (rehydratedRef.current) return;
    if (song) { rehydratedRef.current = true; return; }

    const songParam = urlParams.song;
    const seedParam = urlParams.seed;
    if (!songParam) { rehydratedRef.current = true; return; }
    rehydratedRef.current = true;

    if (seedParam) setSeed(Number(seedParam));
    queueMicrotask(() => setStageMsg("loading song\u2026"));

    api.songs.list().then((d) => {
      setSongs(d.songs);
      const found = d.songs.find((s) => s.name === songParam);
      if (found) {
        setSong(found);
      } else {
        setStageMsg(`song "${songParam}" not found`);
      }
    }).catch(() => {
      setStageMsg("failed to load songs");
    });
  }, [song, urlParams, setSong, setSeed, setSongs]);

  /* ── bake a show ─────────────────────────────────────────────────────── */
  const rebuild = useCallback(async () => {
    if (!song) return;
    const token = ++rebuildTokenRef.current;
    setStageMsg("baking the show…");

    try {
      const post = await api.show.bake({
        song: song.name,
        seed,
        edits,
        appetite: want,
        layout: layout ?? undefined,
      });

      if (post.error) { setStageMsg(post.error); return; }
      setJob(post.job);

      let status: Awaited<ReturnType<typeof api.show.status>> | null = null;
      for (let i = 0; i < 300; i++) {
        status = await api.show.status(post.job);
        if (token !== rebuildTokenRef.current) return;
        if (status.state !== "baking") break;
        setStageMsg(`baking the show… ${(i / 4) | 0}s`);
        await new Promise((r) => setTimeout(r, 250));
      }

      if (!status || status.state !== "ready") {
        setStageMsg(status?.error ?? "the bake timed out");
        return;
      }

      const buf = await api.show.frames(status.frames_url!);
      if (token !== rebuildTokenRef.current) return;

      setFrames(buf);
      setShow(status.show!);
      setApplied(status.applied ?? []);
      setPlace(placeFixtures(status.show!));
      setNatural(status.show!.appetite_natural ?? null);
      setView(null);
      setStageMsg(null);
    } catch (e) {
      setStageMsg(e instanceof Error ? e.message : "bake failed");
    }
  }, [song, seed, edits, want, layout, setShow, setFrames, setApplied, setJob, setPlace, setNatural, setView]);

  /* ── load audio + bake on song change ────────────────────────────────── */
  const rebuildRef = useRef(rebuild);
  useEffect(() => { rebuildRef.current = rebuild; });
  useEffect(() => {
    if (!song) return;
    load(song.name);
    const timer = setTimeout(() => rebuildRef.current(), 0);
    return () => clearTimeout(timer);
  }, [song, load]);

  /* ── playback toggle ─────────────────────────────────────────────────── */
  const handleToggle = useCallback(() => {
    toggle();
    setIsPlaying(playing());
  }, [toggle, playing]);

  const handleSeek = useCallback(
    (t: number) => {
      seek(clamp(t, 0, (show?.duration_s ?? 1) - 0.01));
      setCurrentTime(position());
    },
    [seek, show, position],
  );

  /* ── update current time ─────────────────────────────────────────────── */
  useAnimationLoop(() => {
    const t = position();
    setCurrentTime(t);
    setIsPlaying(playing());

    if (show) {
      let idx = -1;
      show.sections.forEach((s, j) => {
        if (t >= s.start && t < s.end) idx = j;
      });
      setSecIndex(idx);
    }
  }, true);

  /* ── keyboard shortcuts ──────────────────────────────────────────────── */
  useKeyboardShortcuts({
    onSpace: handleToggle,
    onEscape: () => {
      if (arm) setArm(null);
      else if (sel >= 0) setSel(-1);
    },
    onDelete: () => {
      if (sel >= 0 && role === "creator") {
        removeEdit(sel);
        rebuild();
      }
    },
  });

  /* ── save show ───────────────────────────────────────────────────────── */
  const handleSave = useCallback(async () => {
    if (!show || !song) return;
    const name = showNameInput.trim();
    if (!name) return;
    try {
      const d = await api.shows.save({
        id: showId,
        song: song.name,
        seed,
        edits,
        name,
        author: author || "unknown",
        appetite: want,
        score_version: song.version,
        designed_for: room ? { venue_id: room.id, venue_name: room.name, layout: layout ?? undefined } : null,
      });
      if (!d.error) {
        setShowId(d.id);
        setShowVersion(d.version);
        setShowNameInput("");
      }
    } catch { /* noop */ }
  }, [show, song, showNameInput, showId, seed, edits, author, want, room, layout, setShowId, setShowVersion]);

  /* The timeline and the effects panel both read these, so they live on the
     page rather than inside either one. */
  const [selection, setSelection] = useState<string[]>([]);

  /* A clip that has been taken over is not drawn: your version stands in its
     place, so showing both would just be the same effect twice. */
  const clips = useMemo(() => {
    if (!show) return [];
    return buildClips(show.plan ?? null, edits, effects, show.grid).filter((c) => !c.overridden);
  }, [show, edits, effects]);

  /* A reveal request brings a clip into view. The list that raised them is gone
     for now, but the timeline still honours them — the chat rail will want it. */
  const [reveal] = useState<{ key: string; n: number } | null>(null);
  const handleSelect = useCallback((key: string, additive: boolean) => {
    /* An empty key clears — the toolbar's × and Escape both use it. */
    setSelection((sel) =>
      key === ""
        ? []
        : additive
          ? sel.includes(key)
            ? sel.filter((k) => k !== key)
            : [...sel, key]
          : [key],
    );
  }, []);

  /* ── placing and removing effects ────────────────────────────────────────
     The clip appears the instant it is dropped; the lights catch up when the
     bake lands. Blocking the timeline on a 1-3s round trip would make placing
     feel broken even though nothing is wrong. */
  const handlePlace = useCallback(
    (edit: Parameters<typeof addEdit>[0]) => {
      addEdit(edit);
      rebuild();
    },
    [addEdit, rebuild],
  );

  const handleRemove = useCallback(
    (index: number) => {
      removeEdit(index);
      rebuild();
    },
    [removeEdit, rebuild],
  );

  /* Dragging updates the edit locally on every pointer move so the clip tracks
     the cursor; the bake fires once, on release. Re-baking mid-drag would stall
     the gesture behind a 1-3s round trip for no benefit. */
  const handleUpdateLive = useCallback(
    (index: number, patch: Parameters<typeof updateEdit>[1]) => updateEdit(index, patch),
    [updateEdit],
  );

  const handleCommit = useCallback(() => { rebuild(); }, [rebuild]);

  /* Taking over one of the arranger's clips: copy what it does into an edit of
     your own at the same place. The machine's version stays on the timeline,
     struck through, so it is obvious what was replaced and where. */
  const handleMaterialize = useCallback(
    (clip: Clip): number | null => {
      const tile =
        effects.find((e) => e.fx === clip.fx && e.beats === clip.beats) ??
        effects.find((e) => e.fx === clip.fx);
      if (!tile) return null;
      /* Read the live count, not a closed-over one: two materialisations in the
         same tick would otherwise both claim the same index. */
      const index = usePortalStore.getState().edits.length;
      addEdit({ type: tile.id, bar: clip.bar, beat: clip.beat, beats: clip.beats });
      return index;
    },
    [effects, addEdit],
  );

  /* ── venue picker ────────────────────────────────────────────────────── */
  const handlePickVenue = useCallback(
    (v: Venue, layoutFile: string) => {
      setRoom({ id: v.id, name: v.name, layout: layoutFile, example: v.example });
      setLayout(layoutFile);
      setVenuePickerOpen(false);
      rebuild();
    },
    [setRoom, setLayout, rebuild],
  );

  /* ── back button ─────────────────────────────────────────────────────── */
  const handleBack = useCallback(() => {
    pause();
    setIsPlaying(false);
    router.push(venue ? "/shows" : "/library");
  }, [pause, venue, router]);

  /* Bar/beat and frame readouts moved onto the editor's transport, where they
     sit beside the timeline they describe. */

  return (
    <>
      <div className="flex flex-1 min-h-0 overflow-hidden bg-bg text-ink">
        {/* ── rail: navigation and the palettes, independent of the editor ── */}
        <div className="flex-none w-[248px] min-w-[212px]">
          <Sidebar effects={effects} />
        </div>

        {/* ── the work area ─────────────────────────────────────────────── */}
        <div ref={columnRef} className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden">
          {/* header */}
          <header className="flex-none flex items-start gap-[var(--spacing-s4)] px-[var(--spacing-s5)] pt-[var(--spacing-s4)] pb-[var(--spacing-s3)]">
            <div className="min-w-0">
              <h1 className="text-[length:var(--text-2xl)] leading-[32px] truncate">
                {song?.title ?? "—"}
              </h1>
              <div className="mono text-[length:var(--text-xs)] text-ink-dim mt-[2px]">
                {song
                  ? `${mmss(song.duration_s ?? 0)} · ${Math.round(song.bpm ?? 0)} BPM · ${show?.grid.bars ?? "—"} BARS`
                  : ""}
              </div>
            </div>
            <span className="flex-1" />
            <div className="flex items-center gap-[var(--spacing-s2)] pt-[6px]">
              {role === "creator" && (
                <>
                  <Input
                    placeholder="name this show"
                    autoComplete="off"
                    className="w-[132px]"
                    value={showNameInput}
                    onChange={(e) => setShowNameInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSave()}
                  />
                  <Button variant="link" onClick={handleSave}>Save</Button>
                </>
              )}
              <Button variant="link" onClick={handleBack}>Back</Button>
            </div>
          </header>

          <div className="flex-none px-[var(--spacing-s5)]">
            <TargetLine onOpenVenuePicker={() => setVenuePickerOpen(true)} />
          </div>

          {/* live preview */}
          <StageCanvas clockRef={clockRef} playing={isPlaying} currentTime={currentTime} />
          {stageMsg && (
            <div className="flex-none text-center text-[length:var(--text-xs)] text-ink-dimmer py-[4px]">
              {stageMsg}
            </div>
          )}

          {/* divider — only the editor below resizes */}
          <div
            onPointerDown={startResize}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize the editor"
            className="flex-none h-[7px] cursor-row-resize border-y border-solid border-line hover:bg-bg-raised transition-colors duration-[var(--dur-state)]"
          />

          <section style={{ height: editorH }} className="flex-none min-h-0 overflow-hidden">
            <StageTimeline
              show={show}
              energy={song?.energy ?? []}
              clips={clips}
              effects={effects}
              selection={selection}
              onSelect={handleSelect}
              currentTime={currentTime}
              playing={isPlaying}
              onSeek={handleSeek}
              onToggle={handleToggle}
              onPlace={handlePlace}
              onRemove={handleRemove}
              onUpdateLive={handleUpdateLive}
              onMaterialize={handleMaterialize}
              onCommit={handleCommit}
              reveal={reveal}
              baking={stageMsg}
            />
          </section>
        </div>

        {/* ── conversation ──────────────────────────────────────────────── */}
        <aside className="flex-none w-[304px] min-w-[240px] border-l border-solid border-line overflow-hidden">
          {role === "creator" ? (
            <ChatPanel />
          ) : (
            <div className="h-full overflow-y-auto">
              <ConsolePanel />
              <RigPanel />
              <LimitsPanel />
              <StatePanel />
            </div>
          )}
        </aside>
      </div>

      <VenuePicker
        open={venuePickerOpen}
        onClose={() => setVenuePickerOpen(false)}
        onPick={handlePickVenue}
      />
    </>
  );
}
