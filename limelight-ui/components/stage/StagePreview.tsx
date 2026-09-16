"use client";

import { useState, useSyncExternalStore, useRef, useCallback } from "react";
import { usePortalStore } from "@/store/portal";
import { Stage3D, webglAvailable } from "./Stage3D";
import { StageCanvas } from "./StageCanvas";
import type { AnchoredClock } from "@/hooks/useAnchoredClock";

interface StagePreviewProps {
  clockRef: React.RefObject<AnchoredClock | null>;
  playing: boolean;
  currentTime?: number;
}

type View = "3d" | "2d";
const REMEMBER = "limelight.stage.view";

/** Neither snapshot below can change during a session, so nothing to subscribe to. */
const subscribeNever = () => () => {};

function readRemembered(): View | null {
  try {
    const v = window.localStorage.getItem(REMEMBER);
    return v === "2d" || v === "3d" ? v : null;
  } catch {
    return null;                       // private window, or storage blocked
  }
}

/**
 * The stage preview, in the room or on the page.
 *
 * "3d" stands you in front of house and projects the rig properly. "2d" is the
 * flat elevation, which is genuinely easier to read when you are checking WHICH
 * lamp is lit rather than what the room looks like — so it stays, rather than
 * being only a fallback for a browser with no WebGL.
 */
export function StagePreview({ clockRef, playing, currentTime }: StagePreviewProps) {
  const show = usePortalStore((s) => s.show);
  const frames = usePortalStore((s) => s.frames);

  /* Two client-only facts, each read once: whether this browser has WebGL at
     all, and which view the person last chose. Neither ever changes under us,
     so they are snapshots rather than state — the server renders the flat view
     and the client corrects it on hydration without a second render pass. */
  const can3d = useSyncExternalStore(subscribeNever, webglAvailable, () => false);
  const remembered = useSyncExternalStore(subscribeNever, readRemembered, () => null);

  const [chosen, setChosen] = useState<View | null>(null);
  const view: View = chosen ?? remembered ?? "3d";

  const choose = (next: View) => {
    setChosen(next);
    try { window.localStorage.setItem(REMEMBER, next); } catch { /* not worth failing over */ }
  };

  const live = can3d && view === "3d";

  /* Stage3D owns the camera; it hands back a way to put it home again */
  const homeRef = useRef<(() => void) | null>(null);
  const takeHome = useCallback((fn: () => void) => { homeRef.current = fn; }, []);

  return (
    <div className="relative flex-1 min-h-[150px] mx-[var(--spacing-s6)] rounded-lg overflow-hidden bg-[var(--stage)]">
      {live
        ? <Stage3D clockRef={clockRef} playing={playing} currentTime={currentTime} onHome={takeHome} />
        : <StageCanvas clockRef={clockRef} playing={playing} currentTime={currentTime} />}

      {live && (
        <button
          type="button"
          onClick={() => homeRef.current?.()}
          title="Back to the front-of-house view"
          className="absolute top-[var(--spacing-s3)] left-[var(--spacing-s3)] h-[24px] px-[10px] rounded-full border border-solid border-line bg-[rgba(8,10,16,0.72)] text-[length:var(--text-2xs)] text-dimmer hover:text-ink cursor-pointer backdrop-blur-sm transition-colors duration-[var(--dur-state)]"
        >
          Reset view
        </button>
      )}

      {live && (
        <p className="absolute left-[var(--spacing-s3)] bottom-[var(--spacing-s3)] m-0 text-[length:var(--text-2xs)] text-dimmer pointer-events-none select-none">
          Drag to look around · scroll to zoom
        </p>
      )}

      {can3d && (
        <div
          className="absolute top-[var(--spacing-s3)] right-[var(--spacing-s3)] flex gap-px rounded-full border border-solid border-line bg-[rgba(8,10,16,0.72)] p-px backdrop-blur-sm"
          role="group"
          aria-label="Stage view"
        >
          {(["3d", "2d"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => choose(v)}
              className={`px-[10px] h-[22px] rounded-full text-[length:var(--text-2xs)] cursor-pointer border-0 transition-colors duration-[var(--dur-state)] ${
                view === v ? "bg-[rgba(230,234,242,0.14)] text-ink" : "bg-transparent text-dimmer hover:text-dim"
              }`}
            >
              {v === "3d" ? "Room" : "Plot"}
            </button>
          ))}
        </div>
      )}

      {(!show || !frames) && (
        <div className="absolute inset-x-0 bottom-1/2 text-center text-[length:var(--text-xs)] tracking-[0.18em] uppercase text-[rgba(215,222,240,0.6)] pointer-events-none">
          {show ? "baking the show…" : "select a song"}
        </div>
      )}
    </div>
  );
}
