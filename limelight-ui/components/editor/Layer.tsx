"use client";

import { Clip, type Gesture } from "./Clip";
import type { Clip as ClipModel } from "@/lib/types";

/* A layer is a stacking row, not a category. Clips that overlap in time land on
   separate layers so nothing hides behind anything else — the same way a video
   editor spawns a track when you drop something on top of something. */
export function Layer({
  index,
  clips,
  selection,
  height,
  hidden,
  locked,
  onToggleHidden,
  onToggleLocked,
  onAdd,
  onSelect,
  onGesture,
  onZoomTo,
}: {
  index: number;
  clips: ClipModel[];
  selection: string[];
  height: number;
  hidden: boolean;
  locked: boolean;
  onToggleHidden: () => void;
  onToggleLocked: () => void;
  onAdd: () => void;
  onSelect?: (key: string, additive: boolean) => void;
  onGesture?: (clip: ClipModel, mode: Gesture, e: React.PointerEvent) => void;
  onZoomTo?: (clip: ClipModel) => void;
}) {
  const ctl =
    "w-[16px] h-[16px] inline-flex items-center justify-center bg-transparent border-0 cursor-pointer " +
    "text-ink-dimmer hover:text-ink transition-colors duration-[var(--dur-state)] text-[11px] leading-none";

  return (
    <div className="flex border-b border-solid border-line" style={{ opacity: hidden ? 0.35 : 1 }}>
      <div
        className="flex-none w-[118px] flex items-center gap-[4px] px-[9px] border-r border-solid border-line"
        style={{ height }}
      >
        <span className="text-[10px] tracking-[0.1em] text-ink-dim flex-1">LAYER {index + 1}</span>
        <button type="button" onClick={onToggleHidden} className={ctl} aria-pressed={hidden}
          title={hidden ? "Show this layer" : "Hide this layer"}>
          <span aria-hidden>{hidden ? "◌" : "◉"}</span>
          <span className="sr-only">{hidden ? "Show layer" : "Hide layer"}</span>
        </button>
        <button type="button" onClick={onToggleLocked} className={ctl} aria-pressed={locked}
          title={locked ? "Unlock this layer" : "Lock this layer"}>
          <span aria-hidden>{locked ? "▣" : "▢"}</span>
          <span className="sr-only">{locked ? "Unlock layer" : "Lock layer"}</span>
        </button>
        <button type="button" onClick={onAdd} className={ctl} title="Add an effect to this layer">
          <span aria-hidden>+</span>
          <span className="sr-only">Add an effect</span>
        </button>
      </div>

      <div className="relative flex-1 min-w-0" style={{ height }}>
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
    </div>
  );
}
