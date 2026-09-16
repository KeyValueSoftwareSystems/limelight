"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { packRows } from "@/lib/pack";
import { beatAtTime, beatsAcross, fit, panBy, timeToX, xToTime, zoomAt } from "@/lib/timeline";
import type { View } from "@/lib/timeline";
import { resolveSnap } from "@/lib/snap";
import type { SnapContext, SnapStrength, SnapTarget } from "@/lib/snap";
import { clamp, makeGridClock } from "@/lib/grid";
import { effectBeats } from "@/lib/types";
import { useDrag } from "@/store/drag";
import type { Clip as ClipModel, Edit, Effect, Show } from "@/lib/types";

import { Timeline, useTimeline } from "./Timeline";
import type { Gesture } from "./Clip";
import { Ruler } from "./Ruler";
import { SectionBand } from "./SectionBand";
import { EnergyBand } from "./EnergyBand";
import { MomentsBand } from "./MomentsBand";
import { Layer } from "./Layer";
import { Playhead } from "./Playhead";
import { ClipInspector } from "./ClipInspector";
import { TransportBar } from "./TransportBar";

/* The editor under the live stage. Layers are stacking rows, not categories:
   anything overlapping in time moves down a row, so nothing hides behind
   anything else. */

interface Props {
  show: Show | null;
  energy: (number | null)[];
  clips: ClipModel[];
  effects: Effect[];
  currentTime: number;
  playing: boolean;
  selection: string[];
  onSelect: (key: string, additive: boolean) => void;
  onSeek: (t: number) => void;
  onToggle: () => void;
  onPlace: (edit: Edit) => void;
  onRemove: (editIndex: number) => void;
  onUpdateLive: (editIndex: number, patch: Partial<Edit>) => void;
  onMaterialize: (clip: ClipModel) => number | null;
  onCommit: () => void;
  reveal: { key: string; n: number } | null;
  baking: string | null;
}

/* The magnet reaches a fixed distance on SCREEN, not a fixed number of beats.
   A radius counted in beats grew with the zoom, which is backwards — the closer
   you look the finer you mean to place. At placing zoom 0.6 beats was 23px of
   pull, so a drop halfway through a bar was hauled onto a bar line it was
   nowhere near. */
const SNAP_RADIUS_PX = 10;
const DRAG_THRESHOLD_PX = 3;
/* ruler + sections + moments, above the layer rows. Each band carries a 1px
   bottom border on top of its var height, so those count too — without them the
   popover sat 3px high of the row it belongs to. */
const BANDS_H = 22 + 1 + 30 + 1 + 18 + 1;
const ROW_MIN = 26;
const ROW_MAX = 52;

function clampToSong(v: View, duration: number): View {
  const span = Math.min(Math.max(v.to - v.from, 0.25), duration || 1);
  const from = clamp(v.from, 0, Math.max(0, (duration || 1) - span));
  return { from, to: from + span };
}

export function StageTimeline({
  show, energy, clips, effects, currentTime, playing, selection,
  onSelect, onSeek, onToggle, onPlace, onRemove, onUpdateLive, onMaterialize,
  onCommit, reveal, baking,
}: Props) {
  const duration = show?.duration_s ?? 0;
  const [view, setView] = useState<View>(() => fit(duration || 1));
  const [snap, setSnap] = useState<SnapStrength>("bar");
  const [follow, setFollow] = useState(true);
  const [rowsH, setRowsH] = useState(0);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<{ bar: number; beat: number; target: SnapTarget | null } | null>(null);

  const lanesRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const lastSong = useRef<string | null>(null);

  /* The playhead is live but it is not a render input for anything that snaps.
     Reading it through a ref keeps `currentTime` out of the dependency lists
     below, which is the whole point: while a song plays it changes sixty times
     a second, and anything keyed on it is rebuilt sixty times a second with it. */
  const timeRef = useRef(currentTime);
  useEffect(() => { timeRef.current = currentTime; }, [currentTime]);

  const dragEffect = useDrag((s) => s.effect);
  const armed = useDrag((s) => s.armed);
  const setArmed = useDrag((s) => s.arm);
  const setOnDrop = useDrag((s) => s.setOnDrop);

  useEffect(() => {
    if (!show || lastSong.current === show.song) return;
    lastSong.current = show.song;
    setView(fit(show.duration_s ?? 1));
  }, [show]);

  useEffect(() => {
    const el = rowsRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setRowsH(e.contentRect.height));
    ro.observe(el);
    setRowsH(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, [show]);

  /* The gutter scrolls with the lanes. It cannot share their scroller, because
     the lanes must sit in the timeline's coordinate space and the gutter must
     sit outside it. */
  useEffect(() => {
    const el = rowsRef.current;
    if (!el) return;
    const sync = () => {
    };
    el.addEventListener("scroll", sync, { passive: true });
    return () => el.removeEventListener("scroll", sync);
  }, [show]);

  /* `view` was both an input and the output here, and the output was always a
     fresh object, so every scroll re-armed the effect that caused it. Deciding
     inside the updater means the window is read at the moment it is written, and
     returning the same object when nothing should move lets React bail out
     instead of committing a render per frame. */
  useEffect(() => {
    if (!follow || !playing || duration <= 0) return;
    const id = requestAnimationFrame(() =>
      setView((v) => {
        const span = v.to - v.from;
        if (span >= duration) return v;
        if (currentTime >= v.from && currentTime <= v.to - span * 0.15) return v;
        const from = clamp(currentTime - span * 0.3, 0, Math.max(0, duration - span));
        return { from, to: from + span };
      }),
    );
    return () => cancelAnimationFrame(id);
  }, [currentTime, playing, follow, duration]);

  /* One packing across every clip, so a layer means the same thing everywhere. */
  const packed = useMemo(() => packRows(clips), [clips]);
  const layerCount = Math.max(packed.rows, 1);
  const rowHeight = useMemo(() => {
    if (rowsH === 0) return ROW_MIN + 8;
    return clamp(Math.floor(rowsH / layerCount) - 1, ROW_MIN, ROW_MAX);
  }, [rowsH, layerCount]);

  const byLayer = useMemo(() => {
    const out: ClipModel[][] = Array.from({ length: layerCount }, () => []);
    for (const { clip, row } of packed.items) out[row]?.push(clip);
    return out;
  }, [packed, layerCount]);

  /* The song's landmarks — bars, sections, moments — do not move while it plays.
     Only the playhead does, so it is added at the moment of a drop instead of
     being baked in here. Keyed on `currentTime` this memo was rebuilt every
     animation frame, which made `beatAtX` a new function every frame, which
     re-armed every effect holding it sixty times a second. */
  const songCtx: Omit<SnapContext, "playheadBeat"> | null = useMemo(() => {
    if (!show) return null;
    const g = show.grid;
    const bpb = g.beats_per_bar ?? 4;
    return {
      bpb,
      totalBeats: (g.bars ?? 0) * bpb,
      sections: show.sections.map((s) => ({ beat: beatAtTime(s.start, g), label: s.name ?? "section" })),
      moments: show.moments.map((m) => ({ beat: beatAtTime(m.t, g), label: m.what ?? m.kind })),
    };
  }, [show]);

  const beatAtX = useCallback(
    (clientX: number): { beat: number; target: SnapTarget | null } | null => {
      const box = lanesRef.current?.getBoundingClientRect();
      if (!box || !show || !songCtx) return null;
      /* Clamped into the lanes rather than read straight off the pointer: the
         layer gutter stands between the palette and the timeline, so every drag
         towards the start of the song crosses it. A release a few pixels left
         of the lanes means the first beat in view, not nothing. */
      const x = clamp(clientX, box.left, box.right) - box.left;
      const raw = beatAtTime(xToTime(x, view, box.width), show.grid);
      const radius = beatsAcross(x, SNAP_RADIUS_PX, view, box.width, show.grid);
      /* the playhead joins the landmarks here, read live, so snapping to it
         still works to the frame without putting the clock in a dep list */
      const ctx: SnapContext = {
        ...songCtx,
        playheadBeat: beatAtTime(timeRef.current, show.grid),
      };
      const target = resolveSnap(ctx, raw, radius, snap);
      return { beat: Math.max(0, Math.round(target ? target.beat : raw)), target };
    },
    [show, songCtx, view, snap],
  );

  const toBarBeat = useCallback(
    (beatIndex: number) => {
      const bpb = show?.grid.beats_per_bar ?? 4;
      return { bar: Math.floor(beatIndex / bpb) + 1, beat: (beatIndex % bpb) + 1 };
    },
    [show],
  );

  /* The drop zone is the editor's whole width, gutter included. The gutter is
     118px of the only approach from the palette, and a release over it used to
     be dropped on the floor without a word — which reads as the editor being
     broken, not as a miss. beatAtX clamps, so it lands on the first beat in
     view. */
  const isOverTimeline = useCallback((x: number, y: number) => {
    const box = lanesRef.current?.getBoundingClientRect();
    return (
      !!box &&
      x >= box.left && x <= box.right &&
      y >= box.top && y <= box.bottom
    );
  }, []);

  /* Both of these used to be keyed on `beatAtX`, so each re-registered itself on
     every render: two writes into the drag store and a resubscribe per animation
     frame while a song played. They are registered once now and reach the
     current closure through a ref, the same way useAnimationLoop does. */
  const onDropRef = useRef<(effect: Effect, x: number, y: number) => void>(null);
  const onDragMoveRef = useRef<(d: { effect: Effect | null; x: number; y: number }) => void>(null);

  useEffect(() => {
    onDropRef.current = (effect, x, y) => {
      if (!isOverTimeline(x, y)) return;
      const hit = beatAtX(x);
      if (!hit) return;
      onPlace({ type: effect.id, ...toBarBeat(hit.beat), beats: effectBeats(effect) });
    };
    onDragMoveRef.current = (d) => {
      if (!d.effect) { setGhost(null); setHover(null); return; }
      setGhost({ x: d.x, y: d.y });
      if (!isOverTimeline(d.x, d.y)) { setHover(null); return; }
      const hit = beatAtX(d.x);
      setHover(hit ? { ...toBarBeat(hit.beat), target: hit.target } : null);
    };
  }, [isOverTimeline, beatAtX, toBarBeat, onPlace]);

  useEffect(() => {
    setOnDrop((effect, x, y) => onDropRef.current?.(effect, x, y));
    return () => setOnDrop(null);
  }, [setOnDrop]);

  useEffect(() => useDrag.subscribe((d) => onDragMoveRef.current?.(d)), []);

  /* Clicking away anywhere clears the selection. Clips and the popover stop
     their own presses, so only genuine outside presses reach here. */
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el) return;
      if (el.closest?.("[data-clip-inspector]")) return;
      if (lanesRef.current?.contains(el)) return;
      onSelect("", false);
    };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [onSelect]);

  const startGesture = useCallback(
    (clip: ClipModel, mode: Gesture, e: React.PointerEvent) => {
      if (!show) return;
      e.preventDefault();
      const bpb = show.grid.beats_per_bar ?? 4;
      const startBeat = (clip.bar - 1) * bpb + (clip.beat - 1);
      const endBeat = startBeat + clip.beats;
      const grabbed = beatAtX(e.clientX)?.beat ?? startBeat;
      const startX = e.clientX;
      let idx = clip.editIndex;
      let moved = false;

      const move = (ev: PointerEvent) => {
        if (!moved && Math.abs(ev.clientX - startX) < DRAG_THRESHOLD_PX) return;
        if (!moved) {
          moved = true;
          if (idx === null) {
            idx = onMaterialize(clip);
            if (idx !== null) onSelect(`mine:${idx}`, false);
          }
        }
        if (idx === null) return;
        const hit = beatAtX(ev.clientX);
        if (!hit) return;
        if (mode === "move") {
          onUpdateLive(idx, toBarBeat(Math.max(0, startBeat + (hit.beat - grabbed))));
        } else if (mode === "trim-end") {
          onUpdateLive(idx, { beats: Math.max(1, hit.beat - startBeat) });
        } else {
          const next = Math.min(endBeat - 1, Math.max(0, hit.beat));
          onUpdateLive(idx, { ...toBarBeat(next), beats: endBeat - next });
        }
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        if (moved) onCommit();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [show, beatAtX, toBarBeat, onUpdateLive, onMaterialize, onSelect, onCommit],
  );

  const selected = useMemo(() => clips.filter((c) => selection.includes(c.key)), [clips, selection]);
  const removable = useMemo(() => selected.filter((c) => c.editIndex !== null), [selected]);

  const removeSelection = useCallback(() => {
    removable.map((c) => c.editIndex as number).sort((a, b) => b - a).forEach(onRemove);
  }, [removable, onRemove]);

  /** Changing a dial on an arranger clip takes it over first. */
  const changeDials = useCallback(
    (clip: ClipModel, patch: Record<string, unknown>) => {
      const idx = clip.editIndex ?? onMaterialize(clip);
      if (idx === null) return;
      if (clip.editIndex === null) onSelect(`mine:${idx}`, false);
      onUpdateLive(idx, { params: { ...clip.params, ...patch } });
      onCommit();
    },
    [onMaterialize, onSelect, onUpdateLive, onCommit],
  );

  const zoomToClip = useCallback(
    (clip: ClipModel) => {
      const pad = Math.max(0.75, (clip.endS - clip.startS) * 1.5);
      setFollow(false);
      setView(clampToSong({ from: clip.startS - pad, to: clip.endS + pad }, duration));
    },
    [duration],
  );

  useEffect(() => {
    if (!reveal) return;
    const clip = clips.find((c) => c.key === reveal.key);
    if (!clip) return;
    const id = requestAnimationFrame(() => {
      setView((v) => {
        const span = v.to - v.from;
        if ((clip.startS >= v.from && clip.endS <= v.to) || span >= duration) return v;
        const from = clamp(clip.startS - span / 2, 0, Math.max(0, duration - span));
        return { from, to: from + span };
      });
      setFollow(false);
    });
    return () => cancelAnimationFrame(id);
  }, [reveal, clips, duration]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") { setArmed(null); onSelect("", false); return; }
      if (e.key === "[" || e.key === "]") {
        const target = selected[0];
        if (!target) return;
        let idx = target.editIndex;
        if (idx === null) {
          idx = onMaterialize(target);
          if (idx === null) return;
          onSelect(`mine:${idx}`, false);
        }
        e.preventDefault();
        onUpdateLive(idx, { beats: Math.max(1, target.beats + (e.key === "]" ? 1 : -1)) });
        onCommit();
        return;
      }
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (removable.length === 0) return;
      e.preventDefault();
      removeSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, removable, removeSelection, onSelect, setArmed, onUpdateLive, onMaterialize, onCommit]);

  if (!show) {
    return (
      <div className="h-full flex items-center justify-center bg-bg-sunken text-[length:var(--text-xs)] text-ink-dimmer">
        pick a song to start editing
      </div>
    );
  }

  const { secondsAtBar, bpb } = makeGridClock(show.grid);

  /* What the drop will actually claim — where it starts AND how much room it
     takes. A bare line told you the beat but not the clip, so the only way to
     find out what you had placed was to place it. */
  const dropSpan = (() => {
    if (!hover) return null;
    const start = (hover.bar - 1) * bpb + (hover.beat - 1);
    const end = toBarBeat(start + (dragEffect ? effectBeats(dragEffect) : 1));
    return { from: secondsAtBar(hover.bar, hover.beat), to: secondsAtBar(end.bar, end.beat) };
  })();

  const one = selected.length === 1 ? selected[0] : null;
  const oneRow = one ? (packed.items.find((i) => i.clip.key === one.key)?.row ?? 0) : 0;

  return (
    <div className="h-full flex flex-col min-h-0 bg-bg-sunken">
      <TransportBar
        currentTime={currentTime}
        duration={duration}
        grid={show.grid}
        playing={playing}
        onToggle={onToggle}
        selected={selected}
        removableCount={removable.length}
        onRemove={removeSelection}
        onClearSelection={() => onSelect("", false)}
        baking={baking}
        clipCount={clips.length}
        snap={snap}
        onSetSnap={setSnap}
        follow={follow}
        onToggleFollow={() => setFollow((f) => !f)}
        onZoomIn={() => { setFollow(false); setView(zoomAt(view, currentTime, 0.7, duration, 1)); }}
        onZoomOut={() => { setFollow(false); setView(zoomAt(view, currentTime, 1.4, duration, 1)); }}
        onFit={() => setView(fit(duration))}
      />

      <div className="flex-1 min-h-0 flex">
      <div ref={lanesRef} className="flex-1 min-w-0 min-h-0 relative">
        <Timeline
          view={view}
          duration={duration}
          onScrub={onSeek}
          onBackground={(clientX) => {
            /* An armed tile turns a press on the timeline into a placement.
               Otherwise a press on empty timeline lets go of the selection. */
            if (armed) {
              const hit = beatAtX(clientX);
              if (hit) {
                onPlace({ type: armed.id, ...toBarBeat(hit.beat), beats: effectBeats(armed) });
                setArmed(null);
                return;
              }
            }
            onSelect("", false);
          }}
          onZoom={(anchorT, factor) => { setFollow(false); setView(zoomAt(view, anchorT, factor, duration, 1)); }}
          onPan={(dt) => { setFollow(false); setView(panBy(view, dt, duration, 1)); }}
        >
          <div className="absolute inset-0 flex flex-col">
            <Ruler grid={show.grid} />
            <SectionBand sections={show.sections} />
            <MomentsBand moments={show.moments} />

            <div ref={rowsRef} className="flex-1 min-h-0 overflow-y-auto">
              {byLayer.map((rowClips, i) => (
                <Layer
                  key={i}
                  clips={rowClips}
                  selection={selection}
                  height={rowHeight}
                  onSelect={onSelect}
                  onGesture={startGesture}
                  onZoomTo={zoomToClip}
                />
              ))}
            </div>

            <EnergyBand energy={energy} grid={show.grid} />
          </div>

          {hover && dropSpan && (
            <DropGuide from={dropSpan.from} to={dropSpan.to} label={hover.target?.label ?? null} />
          )}
          <Playhead t={currentTime} />

          {one && (
            <Popover
              clip={one}
              effect={effects.find((e) => e.id === (one.tile ?? one.fx))}
              row={oneRow}
              rowHeight={rowHeight}
              onChange={(patch) => changeDials(one, patch)}
              onRemove={removeSelection}
            />
          )}
        </Timeline>
      </div>
      </div>

      {dragEffect && ghost && (
        <div
          className="fixed z-50 pointer-events-none px-[7px] py-[4px] rounded-[5px] text-[10px] whitespace-nowrap border border-solid border-accent"
          style={{ left: ghost.x + 12, top: ghost.y + 12, background: "var(--bg-overlay)", color: "var(--ink)" }}
        >
          {dragEffect.name}
          {hover && <span className="mono text-ink-dim"> · bar {hover.bar}·{hover.beat}</span>}
        </div>
      )}
    </div>
  );
}

/** Positions the inspector against the selected clip, inside the shared mapping. */
function Popover({
  clip, effect, row, rowHeight, onChange, onRemove,
}: {
  clip: ClipModel;
  effect: Effect | undefined;
  row: number;
  rowHeight: number;
  onChange: (patch: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  const { view, width } = useTimeline();
  const x = timeToX(clip.startS, view, width);
  if (x < -260 || x > width + 260) return null;

  /* Anchored under the clip's row and clamped to the timeline, so the card never
     sits over the clip's own trim handles — which is what made resizing a
     selected clip impossible. */
  const PANEL_W = 248;
  const left = Math.min(Math.max(8, x), Math.max(8, width - PANEL_W - 8));
  const top = BANDS_H + (row + 1) * rowHeight + 8;

  return (
    <ClipInspector
      clip={clip}
      effect={effect}
      x={left}
      y={top}
      onChange={onChange}
      onRemove={onRemove}
    />
  );
}

function DropGuide({ from, to, label }: { from: number; to: number; label: string | null }) {
  const { view, width } = useTimeline();
  const x = timeToX(from, view, width);
  const x1 = timeToX(to, view, width);
  if (x1 < 0 || x > width) return null;
  return (
    <div className="absolute top-0 bottom-0 z-30 pointer-events-none" style={{ left: x }}>
      <span
        className="absolute top-0 bottom-0"
        style={{ width: Math.max(2, x1 - x), background: "var(--accent-soft)" }}
      />
      <span className="absolute top-0 bottom-0 w-px" style={{ background: "var(--accent)" }} />
      {label && (
        <span
          className="absolute top-[2px] left-[3px] text-[8px] px-[3px] rounded whitespace-nowrap"
          style={{ background: "var(--bg-overlay)", color: "var(--ink)" }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
