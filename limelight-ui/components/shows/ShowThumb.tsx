"use client";

import { useRef, useEffect, useCallback } from "react";
import type { ShowFile } from "@/lib/types";

type Band = { rgb: [number, number, number]; amount: number };

function bandsOf(show: ShowFile): Band[] {
  const plan = show.plan as unknown as
    | { states?: Array<{ colour?: number[]; amount?: number }> }
    | null
    | undefined;
  const states = plan?.states ?? [];
  const out: Band[] = [];
  for (const st of states) {
    const c = st.colour;
    if (!Array.isArray(c) || c.length < 3) continue;
    out.push({
      rgb: [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0],
      amount: typeof st.amount === "number" ? st.amount : 0.5,
    });
  }
  return out;
}

function gestureCount(show: ShowFile): number {
  const plan = show.plan as unknown as { gestures?: unknown[] } | null | undefined;
  return plan?.gestures?.length ?? 0;
}

export function ShowThumb({ show, className = "" }: { show: ShowFile; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const paint = useCallback(() => {
    const cv = canvasRef.current;
    const box = boxRef.current;
    if (!cv || !box) return;
    const r = box.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = r.width;
    const H = r.height;

    ctx.fillStyle = "#06070E";
    ctx.fillRect(0, 0, W, H);

    const bands = bandsOf(show);
    const trussY = H * 0.2;

    if (!bands.length) {
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(W * 0.1, trussY);
      ctx.lineTo(W * 0.9, trussY);
      ctx.stroke();
      return;
    }

    const lamps = 9;
    const gap = W / (lamps + 1);

    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < lamps; i++) {
      const b = bands[i % bands.length];
      const x = gap * (i + 1);
      const amp = 0.25 + b.amount * 0.75;
      const [rr, gg, bb] = b.rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));

      const spread = gap * 1.5;
      const beam = ctx.createLinearGradient(0, trussY, 0, H);
      beam.addColorStop(0, `rgba(${rr},${gg},${bb},${0.5 * amp})`);
      beam.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(x, trussY);
      ctx.lineTo(x + spread, H);
      ctx.lineTo(x - spread, H);
      ctx.closePath();
      ctx.fill();

      const glow = ctx.createRadialGradient(x, trussY, 0, x, trussY, gap * 0.85);
      glow.addColorStop(0, `rgba(${rr},${gg},${bb},${0.95 * amp})`);
      glow.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(x - gap, trussY - gap, gap * 2, gap * 2);
    }
    ctx.globalCompositeOperation = "source-over";

    ctx.strokeStyle = "rgba(255,255,255,0.13)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gap * 0.5, trussY);
    ctx.lineTo(W - gap * 0.5, trussY);
    ctx.stroke();

    const cues = gestureCount(show) || show.edits.length;
    const ticks = Math.min(28, Math.max(4, Math.round(cues / 3)));
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    for (let i = 0; i < ticks; i++) {
      const x = ((i + 0.5) / ticks) * W;
      ctx.fillRect(x, H - 5, 1, 3);
    }
  }, [show]);

  useEffect(() => {
    paint();
    const ro = new ResizeObserver(() => paint());
    if (boxRef.current) ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, [paint]);

  return (
    <div ref={boxRef} className={`relative overflow-hidden bg-[#06070E] ${className}`}>
      <canvas ref={canvasRef} className="block w-full h-full" aria-hidden="true" />
    </div>
  );
}
