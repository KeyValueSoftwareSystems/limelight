"use client";

import { useRef, useCallback, useMemo } from "react";

export interface AnchoredClock {
  position(): number;
  play(at?: number): void;
  pause(): void;
  seek(t: number): void;
  readonly playing: boolean;
}

/**
 * Creates an AnchoredClock bound to an HTMLAudioElement.
 *
 * The clock reads audio.currentTime and between its updates carries the
 * position forward with a wall clock — re-anchoring every time the audio
 * reports a new value. The error can never accumulate because the next
 * real reading resets it.
 *
 * Ported from protocol/clock.js AnchoredClock.
 */
function createAnchoredClock(
  audio: HTMLAudioElement,
  now: () => number = () => performance.now() / 1000,
  maxCarry = 0.25,
): AnchoredClock {
  let lastRaw: number | null = null;
  let rawAt = 0;
  let out = 0;

  function position(): number {
    const raw = audio.currentTime;
    if (audio.paused) {
      lastRaw = raw;
      rawAt = now();
      out = raw;
      return raw;
    }

    if (raw !== lastRaw) {
      lastRaw = raw;
      rawAt = now();
    }

    const carried = now() - rawAt;
    let est = (lastRaw ?? 0) + Math.min(carried, maxCarry);
    if (est < out) est = out;
    out = est;
    return est;
  }

  return {
    get playing() {
      return !audio.paused;
    },
    position,
    play(at?: number) {
      if (at !== undefined) audio.currentTime = Math.max(0, at);
      lastRaw = null;
      out = audio.currentTime;
      rawAt = now();
      audio.play();
    },
    pause() {
      audio.pause();
      lastRaw = null;
      out = audio.currentTime;
    },
    seek(t: number) {
      audio.currentTime = Math.max(0, t);
      lastRaw = null;
      out = audio.currentTime;
      rawAt = now();
    },
  };
}

/**
 * React hook that manages an AnchoredClock for an audio element ref.
 * Returns the clock instance and a setter for the audio element.
 */
export function useAnchoredClock() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clockRef = useRef<AnchoredClock | null>(null);

  const setAudio = useCallback((el: HTMLAudioElement | null) => {
    audioRef.current = el;
    if (el) {
      clockRef.current = createAnchoredClock(el);
    } else {
      clockRef.current = null;
    }
  }, []);

  const clock = useMemo(
    () => ({
      get current() {
        return clockRef.current;
      },
    }),
    [],
  );

  return { clock, setAudio, audioRef };
}

export { createAnchoredClock };
