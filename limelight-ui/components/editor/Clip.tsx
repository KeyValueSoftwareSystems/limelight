"use client";

import Image from "next/image";
import { timeToX } from "@/lib/timeline";
import { effectIcon } from "@/lib/effectIcons";
import { useTimeline } from "./Timeline";
import type { Clip as ClipModel } from "@/lib/types";

export type Gesture = "move" | "trim-start" | "trim-end";

/** A one-beat effect is about 2px at full-song zoom. Below this it stops being
 *  something you can see or grab, so a clip never renders narrower. */
const MIN_CLIP_PX = 16;
/** Wide enough to hold both handles inside without swallowing the body. */
const HANDLES_FIT_PX = 44;

/* Clips are plain. Colour in the timeline means selection and nothing else, so
   the one thing that is highlighted is the thing you are working on. */
export function Clip({
  clip,
  selected,
  top,
  height,
  onSelect,
  onGesture,
  onZoomTo,
}: {
  clip: ClipModel;
  selected: boolean;
  top: number;
  height: number;
  onSelect?: (key: string, additive: boolean) => void;
  onGesture?: (clip: ClipModel, mode: Gesture, e: React.PointerEvent) => void;
  onZoomTo?: (clip: ClipModel) => void;
}) {
  const { view, width } = useTimeline();
  const x0 = timeToX(clip.startS, view, width);
  const x1 = timeToX(clip.endS, view, width);
  if (x1 < -MIN_CLIP_PX || x0 > width) return null;

  const w = Math.max(MIN_CLIP_PX, x1 - x0);
  const editable = !!onGesture;
  const showTrim = editable && (selected || w >= HANDLES_FIT_PX);
  const roomy = w >= HANDLES_FIT_PX;
  const grip = roomy ? { w: 9, out: 0 } : { w: 12, out: 8 };

  return (
    <div
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect?.(clip.key, e.shiftKey);
        if (editable) onGesture!(clip, "move", e);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onZoomTo?.(clip);
      }}
      className={`absolute rounded-[5px] border border-solid touch-none transition-colors duration-[var(--dur-state)] ${
        editable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
      } ${
        selected
          ? "bg-accent border-accent"
          : "bg-bg-raised border-line-strong hover:border-ink-dimmer"
      }`}
      style={{ left: x0, width: w, top, height }}
      title={`${clip.name} · bar ${clip.bar}${clip.beat > 1 ? "." + clip.beat : ""} · ${clip.beats} beat${clip.beats === 1 ? "" : "s"} · double-click to zoom to it`}
    >
      <span
        className="absolute inset-0 flex items-center gap-[5px] px-[7px] pointer-events-none overflow-hidden rounded-[5px]"
        style={{ opacity: selected ? 1 : 0.92 }}
      >
        {w > 34 && (
          <Image
            src={effectIcon({ id: clip.tile ?? clip.fx })}
            alt=""
            width={13}
            height={13}
            className="flex-none"
            style={selected ? { filter: "brightness(0) saturate(0)" } : undefined}
          />
        )}
        {w > 58 && (
          <span
            className="text-[11px] truncate"
            style={{ color: selected ? "var(--bg)" : "var(--ink)" }}
          >
            {clip.name}
          </span>
        )}
      </span>

      {showTrim && (
        <>
          <span
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelect?.(clip.key, false);
              onGesture!(clip, "trim-start", e);
            }}
            className="absolute top-0 bottom-0 cursor-ew-resize rounded-[2px]"
            style={{ left: -grip.out, width: grip.w, background: roomy ? "rgba(0,0,0,0.25)" : "var(--accent)" }}
            title="Trim the start"
          />
          <span
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelect?.(clip.key, false);
              onGesture!(clip, "trim-end", e);
            }}
            className="absolute top-0 bottom-0 cursor-ew-resize rounded-[2px]"
            style={{ right: -grip.out, width: grip.w, background: roomy ? "rgba(0,0,0,0.25)" : "var(--accent)" }}
            title="Trim the end — drag right to make it last longer"
          />
        </>
      )}
    </div>
  );
}
