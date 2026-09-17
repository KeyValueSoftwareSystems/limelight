"use client";

import { useRef, useEffect } from "react";
import type { Song } from "@/lib/types";
import { drawCover } from "@/lib/cover";
import { coverUrl } from "@/lib/api";

interface CoverCanvasProps {
  song: Song;
}

export function CoverCanvas({ song }: CoverCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (cv) drawCover(cv, song);
  }, [song]);

  const cov = song.cover;
  const hasPhoto = cov?.state === "cached" && cov.file;

  return (
    <div className="absolute inset-0 bg-[#0d1018]">
      <canvas
        ref={canvasRef}
        width={320}
        height={320}
        className="block w-full h-full object-cover"
      />
      {hasPhoto && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imgRef}
          src={coverUrl(cov!.file!)}
          alt=""
          className="absolute inset-0 block w-full h-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      {cov?.matched?.artist && (
        <span className="absolute left-0 right-0 bottom-0 px-2 py-1 text-[length:var(--text-xs)] text-white/80 bg-gradient-to-t from-black/60 to-transparent whitespace-nowrap overflow-hidden text-ellipsis">
          {cov.matched.artist}
        </span>
      )}
    </div>
  );
}
