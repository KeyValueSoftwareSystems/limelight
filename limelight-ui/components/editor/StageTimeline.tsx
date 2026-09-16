"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { packRows } from "@/lib/pack";
import { beatAtTime, beatsAcross, fit, panBy, timeToX, xToTime, zoomAt, MIN_SPAN_S } from "@/lib/timeline";
import type { View } from "@/lib/timeline";
import { resolveSnap } from "@/lib/snap";
import type { SnapContext, SnapStrength, SnapTarget } from "@/lib/snap";
import { clamp, makeGridClock } from "@/lib/grid";
import { tileForClip } from "@/lib/clips";
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
import { Guides, type GuideKind } from "./Guides";
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
  /** Takes one placement or a whole batch, and hands back the edit indices it
   *  made — a paste of four clips is ONE rebake, not four. */
  onPlace: (edit: Edit | Edit[]) => number[];
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
/* The song map's height: ruler + sections + moments, plus the one edge that
   closes it. Measured against the DOM, not guessed — this used to add a pixel
   per band for their borders, which double-counted, because `* { box-sizing:
   border-box }` already puts each border INSIDE its --*-h. Only the map's own
   closing border is extra, since the map sets no height of its own. The popover
   anchors off this, so 2px too many is 2px low on every clip. */
const BANDS_H = 22 + 30 + 18 + 1;
/** --energy-h. The popover stops above the energy band rather than over it. */
const ENERGY_H = 28;
const ROW_MIN = 26;
const ROW_MAX = 52;

/** The shortest a clip may be trimmed to when nothing is pulling at it: a
 *  thirty-second of a beat, about 15ms at 120bpm. With snap on, a beat is
 *  still the floor — that is what "snap" means. */
const FREE_MIN_BEATS = 1 / 32;
/** One press of a fine nudge, in seconds. Ten milliseconds is about a frame
 *  and a half of the 40fps light stream. */
const FINE_S = 0.01;
/** A coarse seek, for the arrows when nothing is selected. */
const SEEK_S = 1;
const SEEK_BIG_S = 5;

/** What the clipboard holds: an effect, its length, and where it sat relative
 *  to the earliest thing copied — so a paste keeps the SHAPE of a group. */
interface Snip {
  type: string;
  offsetBeats: number;
  beats: number;
  params: Record<string, unknown>;
}

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
  const bpb = show?.grid.beats_per_bar ?? 4;
  const [view, setView] = useState<View>(() => fit(duration || 1));
  const [snap, setSnap] = useState<SnapStrength>("bar");
  /* What the editor is ruled against. Bars to start with: it is the measure the
     ruler already counts in, so the lines explain themselves. Everything else
     is opt-in, because six sets of lines at once is a plaid, not a grid. */
  const [guides, setGuides] = useState<GuideKind[]>(["bar"]);
  const [follow, setFollow] = useState(true);
  const [rowsH, setRowsH] = useState(0);
  const [rowsScroll, setRowsScroll] = useState(0);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<{ bar: number; beat: number; target: SnapTarget | null } | null>(null);
  /* A one-line receipt for the things that leave no mark on screen — copying,
     pasting, a nudge that moved a clip by less than a pixel. Without it the
     keyboard half of this editor is indistinguishable from a dead key. */
  const [note, setNote] = useState<string | null>(null);
  /* The clipboard itself is a ref — nothing on screen is drawn from it. Whether
     it holds anything IS drawn (the paste item greys out), so that one bit is
     state beside it rather than a read of the ref during render. */
  const [canPaste, setCanPaste] = useState(false);

  const lanesRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const lastSong = useRef<string | null>(null);
  const clipboard = useRef<Snip[]>([]);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const say = useCallback((text: string) => {
    setNote(text);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), 1800);
  }, []);
  useEffect(() => () => { if (noteTimer.current) clearTimeout(noteTimer.current); }, []);

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

  /* Anything floating over the lanes is positioned in the TIMELINE's coordinate
     space, and the lanes scroll inside it. Without this the inspector stayed
     where the clip used to be the moment the rows moved under it. */
  useEffect(() => {
    const el = rowsRef.current;
    if (!el) return;
    const sync = () => setRowsScroll(el.scrollTop);
    el.addEventListener("scroll", sync, { passive: true });
    sync();
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

  const selected = useMemo(() => clips.filter((c) => selection.includes(c.key)), [clips, selection]);
  const removable = useMemo(() => selected.filter((c) => c.editIndex !== null), [selected]);
  const one = selected.length === 1 ? selected[0] : null;
  const oneRow = useMemo(
    () => (one ? (packed.items.find((i) => i.clip.key === one.key)?.row ?? 0) : 0),
    [one, packed],
  );

  /* A selected clip on a row scrolled out of the lanes cannot be read, trimmed
     or inspected, and its card would be drawn against the wrong row — which is
     how the last layer's inspector ended up under the bottom of the screen.
     Selecting something brings its row back into view. */
  useEffect(() => {
    const el = rowsRef.current;
    if (!el || !one) return;
    const top = oneRow * rowHeight;
    const bottom = top + rowHeight;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
  }, [one, oneRow, rowHeight]);

  /* The song's landmarks — bars, sections, moments — do not move while it plays.
     Only the playhead does, so it is added at the moment of a drop instead of
     being baked in here. Keyed on `currentTime` this memo was rebuilt every
     animation frame, which made `beatAtX` a new function every frame, which
     re-armed every effect holding it sixty times a second. */
  const songCtx: Omit<SnapContext, "playheadBeat"> | null = useMemo(() => {
    if (!show) return null;
    const g = show.grid;
    const per = g.beats_per_bar ?? 4;
    return {
      bpb: per,
      totalBeats: (g.bars ?? 0) * per,
      sections: show.sections.map((s) => ({ beat: beatAtTime(s.start, g), label: s.name ?? "section" })),
      moments: show.moments.map((m) => ({ beat: beatAtTime(m.t, g), label: m.what ?? m.kind })),
    };
  }, [show]);

  /* With snap off, a beat is no longer the floor of placement. The renderer is
     beat-locked in what it DRAWS — an effect's envelope is a function of the
     musical beat — but the baker takes a gesture's window in absolute seconds
     (at_s, from_s/to_s), so where a cue starts and how long it lasts are exact
     to the millisecond. Rounding here was throwing that away before it was ever
     offered. `bar` and `beat` stay fractional all the way through; the v2 plan
     rounds once, to 3dp, in editsToPlan. */
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
      const beat = target ? target.beat : snap === "off" ? raw : Math.round(raw);
      return { beat: Math.max(0, beat), target };
    },
    [show, songCtx, view, snap],
  );

  const toBarBeat = useCallback(
    (beatIndex: number) => ({
      bar: Math.floor(beatIndex / bpb) + 1,
      beat: (beatIndex % bpb) + 1,
    }),
    [bpb],
  );

  /** Where a clip sits, as a beat index. The one conversion both directions use. */
  const beatOf = useCallback((c: ClipModel) => (c.bar - 1) * bpb + (c.beat - 1), [bpb]);

  /** How many beats `dt` seconds are, starting at `t` — exact across a tempo
   *  change, which a flat bpm division would not be. */
  const beatsIn = useCallback(
    (t: number, dt: number) => (show ? beatAtTime(t + dt, show.grid) - beatAtTime(t, show.grid) : 0),
    [show],
  );

  /** The floor on a clip's length, which is what snap actually means. */
  const minBeats = snap === "off" ? FREE_MIN_BEATS : 1;

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

  /** An arranger clip becomes yours the moment you touch it. Returns the edit
   *  index to act on, or null if the catalogue has nothing to make it from. */
  const takeOver = useCallback(
    (clip: ClipModel): number | null => {
      if (clip.editIndex !== null) return clip.editIndex;
      const idx = onMaterialize(clip);
      if (idx !== null) onSelect(`mine:${idx}`, false);
      return idx;
    },
    [onMaterialize, onSelect],
  );

  const startGesture = useCallback(
    (clip: ClipModel, mode: Gesture, e: React.PointerEvent) => {
      if (!show) return;
      e.preventDefault();
      const startBeat = beatOf(clip);
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
          onUpdateLive(idx, { beats: Math.max(minBeats, hit.beat - startBeat) });
        } else {
          const next = Math.min(endBeat - minBeats, Math.max(0, hit.beat));
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
    [show, beatAtX, beatOf, toBarBeat, minBeats, onUpdateLive, onMaterialize, onSelect, onCommit],
  );

  const removeSelection = useCallback(() => {
    removable.map((c) => c.editIndex as number).sort((a, b) => b - a).forEach(onRemove);
  }, [removable, onRemove]);

  /** Changing a dial on an arranger clip takes it over first. */
  const changeDials = useCallback(
    (clip: ClipModel, patch: Record<string, unknown>) => {
      const idx = takeOver(clip);
      if (idx === null) return;
      onUpdateLive(idx, { params: { ...clip.params, ...patch } });
      onCommit();
    },
    [takeOver, onUpdateLive, onCommit],
  );

  /** Move or stretch the selection by a number of beats — the keyboard's half
   *  of the drag. Fractions are kept; they are what a millisecond IS in beats. */
  const nudge = useCallback(
    (mode: "move" | "length", deltaBeats: number) => {
      if (!show || !selected.length) return;
      const keys: string[] = [];
      for (const clip of selected) {
        const idx = clip.editIndex ?? onMaterialize(clip);
        if (idx === null) continue;
        keys.push(`mine:${idx}`);
        if (mode === "move") {
          onUpdateLive(idx, toBarBeat(Math.max(0, beatOf(clip) + deltaBeats)));
        } else {
          onUpdateLive(idx, { beats: Math.max(FREE_MIN_BEATS, clip.beats + deltaBeats) });
        }
      }
      if (!keys.length) return;
      /* Taking one of the arranger's clips over changes its key, so the whole
         selection is re-pointed at what it became. Doing it per clip inside the
         loop would collapse a multi-selection to whichever was taken over last,
         and the next arrow press would move only that one. */
      keys.forEach((k, n) => onSelect(k, n > 0));
      onCommit();
    },
    [show, selected, onMaterialize, onSelect, beatOf, toBarBeat, onUpdateLive, onCommit],
  );

  /** Absolute placement, in seconds — what the inspector's fields write. */
  const retime = useCallback(
    (clip: ClipModel, patch: { startS?: number; lengthS?: number }) => {
      if (!show) return;
      const idx = takeOver(clip);
      if (idx === null) return;
      const startS = patch.startS !== undefined ? clamp(patch.startS, 0, Math.max(0, duration)) : clip.startS;
      const next: Partial<Edit> = {};
      if (patch.startS !== undefined) {
        Object.assign(next, toBarBeat(Math.max(0, beatAtTime(startS, show.grid))));
      }
      if (patch.lengthS !== undefined) {
        next.beats = Math.max(FREE_MIN_BEATS, beatsIn(startS, Math.max(0.001, patch.lengthS)));
      }
      onUpdateLive(idx, next);
      onCommit();
    },
    [show, duration, takeOver, toBarBeat, beatsIn, onUpdateLive, onCommit],
  );

  /* ── copy, cut, paste, duplicate ───────────────────────────────────────────
     A clip is only ever {which effect, where, how long, its dials}, so the
     clipboard holds exactly that. Offsets are relative to the earliest thing
     copied, which is what lets a whole phrase land somewhere else with its own
     internal timing intact. */
  const snip = useCallback(
    (list: ClipModel[]): Snip[] => {
      if (!list.length) return [];
      const base = Math.min(...list.map(beatOf));
      return list.flatMap((c) => {
        const tile = tileForClip(c, effects);
        return tile
          ? [{ type: tile.id, offsetBeats: beatOf(c) - base, beats: c.beats, params: { ...c.params } }]
          : [];
      });
    },
    [beatOf, effects],
  );

  const copySelection = useCallback(() => {
    const cut = snip(selected);
    if (!cut.length) return 0;
    clipboard.current = cut;
    setCanPaste(true);
    return cut.length;
  }, [snip, selected]);

  /** Drop a set of snips at a beat, and leave them selected — you nearly always
   *  want to move what you just pasted. */
  const dropSnips = useCallback(
    (cut: Snip[], atBeat: number) => {
      if (!cut.length) return 0;
      const made = onPlace(
        cut.map((s) => ({
          type: s.type,
          ...toBarBeat(Math.max(0, atBeat + s.offsetBeats)),
          beats: s.beats,
          ...(Object.keys(s.params).length ? { params: s.params } : {}),
        })),
      );
      made.forEach((i, n) => onSelect(`mine:${i}`, n > 0));
      return made.length;
    },
    [onPlace, toBarBeat, onSelect],
  );

  const paste = useCallback(() => {
    if (!show) return;
    if (!clipboard.current.length) { say("nothing copied yet"); return; }
    /* The playhead is the paste point, because it is the one place in the
       editor you have already told it you care about. Snap applies, so a paste
       lands on the bar line you can see rather than wherever the song happened
       to be when you pressed the key. */
    const raw = beatAtTime(timeRef.current, show.grid);
    const at = snap === "off" ? raw : snap === "bar" ? Math.round(raw / bpb) * bpb : Math.round(raw);
    const n = dropSnips(clipboard.current, Math.max(0, at));
    if (n) say(`pasted ${n}`);
  }, [show, snap, bpb, dropSnips, say]);

  const duplicate = useCallback(() => {
    const cut = snip(selected);
    if (!cut.length) return;
    /* Straight after the selection, not on top of it: a duplicate you cannot
       see is indistinguishable from nothing happening. */
    const end = Math.max(...selected.map((c) => beatOf(c) + c.beats));
    const n = dropSnips(cut, end - Math.min(...cut.map((s) => s.offsetBeats)));
    if (n) say(`duplicated ${n}`);
  }, [snip, selected, beatOf, dropSnips, say]);

  const toggleGuide = useCallback((kind: GuideKind) => {
    setGuides((g) => (g.includes(kind) ? g.filter((k) => k !== kind) : [...g, kind]));
  }, []);

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

  /* ── the keyboard ──────────────────────────────────────────────────────────
     Registered ONCE and reaching the current closure through a ref. Keyed on
     its dependencies instead, this listener would be torn down and rebuilt on
     every animation frame the song plays through.

       ←/→            move the selection one beat   ·  nothing selected: seek
       ⇧←/→           one bar                       ·  nothing selected: 5s
       ⌥←/→           10 milliseconds
       [ / ]          shorter / longer by a beat (⇧ a bar, ⌥ 10ms)
       ⌘/Ctrl C X V D copy, cut, paste at the playhead, duplicate
       ⌫ / Del        remove          Esc  let go  */
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;

      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === "c") { const n = copySelection(); if (n) { e.preventDefault(); say(`copied ${n}`); } return; }
        if (k === "x") {
          const n = copySelection();
          if (!n) return;
          e.preventDefault();
          removeSelection();
          say(`cut ${n}`);
          return;
        }
        if (k === "v") { e.preventDefault(); paste(); return; }
        if (k === "d") { e.preventDefault(); duplicate(); return; }
        /* everything else with a modifier belongs to the browser */
        return;
      }

      if (e.key === "Escape") { setArmed(null); onSelect("", false); return; }

      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const dir = e.key === "ArrowRight" ? 1 : -1;
        const target = selected[0];
        if (!target) {
          /* Nothing picked, so the arrows drive the playhead — which is the
             other thing on this timeline you move. */
          const step = e.altKey ? FINE_S : e.shiftKey ? SEEK_BIG_S : SEEK_S;
          onSeek(clamp(timeRef.current + dir * step, 0, Math.max(0, duration)));
          return;
        }
        nudge("move", e.altKey ? beatsIn(target.startS, dir * FINE_S) : dir * (e.shiftKey ? bpb : 1));
        return;
      }

      if (e.key === "[" || e.key === "]") {
        const target = selected[0];
        if (!target) return;
        e.preventDefault();
        const dir = e.key === "]" ? 1 : -1;
        nudge("length", e.altKey ? beatsIn(target.endS, dir * FINE_S) : dir * (e.shiftKey ? bpb : 1));
        return;
      }

      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (removable.length === 0) return;
      e.preventDefault();
      removeSelection();
    },
    [
      selected, removable, removeSelection, onSelect, setArmed, onSeek, duration,
      nudge, beatsIn, bpb, copySelection, paste, duplicate, say,
    ],
  );

  const keyRef = useRef<(e: KeyboardEvent) => void>(null);
  useEffect(() => { keyRef.current = onKey; });
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current?.(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  if (!show) {
    return (
      <div className="h-full flex items-center justify-center bg-bg-sunken text-[length:var(--text-xs)] text-ink-dimmer">
        pick a song to start editing
      </div>
    );
  }

  const { secondsAtBar } = makeGridClock(show.grid);

  /* What the drop will actually claim — where it starts AND how much room it
     takes. A bare line told you the beat but not the clip, so the only way to
     find out what you had placed was to place it. */
  const dropSpan = (() => {
    if (!hover) return null;
    const start = (hover.bar - 1) * bpb + (hover.beat - 1);
    const end = toBarBeat(start + (dragEffect ? effectBeats(dragEffect) : 1));
    return { from: secondsAtBar(hover.bar, hover.beat), to: secondsAtBar(end.bar, end.beat) };
  })();

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
        note={note}
        clipCount={clips.length}
        snap={snap}
        onSetSnap={setSnap}
        guides={guides}
        onToggleGuide={toggleGuide}
        follow={follow}
        onToggleFollow={() => setFollow((f) => !f)}
        onCopy={() => { const n = copySelection(); if (n) say(`copied ${n}`); }}
        onCut={() => { const n = copySelection(); if (n) { removeSelection(); say(`cut ${n}`); } }}
        onPaste={paste}
        onDuplicate={duplicate}
        canPaste={canPaste}
        onZoomIn={() => { setFollow(false); setView(zoomAt(view, currentTime, 0.7, duration, MIN_SPAN_S)); }}
        onZoomOut={() => { setFollow(false); setView(zoomAt(view, currentTime, 1.4, duration, MIN_SPAN_S)); }}
        onFit={() => setView(fit(duration))}
      />

      <div className="flex-1 min-h-0 flex">
      <div ref={lanesRef} className="flex-1 min-w-0 min-h-0 relative">
        <Timeline
          view={view}
          duration={duration}
          onScrub={onSeek}
          onBackground={(clientX) => {
            /* An armed tile turns a press on the timeline into a placement, and
               CLAIMS it, so the playhead does not jump to where you placed. Any
               other press is a seek, and lets go of the selection on the way. */
            if (armed) {
              const hit = beatAtX(clientX);
              if (hit) {
                onPlace({ type: armed.id, ...toBarBeat(hit.beat), beats: effectBeats(armed) });
                setArmed(null);
                return true;
              }
            }
            onSelect("", false);
            return false;
          }}
          onZoom={(anchorT, factor) => { setFollow(false); setView(zoomAt(view, anchorT, factor, duration, MIN_SPAN_S)); }}
          onPan={(dt) => { setFollow(false); setView(panBy(view, dt, duration, MIN_SPAN_S)); }}
        >
          <div className="absolute inset-0 flex flex-col">
            {/* Ruled lines, first so they sit beneath everything that is not
                explicitly lifted above them. */}
            <Guides
              kinds={guides}
              grid={show.grid}
              sections={show.sections}
              moments={show.moments}
              energy={energy}
            />

            {/* The song map: what the TRACK does — bars, the sections the score
                found, the moments inside them. It is CHROME, so it sits on the
                transport's own surface: the eye reads one panel of controls and
                context ending at one strong edge, and everything below that edge
                is the canvas you place on.

                The separation is elevation, not a gap. A gap is a drawn box, and
                it spent a sixth of a lane's height saying what an edge says for
                free. The edge does the work the way the system says a lifted
                surface reads on a near-black ground: rim light (a --line-strong
                rule where every band inside is only --line) and depth beneath it
                (a shadow cast down over the lanes, which costs no height at all).

                z-10 keeps it under the playhead (z-20), which crosses everything. */}
            <div
              /* The hairline is halved for everything INSIDE the map. The bands
                 divided themselves with the same rule that closed the map, so
                 four equal lines read as four strips and the boundary was just
                 the last of them. Subordinating the inner rules is what makes
                 the three bands one object with one edge.

                 It has to be --color-line, not --line: `border-line` compiles to
                 var(--color-line), and --color-line: var(--line) is substituted
                 where it is DECLARED, on :root. What inherits down is the value
                 it already resolved to, so redefining --line here reaches
                 nothing. */
              style={{ "--color-line": "rgba(230, 234, 242, 0.05)" } as React.CSSProperties}
              className="flex-none relative z-10 bg-bg border-b border-solid border-line-strong shadow-[0_5px_8px_-5px_rgba(0,0,0,0.9)]"
            >
              <Ruler grid={show.grid} />
              <SectionBand sections={show.sections} />
              <MomentsBand moments={show.moments} />
            </div>

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
              scrollTop={rowsScroll}
              onChange={(patch) => changeDials(one, patch)}
              onRetime={(patch) => retime(one, patch)}
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
          {hover && <span className="mono text-ink-dim"> · bar {hover.bar}·{Math.round(hover.beat * 100) / 100}</span>}
        </div>
      )}
    </div>
  );
}

/** Positions the inspector against the selected clip, inside the shared mapping
 *  AND inside the editor's own box. */
function Popover({
  clip, effect, row, rowHeight, scrollTop, onChange, onRetime, onRemove,
}: {
  clip: ClipModel;
  effect: Effect | undefined;
  row: number;
  rowHeight: number;
  /** How far the lanes have scrolled under the timeline's coordinate space. */
  scrollTop: number;
  onChange: (patch: Record<string, unknown>) => void;
  onRetime: (patch: { startS?: number; lengthS?: number }) => void;
  onRemove: () => void;
}) {
  const { view, width, height } = useTimeline();
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);

  /* Measured, not assumed. The card's height depends on what the effect offers
     — a colour row, an intensity slider, a blurb of unknown length — so the
     only way to know whether it fits below the clip is to ask it. */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    setH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

  const x = timeToX(clip.startS, view, width);
  if (x < -260 || x > width + 260) return null;

  /* Anchored under the clip's row and clamped to the timeline, so the card never
     sits over the clip's own trim handles — which is what made resizing a
     selected clip impossible. */
  const PANEL_W = 248;
  const left = Math.min(Math.max(8, x), Math.max(8, width - PANEL_W - 8));

  /* Below the row if it fits, above it if not, and pinned inside the editor —
     over the song map if that is the only room left — when neither works. On
     the LAST layer "below" is off the bottom of the screen, so the card, which
     is the only place a clip's exact timing can be read or typed, was sitting
     somewhere nobody could reach.

     The editor's height is the creator's to drag, so "no room" is a state this
     has to handle rather than design around: past the cap the card scrolls. */
  const ROOF = 4;
  const floor = height - ENERGY_H - 6;
  const room = Math.max(80, floor - ROOF);
  const cap = Math.min(h || room, room);

  const rowTop = BANDS_H + row * rowHeight - scrollTop;
  const below = rowTop + rowHeight + 8;
  const above = rowTop - cap - 8;
  const top =
    h === 0 ? below
      : below + cap <= floor ? below
        : above >= BANDS_H + 4 ? above
          : Math.max(ROOF, floor - cap);

  return (
    <ClipInspector
      ref={ref}
      clip={clip}
      effect={effect}
      x={left}
      y={top}
      maxHeight={room}
      onChange={onChange}
      onRetime={onRetime}
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
