"use client";

import { useRef, useEffect, useCallback } from "react";

/**
 * Runs a callback on every animation frame while `active` is true.
 * Automatically cleans up on unmount.
 */
export function useAnimationLoop(callback: (time: number) => void, active: boolean): void {
  const rafRef = useRef<number | null>(null);
  const cbRef = useRef(callback);

  useEffect(() => {
    cbRef.current = callback;
  });

  useEffect(() => {
    if (!active) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const loop = (time: number) => {
      cbRef.current(time);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [active]);
}

/**
 * Creates a start/stop-able animation loop that does not depend on a boolean.
 */
export function useManualAnimationLoop(callback: (time: number) => void) {
  const rafRef = useRef<number | null>(null);
  const cbRef = useRef(callback);

  useEffect(() => {
    cbRef.current = callback;
  });

  const start = useCallback(() => {
    if (rafRef.current !== null) return;
    const loop = (time: number) => {
      cbRef.current(time);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return { start, stop };
}
