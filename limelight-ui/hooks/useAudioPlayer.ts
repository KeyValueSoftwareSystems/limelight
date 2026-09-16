"use client";

import { useRef, useCallback, useEffect } from "react";
import { createAnchoredClock, type AnchoredClock } from "./useAnchoredClock";
import { audioUrl } from "@/lib/api";
import { outputLatencyOf } from "@/lib/sync";
import { usePortalStore } from "@/store/portal";

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

    /* Ask the device how far behind the clock the SOUND is. `audio.currentTime`
       is the decoder's position; the speakers are a buffer behind it, and the
       preview would otherwise draw every cue that far early. An AudioContext is
       the only thing that will tell us, so one is opened purely to read it and
       closed again — it is never used to play anything. */
    let ctx: AudioContext | null = null;
    try {
      const Ctor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) {
        ctx = new Ctor();
        const report = () => {
          const l = outputLatencyOf(ctx);
          if (l > 0) usePortalStore.getState().setSyncLatency(l);
        };
        report();
        /* outputLatency is often 0 until the graph is actually running */
        ctx.addEventListener?.("statechange", report);
        el.addEventListener("playing", report);
      }
    } catch { /* no audio device, or blocked: 0 is an honest answer */ }

    return () => {
      el.pause();
      el.src = "";
      try { ctx?.close(); } catch { /* already gone */ }
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
