"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { packRows } from "@/lib/pack";
import { beatAtTime, fit, panBy, timeToX, xToTime, zoomAt } from "@/lib/timeline";
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

const SNAP_RADIUS_BEATS = 0.6;
const DRAG_THRESHOLD_PX = 3;
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
  const [hidden, setHidden] = useState<number[]>([]);
  const [locked, setLocked] = useState<number[]>([]);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<{ bar: number; beat: number; target: SnapTarget | null } | null>(null);

  const lanesRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const lastSong = useRef<string | null>(null);

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

  useEffect(() => {
    if (!follow || !playing || duration <= 0) return;
    const span = view.to - view.from;
    if (span >= duration) return;
    if (currentTime >= view.from && currentTime <= view.to - span * 0.15) return;
    const from = clamp(currentTime - span * 0.3, 0, Math.max(0, duration - span));
    const id = requestAnimationFrame(() => setView({ from, to: from + span }));
    return () => cancelAnimationFrame(id);
  }, [currentTime, playing, follow, duration, view]);

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

  const snapCtx: SnapContext | null = useMemo(() => {
    if (!show) return null;
    const g = show.grid;
    const bpb = g.beats_per_bar ?? 4;
    return {
      bpb,
      totalBeats: (g.bars ?? 0) * bpb,
      playheadBeat: beatAtTime(currentTime, g),
      sections: show.sections.map((s) => ({ beat: beatAtTime(s.start, g), label: s.name ?? "section" })),
      moments: show.moments.map((m) => ({ beat: beatAtTime(m.t, g), label: m.what ?? m.kind })),
    };
  }, [show, currentTime]);

  const beatAtX = useCallback(
    (clientX: number): { beat: number; target: SnapTarget | null } | null => {
      const box = lanesRef.current?.getBoundingClientRect();
      if (!box || !show || !snapCtx) return null;
      const t = xToTime(clientX - box.left, view, box.width);
      const raw = beatAtTime(t, show.grid);
      const target = resolveSnap(snapCtx, raw, SNAP_RADIUS_BEATS, snap);
      return { beat: Math.max(0, Math.round(target ? target.beat : raw)), target };
    },
    [show, snapCtx, view, snap],
  );

  const toBarBeat = useCallback(
    (beatIndex: number) => {
      const bpb = show?.grid.beats_per_bar ?? 4;
      return { bar: Math.floor(beatIndex / bpb) + 1, beat: (beatIndex % bpb) + 1 };
    },
    [show],
  );

  const isOverLanes = useCallback((x: number, y: number) => {
    const box = lanesRef.current?.getBoundingClientRect();
    return !!box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
  }, []);

  useEffect(() => {
    setOnDrop((effect: Effect, x: number, y: number) => {
      if (!isOverLanes(x, y)) return;
      const hit = beatAtX(x);
      if (!hit) return;
      onPlace({ type: effect.id, ...toBarBeat(hit.beat), beats: effectBeats(effect) });
    });
    return () => setOnDrop(null);
  }, [setOnDrop, isOverLanes, beatAtX, toBarBeat, onPlace]);

  useEffect(
    () =>
      useDrag.subscribe((d) => {
        if (!d.effect) { setGhost(null); setHover(null); return; }
        setGhost({ x: d.x, y: d.y });
        if (!isOverLanes(d.x, d.y)) { setHover(null); return; }
        const hit = beatAtX(d.x);
        setHover(hit ? { ...toBarBeat(hit.beat), target: hit.target } : null);
      }),
    [isOverLanes, beatAtX, toBarBeat],
  );

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

  const { secondsAtBar } = makeGridClock(show.grid);
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

      <div ref={lanesRef} className="flex-1 min-h-0 relative">
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
                  index={i}
                  clips={hidden.includes(i) ? [] : rowClips}
                  selection={selection}
                  height={rowHeight}
                  hidden={hidden.includes(i)}
                  locked={locked.includes(i)}
                  onToggleHidden={() =>
                    setHidden((h) => (h.includes(i) ? h.filter((x) => x !== i) : [...h, i]))
                  }
                  onToggleLocked={() =>
                    setLocked((l) => (l.includes(i) ? l.filter((x) => x !== i) : [...l, i]))
                  }
                  onAdd={() => onSelect("", false)}
                  onSelect={onSelect}
                  onGesture={startGesture}
                  onZoomTo={zoomToClip}
                />
              ))}
            </div>

            <EnergyBand energy={energy} grid={show.grid} />
          </div>

          {hover && <DropGuide t={secondsAtBar(hover.bar, hover.beat)} label={hover.target?.label ?? null} />}
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
  if (x < -240 || x > width + 240) return null;
  const left = Math.min(Math.max(8, x + 124), Math.max(8, width - 150));
  return (
    <ClipInspector
      clip={clip}
      effect={effect}
      x={left}
      y={Math.min(90 + row * rowHeight, 160)}
      onChange={onChange}
      onRemove={onRemove}
    />
  );
}

function DropGuide({ t, label }: { t: number; label: string | null }) {
  const { view, width } = useTimeline();
  const x = timeToX(t, view, width);
  if (x < 0 || x > width) return null;
  return (
    <div className="absolute top-0 bottom-0 z-30 pointer-events-none" style={{ left: x }}>
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
