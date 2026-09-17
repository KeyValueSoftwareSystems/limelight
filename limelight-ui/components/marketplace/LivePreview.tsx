"use client";

import { useRef, useEffect, useState } from "react";
import { miniFrame } from "@/lib/renderer";
import { bakeOnce } from "@/lib/bakeCache";
import type { Show, FixturePlacement } from "@/lib/types";

interface LivePreviewProps {
  /** Any show's intent: the song, the seed and the edits are all a bake needs. */
  show: {
    song: string;
    seed: number;
    edits: Array<{ type: string; bar: number; beats: number }>;
  };
  visible: boolean;
}

export function LivePreview({ show: intent, visible }: LivePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const showRef = useRef<Show | null>(null);
  const framesRef = useRef<Uint8Array | null>(null);
  const placeRef = useRef<FixturePlacement | null>(null);
  const idxRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const loadedRef = useRef(false);
  const [loaded, setLoaded] = useState(false);

  /* One bake per show for the life of the tab, shared by every preview that
     wants it - this used to bake once per card, per visit. */
  useEffect(() => {
    if (!visible || loadedRef.current) return;
    loadedRef.current = true;
    let live = true;
    bakeOnce({
      song: intent.song,
      seed: intent.seed,
      edits: intent.edits,
    }).then((baked) => {
      if (!live || !baked) return;
      showRef.current = baked.show;
      framesRef.current = baked.frames;
      placeRef.current = baked.place;
      setLoaded(true);
    });
    return () => { live = false; };
  }, [visible, intent]);

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
      style={{ opacity: loaded ? 1 : 0, transition: "opacity 300ms var(--ease)" }}
      width={320}
      height={180}
      className="block w-full h-full object-cover bg-[#07090f]"
    />
  );
}
