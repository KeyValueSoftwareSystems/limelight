"use client";

import { Clip, type Gesture } from "./Clip";
import type { Clip as ClipModel } from "@/lib/types";

/* A layer is a stacking row, not a category. Clips that overlap in time land on
   separate layers so nothing hides behind anything else — the same way a video
   editor spawns a track when you drop something on top of something.

   The header and the lane are two components on purpose. The header lives in a
   gutter OUTSIDE the timeline's coordinate space; the lane fills that space
   exactly. When the header sat inside the lane, every clip was drawn 118px to
   the right of the ruler and scaled for a box 118px wider than it lived in, so
   the pointer and the clips disagreed about what time it was. */

export const LAYER_HEADER_W = 118;

/* 22px is the largest control that fits the shortest lane (ROW_MIN is 26), and
   it matches the icon buttons elsewhere in the editor. The glyph characters
   these replaced were 16px and read as text, not as controls. */
const CTL =
  "w-[22px] h-[22px] flex-none inline-flex items-center justify-center rounded-[5px] " +
  "bg-transparent border-0 cursor-pointer text-ink-dimmer hover:text-ink hover:bg-bg-raised " +
  "transition-colors duration-[var(--dur-state)]";

function Icon({ d }: { d: string[] }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {d.map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}

const EYE_OPEN = ["M2.5 10S5.6 5.6 10 5.6 17.5 10 17.5 10 14.4 14.4 10 14.4 2.5 10 2.5 10Z", "M12.2 10a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0Z"];
const EYE_SHUT = ["M3 8.4c1.6 2 4 3.4 7 3.4s5.4-1.4 7-3.4", "M6.1 11.2 4.9 13.1", "M10 11.9v2.2", "M13.9 11.2l1.2 1.9"];
const LOCK_SHUT = ["M5.6 9.2h8.8v6.2H5.6z", "M7.7 9.2V7.1a2.3 2.3 0 0 1 4.6 0v2.1"];
const LOCK_OPEN = ["M5.6 9.2h8.8v6.2H5.6z", "M7.7 9.2V7.1a2.3 2.3 0 0 1 4.5-.5"];

export function LayerHeader({
  index,
  height,
  hidden,
  locked,
  onToggleHidden,
  onToggleLocked,
}: {
  index: number;
  height: number;
  hidden: boolean;
  locked: boolean;
  onToggleHidden: () => void;
  onToggleLocked: () => void;
}) {
  return (
    <div
      className="flex-none flex items-center gap-[2px] px-[9px] border-b border-solid border-line"
      style={{ height, opacity: hidden ? 0.35 : 1 }}
    >
      <span className="text-[10px] tracking-[0.1em] text-ink-dim flex-1 min-w-0 truncate">
        LAYER {index + 1}
      </span>
      <button
        type="button"
        onClick={onToggleHidden}
        className={CTL}
        aria-pressed={hidden}
        title={hidden ? "Show this layer" : "Hide this layer"}
      >
        <Icon d={hidden ? EYE_SHUT : EYE_OPEN} />
        <span className="sr-only">{hidden ? "Show layer" : "Hide layer"}</span>
      </button>
      <button
        type="button"
        onClick={onToggleLocked}
        className={CTL}
        aria-pressed={locked}
        title={locked ? "Unlock this layer" : "Lock this layer"}
      >
        <Icon d={locked ? LOCK_SHUT : LOCK_OPEN} />
        <span className="sr-only">{locked ? "Unlock layer" : "Lock layer"}</span>
      </button>
    </div>
  );
}

export function Layer({
  clips,
  selection,
  height,
  hidden,
  locked,
  onSelect,
  onGesture,
  onZoomTo,
}: {
  clips: ClipModel[];
  selection: string[];
  height: number;
  hidden: boolean;
  locked: boolean;
  onSelect?: (key: string, additive: boolean) => void;
  onGesture?: (clip: ClipModel, mode: Gesture, e: React.PointerEvent) => void;
  onZoomTo?: (clip: ClipModel) => void;
}) {
  return (
    <div
      className="relative border-b border-solid border-line"
      style={{ height, opacity: hidden ? 0.35 : 1 }}
    >
      {clips.map((c) => (
        <Clip
          key={c.key}
          clip={c}
          selected={selection.includes(c.key)}
          top={2}
          height={height - 5}
          onSelect={onSelect}
          onGesture={locked ? undefined : onGesture}
          onZoomTo={onZoomTo}
        />
      ))}
    </div>
  );
}
