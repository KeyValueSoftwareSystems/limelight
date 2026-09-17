"use client";

import { useRef, useEffect } from "react";
import { drawCover } from "@/lib/cover";
import { coverUrl } from "@/lib/api";
import type { Song } from "@/lib/types";

export function SongThumb({ song, size = 44 }: { song: Song; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cov = song.cover;
  const hasPhoto = cov?.state === "cached" && !!cov.file;

  useEffect(() => {
    const cv = canvasRef.current;
    if (cv) drawCover(cv, song);
  }, [song]);

  return (
    <span
      className="relative block flex-none overflow-hidden rounded-[5px]"
      style={{ width: size, height: size, background: "#0d1018" }}
    >
      <canvas ref={canvasRef} width={128} height={128} className="block w-full h-full object-cover" />
      {hasPhoto && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={coverUrl(cov!.file!)}
          alt=""
          className="absolute inset-0 block w-full h-full object-cover"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      )}
    </span>
  );
}
