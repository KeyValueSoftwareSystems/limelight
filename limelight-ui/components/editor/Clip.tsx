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
  const grip = roomy ? { w: 9, out: 0 } : { w: 13, out: 13 };
  /* Too narrow to hold its handles: the grips sit outside and butt against the
     body, so the three parts have to compose into one capsule. The body goes
     square-cornered and the grips carry the rounding at the outer ends —
     otherwise the body's own corners cut notches at both joins. */
  const capsule = showTrim && !roomy;
  const radius = capsule ? 0 : 5;

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
          ? "bg-accent border-accent"
          : "bg-bg-raised border-line-strong hover:border-ink-dimmer"
      }`}
      style={{ left: x0, width: w, top, height, borderRadius: radius, zIndex: selected ? 20 : 1 }}
      title={`${clip.name} · bar ${clip.bar}${clip.beat > 1 ? "." + clip.beat : ""} · ${clip.beats} beat${clip.beats === 1 ? "" : "s"} · double-click to zoom to it`}
    >
      <span
        className="absolute inset-0 flex items-center gap-[5px] px-[7px] pointer-events-none overflow-hidden"
        style={{ borderRadius: radius, opacity: selected ? 1 : 0.92 }}
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
            cap={capsule}
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
            cap={capsule}
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
  cap,
  onPointerDown,
}: {
  side: "start" | "end";
  width: number;
  out: number;
  cap: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const outer = side === "start" ? { left: -out } : { right: -out };
  const r = cap ? 5 : 3;
  return (
    <span
      onPointerDown={onPointerDown}
      title={side === "start" ? "Drag to change where it starts" : "Drag to change how long it lasts"}
      className="absolute top-0 bottom-0 flex items-center justify-center cursor-ew-resize"
      style={{
        ...outer,
        width,
        zIndex: 22,
        background: "var(--accent)",
        boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.28)",
        borderTopLeftRadius: side === "start" ? r : 0,
        borderBottomLeftRadius: side === "start" ? r : 0,
        borderTopRightRadius: side === "end" ? r : 0,
        borderBottomRightRadius: side === "end" ? r : 0,
      }}
    >
      <span
        aria-hidden
        style={{ width: 2, height: "42%", borderLeft: "1px solid rgba(0,0,0,0.5)", borderRight: "1px solid rgba(0,0,0,0.5)" }}
      />
    </span>
  );
}
