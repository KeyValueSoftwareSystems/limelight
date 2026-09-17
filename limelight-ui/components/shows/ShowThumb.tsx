"use client";

import { useRef, useEffect, useCallback } from "react";
import type { ShowFile, Song } from "@/lib/types";

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

const FALLBACK: Array<[number, number, number]> = [
  [0.23, 0.89, 1.0],
  [0.62, 0.95, 1.0],
  [0.34, 0.62, 0.86],
  [0.85, 0.94, 1.0],
  [0.18, 0.72, 0.9],
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
}

function fallbackBands(show: ShowFile, song?: Song): Band[] {
  const e = (song?.energy ?? []).filter((v): v is number => typeof v === "number");
  const seed = hash(show.id || show.name);
  const n = 5;
  const out: Band[] = [];
  for (let i = 0; i < n; i++) {
    const amount = e.length
      ? Math.min(1, Math.max(0.18, e[Math.floor(((i + 0.5) / n) * e.length)] ?? 0.5))
      : 0.3 + ((seed >> (i * 3)) % 7) / 10;
    out.push({ rgb: FALLBACK[(seed + i) % FALLBACK.length], amount });
  }
  return out;
}

function gestureCount(show: ShowFile): number {
  const plan = show.plan as unknown as { gestures?: unknown[] } | null | undefined;
  return plan?.gestures?.length ?? 0;
}

export function ShowThumb({
  show,
  song,
  className = "",
  transparent = false,
}: {
  show: ShowFile;
  song?: Song;
  className?: string;
  transparent?: boolean;
}) {
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

    ctx.clearRect(0, 0, W, H);
    if (!transparent) {
      ctx.fillStyle = "#04050B";
      ctx.fillRect(0, 0, W, H);
    }

    const found = bandsOf(show);
    const bands = found.length ? found : fallbackBands(show, song);
    const trussY = Math.round(H * 0.26) + 0.5;
    const lamps = 5;
    const gap = W / (lamps + 1);

    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < lamps; i++) {
      const b = bands[i % bands.length];
      const x = Math.round(gap * (i + 1));
      const amp = 0.2 + b.amount * 0.5;
      const [rr, gg, bb] = b.rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));

      const beam = ctx.createLinearGradient(0, trussY, 0, H * 0.92);
      beam.addColorStop(0, `rgba(${rr},${gg},${bb},${0.17 * amp})`);
      beam.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(x, trussY);
      ctx.lineTo(x + gap * 0.62, H * 0.92);
      ctx.lineTo(x - gap * 0.62, H * 0.92);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = `rgba(${rr},${gg},${bb},${0.5 + amp * 0.4})`;
      ctx.fillRect(x - 1.5, trussY - 1.5, 3, 3);
    }
    ctx.globalCompositeOperation = "source-over";

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gap * 0.6, trussY);
    ctx.lineTo(W - gap * 0.6, trussY);
    ctx.stroke();
  }, [show, song, transparent]);

  useEffect(() => {
    paint();
    const ro = new ResizeObserver(() => paint());
    if (boxRef.current) ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, [paint]);

  return (
    <div ref={boxRef} className={`relative overflow-hidden ${transparent ? "pointer-events-none" : "bg-[#06070E]"} ${className}`}>
      <canvas ref={canvasRef} className="block w-full h-full" aria-hidden="true" />
    </div>
  );
}
