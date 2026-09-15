"use client";

import { useRef, useCallback, useEffect } from "react";
import { createAnchoredClock, type AnchoredClock } from "./useAnchoredClock";
import { audioUrl } from "@/lib/api";

/**
 * Manages an <audio> element + AnchoredClock pair.
 * Provides load, play, pause, seek, and position reading.
 */
export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clockRef = useRef<AnchoredClock | null>(null);

  /* Create the audio element once on mount */
  useEffect(() => {
    const el = new Audio();
    el.preload = "auto";
    audioRef.current = el;
    clockRef.current = createAnchoredClock(el);
    return () => {
      el.pause();
      el.src = "";
    };
  }, []);

  const load = useCallback((songName: string) => {
    const el = audioRef.current;
    if (!el) return;
    el.src = audioUrl(songName);
    el.load();
    clockRef.current = createAnchoredClock(el);
  }, []);

  const play = useCallback(() => {
    clockRef.current?.play();
  }, []);

  const pause = useCallback(() => {
    clockRef.current?.pause();
  }, []);

  const seek = useCallback((t: number) => {
    clockRef.current?.seek(t);
  }, []);

  const toggle = useCallback(() => {
    const c = clockRef.current;
    if (!c) return;
    if (c.playing) c.pause();
    else c.play();
  }, []);

  const position = useCallback(() => {
    return clockRef.current?.position() ?? 0;
  }, []);

  const playing = useCallback(() => {
    return clockRef.current?.playing ?? false;
  }, []);

  return {
    audioRef,
    clockRef,
    load,
    play,
    pause,
    seek,
    toggle,
    position,
    playing,
  };
}
