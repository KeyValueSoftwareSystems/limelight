"use client";

import { useRef, useEffect, useState, useCallback, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePortalStore } from "@/store/portal";
import { useAnimationLoop } from "@/hooks/useAnimationLoop";
import { readFixtures, trimFixtures } from "@/lib/fixtures";
import { frameFor } from "@/lib/sync";
import { sectionAt, beatPulse } from "@/lib/hud";
import { positionAt } from "@/lib/grid";
import { phaseTint } from "@/lib/tokens";
import { worldOf } from "@/lib/stage3d";
import type { AnchoredClock } from "@/hooks/useAnchoredClock";

interface StageHudProps {
  clockRef: React.RefObject<AnchoredClock | null>;
  playing: boolean;
  currentTime?: number;
}

const REMEMBER = "limelight.stage.hud";

/* Below this the preview is too short to carry the rig map, so it goes and the
   section label and the beat rule stay. The preview drags down to 150px. */
const MAP_MIN_HEIGHT = 220;

/* A desk rig is five fixtures, so the map has to stay legible at five cells as
   well as at forty-six. These are CSS pixels; the canvas is drawn at device
   resolution below so the cells stay crisp. */
const CELL = 11;
const GAP = 3;

/** The remembered choice cannot change under us, so there is nothing to watch. */
const subscribeNever = () => () => {};

/** Read once, the way StagePreview reads its own remembered view: the server
 *  renders it open and the client corrects on hydration, with no second pass. */
function readRemembered(): boolean | null {
  try {
    const v = window.localStorage.getItem(REMEMBER);
    return v === "0" ? false : v === "1" ? true : null;
  } catch {
    return null;                       // private window, or storage blocked
  }
}

/**
 * What is happening, over whichever view is showing.
 *
 * It lives here rather than inside Stage3D or StageCanvas so it cannot report
 * one thing while the picture shows another — which is exactly the failure this
 * whole branch exists to fix.
 *
 * ONE RULE, from the design system in globals.css: nothing in here may be
 * brighter than an unlit lamp. The picture is the brightest thing in the frame;
 * this is hairlines and dim text over it.
 *
 * Everything that changes per frame is written straight to the DOM from the
 * animation loop. React state here would re-render the tree sixty times a
 * second to move one hairline's opacity.
 */
export function StageHud({ clockRef, playing, currentTime }: StageHudProps) {
  const show = usePortalStore((s) => s.show);
  const frames = usePortalStore((s) => s.frames);
  const place = usePortalStore((s) => s.place);
  const trims = usePortalStore((s) => s.trims);
  const syncLatency = usePortalStore((s) => s.syncLatency);
  const syncNudge = usePortalStore((s) => s.syncNudge);
  const syncOffset = syncLatency + syncNudge;

  const remembered = useSyncExternalStore(subscribeNever, readRemembered, () => null);
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? remembered ?? true;

  const [tall, setTall] = useState(true);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setSlot(document.getElementById("stage-hud-slot")); }, []);

  const boxRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const ruleRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const beatRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLCanvasElement>(null);

  /* what was last written, so a frame that changes nothing touches no DOM */
  const lastRef = useRef({ name: "", bar: "" });

  const toggle = () => {
    const next = !open;
    setChosen(next);
    try { window.localStorage.setItem(REMEMBER, next ? "1" : "0"); } catch { /* not worth failing over */ }
  };

  /* the preview is resizable, so the rig map's room to exist is measured */
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const obs = new ResizeObserver(() => {
      setTall(box.getBoundingClientRect().height >= MAP_MIN_HEIGHT);
    });
    obs.observe(box);
    return () => obs.disconnect();
  }, []);

  /* The rig map's grid: one row per truss bar, left to right within each.
     `stage3d.barsOf` groups on this same height:depth key but returns only each
     bar's extent, not its members, so it cannot be called here — this mirrors
     its key so the two always agree about what a bar is. */
  const rowsRef = useRef<string[][]>([]);
  useEffect(() => {
    const fixtures = show?.fixtures ?? [];
    const rows = new Map<string, Array<{ id: string; x: number }>>();
    for (const f of fixtures) {
      const w = worldOf(f.at);
      const key = `${w[1].toFixed(2)}:${w[2].toFixed(2)}`;
      const row = rows.get(key) ?? [];
      row.push({ id: f.id.replace(/_/g, " "), x: w[0] });
      rows.set(key, row);
    }
    /* far trusses first, so the map is hung the way the rig is */
    rowsRef.current = [...rows.entries()]
      .sort((a, b) => Number(a[0].split(":")[1]) - Number(b[0].split(":")[1]))
      .map(([, r]) => r.sort((a, b) => a.x - b.x).map((e) => e.id));
  }, [show]);

  const tick = useCallback(() => {
    if (!show) return;
    const t = clockRef.current?.position() ?? 0;

    /* where we are */
    const sec = sectionAt(t, show.sections ?? []);
    const secName = sec?.name ?? "";
    const name = secName ? secName.charAt(0).toUpperCase() + secName.slice(1) : "\u2014";
    if (name !== lastRef.current.name) {
      lastRef.current.name = name;
      if (labelRef.current) labelRef.current.textContent = name;
      if (ruleRef.current) ruleRef.current.style.backgroundColor = phaseTint(sec?.phase);
    }

    const pos = positionAt(t, show.grid);
    const bar = pos ? `Bar ${pos.bar}\u00b7${pos.beat}` : "";
    if (bar !== lastRef.current.bar) {
      lastRef.current.bar = bar;
      if (barRef.current) barRef.current.textContent = bar;
    }

    /* the beat */
    if (beatRef.current) {
      beatRef.current.style.opacity = String(0.08 + beatPulse(t, show.downbeats ?? []) * 0.5);
    }

    /* the rig, live */
    const cv = mapRef.current;
    if (!cv || !frames || !place) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const raw = readFixtures(frameFor(t, show.fps, show.frame_count, syncOffset), frames, show, place);
    if (!raw) return;

    const fx = trimFixtures(raw, trims);
    const byId = new Map(fx.lamps.map((l) => [l.id, l]));
    const rows = rowsRef.current;
    const cols = rows.reduce((m, r) => Math.max(m, r.length), 1);
    const w = cols * (CELL + GAP);
    const h = rows.length * (CELL + GAP);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== w * dpr || cv.height !== h * dpr) {
      cv.width = w * dpr;
      cv.height = h * dpr;
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      for (let ci = 0; ci < row.length; ci++) {
        const l = byId.get(row[ci]);
        /* an unlit cell stays a hairline, so the shape of the rig is still
           readable when the show is dark */
        if (l && l.k > 0.01) {
          const c = l.rgb;
          ctx.fillStyle = `rgba(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0},${(0.25 + 0.75 * l.k).toFixed(3)})`;
        } else {
          ctx.fillStyle = "rgba(230,234,242,0.10)";
        }
        ctx.fillRect(ci * (CELL + GAP), ri * (CELL + GAP), CELL, CELL);
      }
    }
  }, [show, frames, place, trims, syncOffset, clockRef]);

  useAnimationLoop(tick, playing && open);

  /* a scrub while paused has to move the readout too */
  useEffect(() => { if (!playing && open) tick(); }, [playing, open, currentTime, tick]);

  return (
    <div ref={boxRef} className="absolute inset-0 pointer-events-none">
      {slot &&
        createPortal(
          <button
            type="button"
            onClick={toggle}
            aria-pressed={open}
            title={open ? "Hide the readout" : "Show the readout"}
            className={`pointer-events-auto h-[28px] px-[12px] rounded-[8px] border-0 cursor-pointer transition-colors duration-200 text-[11.5px] ${
              open ? "liquid liquid-key font-medium text-ink" : "liquid-well font-normal text-ink-dim hover:text-ink"
            }`}
          >
            Readout
          </button>,
          slot,
        )}

      {open && (
        <>
          {/* where we are */}
          <div className="absolute left-[var(--spacing-s3)] bottom-[var(--spacing-s4)] flex items-end gap-[var(--spacing-s3)]">
            <span className="flex flex-col gap-[4px]">
              <span ref={labelRef} className="text-[length:var(--text-xs)] text-dim leading-none">—</span>
              <span ref={ruleRef} className="block h-[2px] rounded-full" />
            </span>
            <span ref={barRef} className="tabular text-[length:var(--text-2xs)] text-dimmer leading-none" />
          </div>

          {/* the beat */}
          <div
            ref={beatRef}
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-px bg-ink opacity-[0.08]"
          />

          {/* the rig, live */}
          {tall && (
            <canvas
              ref={mapRef}
              aria-hidden
              className="absolute right-[var(--spacing-s3)] top-[var(--spacing-s8)]"
            />
          )}
        </>
      )}
    </div>
  );
}
