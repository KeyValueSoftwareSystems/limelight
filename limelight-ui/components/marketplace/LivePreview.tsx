"use client";

import { useRef, useEffect, useState } from "react";
import { placeFixtures } from "@/lib/fixtures";
import { miniFrame } from "@/lib/renderer";
import * as api from "@/lib/api";
import type { Show, FixturePlacement } from "@/lib/types";

interface LivePreviewProps {
  listing: {
    show: {
      song: string;
      seed: number;
      edits: Array<{ type: string; bar: number; beats: number }>;
    };
  };
  visible: boolean;
}

export function LivePreview({ listing, visible }: LivePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const showRef = useRef<Show | null>(null);
  const framesRef = useRef<Uint8Array | null>(null);
  const placeRef = useRef<FixturePlacement | null>(null);
  const idxRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const loadedRef = useRef(false);
  const [loaded, setLoaded] = useState(false);

  /* Load show data on first visibility */
  useEffect(() => {
    if (!visible || loadedRef.current) return;
    loadedRef.current = true;

    (async () => {
      try {
        const bake = await api.show.bake({
          song: listing.show.song,
          seed: listing.show.seed,
          edits: listing.show.edits,
        });
        if (bake.error) return;

        let status: Awaited<ReturnType<typeof api.show.status>> | null = null;
        for (let i = 0; i < 200; i++) {
          status = await api.show.status(bake.job);
          if (status.state !== "baking") break;
          await new Promise((r) => setTimeout(r, 300));
        }
        if (!status?.show || !status.frames_url) return;

        const buf = await api.show.frames(status.frames_url);
        showRef.current = status.show;
        framesRef.current = buf;
        placeRef.current = placeFixtures(status.show);
        setLoaded(true);
      } catch { /* silently fail */ }
    })();
  }, [visible, listing]);

  /* Animation loop */
  useEffect(() => {
    if (!visible || !loaded) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const loop = () => {
      const cv = canvasRef.current;
      const sh = showRef.current;
      const f = framesRef.current;
      const p = placeRef.current;
      if (!cv || !sh || !f || !p) return;

      const ctx = cv.getContext("2d");
      if (!ctx) return;

      miniFrame(ctx, cv, idxRef.current, f, sh.channels, p);
      idxRef.current = (idxRef.current + 1) % sh.frame_count;
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [visible, loaded]);

  return (
    <canvas
      ref={canvasRef}
      width={320}
      height={180}
      className="block w-full h-full object-cover bg-[#07090f]"
    />
  );
}
