"use client";

import { useRef, useEffect, useState } from "react";
import { miniFrame } from "@/lib/renderer";
import { bakeOnce, rigFor } from "@/lib/bakeCache";
import type { Show, FixturePlacement } from "@/lib/types";

interface LivePreviewProps {
  /** Any show's intent: the song, the seed and the edits are all a bake needs. */
  show: {
    id?: string;
    song: string;
    seed: number;
    edits: Array<{ type: string; bar: number; beats: number }>;
  };
  /** Bake it. Cached, so a grid can prepare itself while you read it. */
  visible: boolean;
  /** Run it. Thirty animating cards at once is noise, not information, so a
   *  card holds one lit frame until you point at it. */
  running?: boolean;
}

export function LivePreview({ show: intent, visible, running = true }: LivePreviewProps) {
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
      layout: rigFor(intent.id ?? intent.song),
    }).then((baked) => {
      if (!live || !baked) return;
      showRef.current = baked.show;
      framesRef.current = baked.frames;
      placeRef.current = baked.place;
      setLoaded(true);
    });
    return () => { live = false; };
  }, [visible, intent]);

  /* Animation loop. Baked is not the same as playing. */
  useEffect(() => {
    if (!visible || !loaded || !running) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      /* Hold one frame from a lit part of the show rather than the intro, so a
         resting card is a picture of the show and not of its silence. */
      const cv = canvasRef.current;
      const sh = showRef.current;
      const fr = framesRef.current;
      const pl = placeRef.current;
      const ctx = cv?.getContext("2d");
      if (loaded && cv && sh && fr && pl && ctx) {
        idxRef.current = Math.floor(sh.frame_count * 0.45);
        miniFrame(ctx, cv, idxRef.current, fr, sh.channels, pl);
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
  }, [visible, loaded, running]);

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
