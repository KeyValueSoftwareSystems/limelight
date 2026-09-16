"use client";

import { memo } from "react";

import Image from "next/image";
import { timeToX } from "@/lib/timeline";
import { beatsLabel, mmssms } from "@/lib/grid";
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
function ClipBase({
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
  const grip = roomy ? { w: 9, out: 0 } : { w: 13, out: 13 };
  /* Square corners, everywhere. A clip is a span of bars, and a rounded end
     reads as slack about where that span actually stops — at one-beat widths
     the radius was eating most of the clip. Squareness also lets the outboard
     grips butt flush against the body, so a trimmed clip stays one solid bar
     instead of three chips with notches at the joins. */

  return (
    <div
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect?.(clip.key, e.shiftKey);
        if (editable) onGesture!(clip, "move", e);
      }}
      onPointerEnter={(e) => { (e.currentTarget as HTMLElement).style.zIndex = "15"; }}
      onPointerLeave={(e) => { (e.currentTarget as HTMLElement).style.zIndex = selected ? "20" : "1"; }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onZoomTo?.(clip);
      }}
      className={`absolute border border-solid touch-none transition-colors duration-[var(--dur-state)] ${
        editable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
      } ${
        selected
          ? "bg-select border-select"
          : "bg-bg-raised border-line-strong hover:border-ink-dimmer"
      }`}
      style={{ left: x0, width: w, top, height, zIndex: selected ? 20 : 1 }}
      /* Time first, because that is what is being placed, and every number
         rounded to something a person would say. Once a clip can be nudged by
         ten milliseconds its beat stops being whole, and the raw float read
         "bar 15.2.682696860000007" — which looks like a bug in the clip, not
         like a clip a third of the way into a beat. */
      title={
        `${clip.name} · ${mmssms(clip.startS)} · ${beatsLabel(clip.beats)} beat${clip.beats === 1 ? "" : "s"}` +
        ` · bar ${clip.bar}\u00b7${beatsLabel(clip.beat)} · double-click to zoom to it`
      }
    >
      <span
        className="absolute inset-0 flex items-center gap-[5px] px-[7px] pointer-events-none overflow-hidden"
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
          <Grip
            side="start"
            width={grip.w}
            out={grip.out}
            selected={selected}
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelect?.(clip.key, false);
              onGesture!(clip, "trim-start", e);
            }}
          />
          <Grip
            side="end"
            width={grip.w}
            out={grip.out}
            selected={selected}
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelect?.(clip.key, false);
              onGesture!(clip, "trim-end", e);
            }}
          />
        </>
      )}
    </div>
  );
}

/** An end-cap on the selection, not a separate object: it butts against the
 *  clip body and carries a grip mark, so the whole thing reads as one bar you
 *  can take hold of at either end. */
function Grip({
  side,
  width,
  out,
  selected,
  onPointerDown,
}: {
  side: "start" | "end";
  width: number;
  out: number;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const outer = side === "start" ? { left: -out } : { right: -out };
  /* On the selected clip the grip is part of the bar and carries its colour.
     On the others it is only an offer, so it stays a muted neutral — at full
     selection brightness every wide clip on the lane looked selected. */
  const fill = selected ? "var(--select)" : "var(--line-strong)";
  const mark = selected ? "rgba(0,0,0,0.5)" : "rgba(230,234,242,0.55)";
  return (
    <span
      onPointerDown={onPointerDown}
      title={side === "start" ? "Drag to change where it starts" : "Drag to change how long it lasts"}
      className="absolute top-0 bottom-0 flex items-center justify-center cursor-ew-resize"
      style={{
        ...outer,
        width,
        zIndex: 22,
        background: fill,
        boxShadow: selected ? "inset 0 0 0 1px rgba(0,0,0,0.28)" : "none",
      }}
    >
      <span
        aria-hidden
        style={{ width: 2, height: "42%", borderLeft: `1px solid ${mark}`, borderRight: `1px solid ${mark}` }}
      />
    </span>
  );
}

/* Memoised. The playhead moves 60 times a second and it is pushed through React state,
   so the whole editor re-renders on every animation frame. A clip's props do
   not change between those frames -- the arrays and callbacks above it are all
   memoised -- so without this every clip on the timeline was rebuilt 60 times a
   second to draw the same rectangle. This is the single biggest saving in the
   editor, because clips are the most numerous thing on screen.
 */
export const Clip = memo(ClipBase);
