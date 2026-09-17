"use client";

import { memo } from "react";

import { Clip, type Gesture } from "./Clip";
import type { Clip as ClipModel } from "@/lib/types";

/* A layer is a stacking row, not a category. Clips that overlap in time land on
   separate layers so nothing hides behind anything else — the same way a video
   editor spawns a track when you drop something on top of something.

   There is no header: layers are a consequence of what overlaps, not something
   anyone names, turns off or locks, so a 118px gutter repeating "LAYER 1/2/3"
   spent a sixth of the timeline's width saying nothing. The lanes now fill the
   timeline's box exactly, which is also the coordinate space clips are drawn in
   — so the pointer and the clips agree about what time it is. */

function LayerBase({
  clips,
  selection,
  height,
  onSelect,
  onGesture,
  onZoomTo,
}: {
  clips: ClipModel[];
  selection: string[];
  height: number;
  onSelect?: (key: string, additive: boolean) => void;
  onGesture?: (clip: ClipModel, mode: Gesture, e: React.PointerEvent) => void;
  onZoomTo?: (clip: ClipModel) => void;
}) {
  return (
    /* A lane clips its own clips. A clip runs from its start to its end whether
       or not the window is looking at both, so at any zoom there is a clip
       hanging off one side or the other — and an absolutely positioned child
       hanging off the side still counts as scrollable width to the lanes'
       scroller above. That handed the lanes a horizontal scroll position of
       their own, which is one more than the timeline has: the ruler, the
       sections and the playhead are drawn outside that box, so a scroller at 18
       meant every clip sat 18px earlier in the song than it said it did.
       Clipping here leaves nothing to scroll to, so there is nothing to be out
       of step with. */
    <div
      className="relative overflow-hidden border-b border-solid border-line"
      style={{ height }}
    >
      {clips.map((c) => (
        <Clip
          key={c.key}
          clip={c}
          selected={selection.includes(c.key)}
          top={2}
          height={height - 5}
          onSelect={onSelect}
          onGesture={onGesture}
          onZoomTo={onZoomTo}
        />
      ))}
    </div>
  );
}

/* Memoised. Same reasoning as Clip: a lane's contents do not change because the playhead moved.
 */
export const Layer = memo(LayerBase);
