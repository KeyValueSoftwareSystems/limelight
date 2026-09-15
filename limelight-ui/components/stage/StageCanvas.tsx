"use client";

import { useRef, useEffect, useCallback } from "react";
import { usePortalStore } from "@/store/portal";
import { useAnimationLoop } from "@/hooks/useAnimationLoop";
import { readFixtures, trimFixtures } from "@/lib/fixtures";
import { paintStage, ground } from "@/lib/renderer";
import { clamp } from "@/lib/grid";
import type { AnchoredClock } from "@/hooks/useAnchoredClock";

interface StageCanvasProps {
  clockRef: React.RefObject<AnchoredClock | null>;
  playing: boolean;
  /** The playhead, purely so a scrub while paused repaints the rig. Without it
   *  the canvas only updated on the animation loop, which runs while playing —
   *  so moving the playhead over a blackout showed the lights from wherever the
   *  song was last left. */
  currentTime?: number;
}

export function StageCanvas({ clockRef, playing, currentTime }: StageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dprRef = useRef(1);

  const show = usePortalStore((s) => s.show);
  const frames = usePortalStore((s) => s.frames);
  const place = usePortalStore((s) => s.place);
  const trims = usePortalStore((s) => s.trims);

  const sizeCanvas = useCallback(() => {
    const cv = canvasRef.current;
    const box = containerRef.current;
    if (!cv || !box) return;
    const rect = box.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    dprRef.current = dpr;
    cv.width = Math.max(1, Math.round(rect.width * dpr));
    cv.height = Math.max(1, Math.round(rect.height * dpr));
  }, []);

  /* Setting cv.width CLEARS the canvas, so a resize must be followed by a
     repaint. Without that the stage goes black and stays black: while paused
     nothing else paints, so a resize landing after the one-shot paint below
     wiped the preview until the next bake or trim. The ref is so the observer
     always calls the CURRENT paint without re-subscribing on every render. */
  const paintRef = useRef<() => void>(() => {});

  useEffect(() => {
    const resize = () => { sizeCanvas(); paintRef.current(); };
    resize();
    const obs = new ResizeObserver(resize);
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [sizeCanvas]);

  const paint = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv || !show || !frames || !place) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const dpr = dprRef.current;
    const W = cv.width / dpr;
    const H = cv.height / dpr;

    const t = clockRef.current?.position() ?? 0;
    const idx = clamp(Math.floor(t * show.fps), 0, show.frame_count - 1);
    const raw = readFixtures(idx, frames, show, place);
    if (!raw) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ground(ctx, W, H);
      return;
    }

    const fx = trimFixtures(raw, trims);
    /* the show's own clock drives the strobe gate, so a paused preview and a
       running one agree on which half of a flash they are in */
    paintStage(ctx, fx, W, H, dpr, { t });
  }, [show, frames, place, trims, clockRef]);

  useEffect(() => { paintRef.current = paint; }, [paint]);

  useAnimationLoop(paint, playing);

  /* Paint whenever the frame under the playhead could have changed: a new bake,
     a trim change, or the playhead moving while paused. */
  useEffect(() => {
    if (playing) return; // the animation loop already owns painting
    if (show && frames && place) paint();
  }, [show, frames, place, trims, currentTime, playing, paint]);

  return (
    <div
      ref={containerRef}
      className="relative flex-1 min-h-[150px] mx-[var(--spacing-s6)] rounded-lg overflow-hidden bg-[#07090f]"
    >
      <canvas
        ref={canvasRef}
        className="block w-full h-full"
      />
      {(!show || !frames) && (
        <div className="absolute inset-x-0 bottom-1/2 text-center text-[length:var(--text-xs)] tracking-[0.18em] uppercase text-[rgba(215,222,240,0.6)] pointer-events-none">
          {show ? "baking the show…" : "select a song"}
        </div>
      )}
    </div>
  );
}
