"use client";

import { useRef, useEffect, useCallback } from "react";
import { demoStates } from "@/lib/rigdemo";
import { paintStage, ground } from "@/lib/renderer";
import type { Fixture } from "@/lib/types";

interface RigPreviewProps {
  fixtures: Fixture[];
  /** dims the whole canvas for a venue you cannot design for */
  dimmed?: boolean;
  className?: string;
  /** "line" | "arch" — how the rig is laid out, from the layout file */
  geometry?: string | null;
}

/**
 * A venue's rig, running.
 *
 * Three things keep a page of these cheap: it only animates while it is on
 * screen, it paints at the card quality tier, and it honours a reduced-motion
 * preference by painting one frame and stopping.
 */
export function RigPreview({ fixtures, dimmed, className = "", geometry }: RigPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const dprRef = useRef(1);

  const paint = useCallback((t: number) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const dpr = dprRef.current;
    const W = cv.width / dpr;
    const H = cv.height / dpr;
    if (!fixtures.length) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ground(ctx, W, H);
      return;
    }
    paintStage(ctx, demoStates(fixtures, t, geometry) as never, W, H, dpr, { t, quality: "card" });
  }, [fixtures, geometry]);

  const size = useCallback(() => {
    const cv = canvasRef.current;
    const box = boxRef.current;
    if (!cv || !box) return;
    const r = box.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    dprRef.current = dpr;
    cv.width = Math.max(1, Math.round(r.width * dpr));
    cv.height = Math.max(1, Math.round(r.height * dpr));
  }, []);

  useEffect(() => {
    size();
    const ro = new ResizeObserver(() => { size(); paint(performance.now() / 1000); });
    if (boxRef.current) ro.observe(boxRef.current);

    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (still) {
      /* one frame, taken from inside the drop so the card still shows the rig at
         full stretch rather than at its quietest */
      paint(11.25);
      return () => ro.disconnect();
    }

    let running = false;
    const tick = () => {
      paint(performance.now() / 1000);
      rafRef.current = requestAnimationFrame(tick);
    };
    const start = () => { if (!running) { running = true; tick(); } };
    const stop = () => {
      running = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };

    const io = new IntersectionObserver(
      ([e]) => (e.isIntersecting ? start() : stop()),
      { rootMargin: "120px" },
    );
    if (boxRef.current) io.observe(boxRef.current);

    const onVisibility = () => (document.hidden ? stop() : undefined);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [paint, size]);

  return (
    <div
      ref={boxRef}
      className={`relative overflow-hidden bg-[var(--stage)] ${className}`}
      style={dimmed ? { opacity: 0.55 } : undefined}
    >
      <canvas ref={canvasRef} className="block w-full h-full" aria-hidden="true" />
    </div>
  );
}
