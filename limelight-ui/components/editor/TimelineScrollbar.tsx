"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { clamp } from "@/lib/grid";
import { clampView, MIN_SPAN_S } from "@/lib/timeline";
import type { View } from "@/lib/timeline";

/* Where you are in the song, and the handle that takes you somewhere else.
   Zoom and pan alone never said how much of the song was off screen or which
   way the rest of it lay — at a working zoom the editor is a porthole with no
   horizon. This is the horizon.

   It is NOT a native scrollbar, and it cannot be. The timeline's horizontal
   position is `view`, a window in seconds; the lanes, the ruler, the sections
   and the playhead are separate boxes that all read it. A real scroller would
   move one of those boxes and leave the rest behind — which is exactly the
   drift this replaced. So the bar is drawn from `view` and writes back to
   `view`, and everything moves together because there is still only one
   answer to where we are. */

/** Small enough to stay out of the way, big enough to hit without aiming.
 *  Exported because the inspector has to stop above it, and a second copy of
 *  this number is a card that thinks it clears something it does not. */
export const SCROLLBAR_H = 12;
/** A thumb thinner than this cannot be grabbed, however far you are zoomed in. */
const MIN_THUMB_PX = 28;
/** Slop around the thumb that still counts as grabbing it rather than paging. */
const GRAB_SLOP_PX = 3;

/** The thumb's geometry, and the two conversions that must agree about it.
 *
 *  The subtlety that makes a scrollbar either right or maddening: once the
 *  thumb has a MINIMUM width it is no longer `span/duration` of the track, so
 *  its travel is no longer `from/duration` of the track either. Both have to be
 *  measured against the same shortened runway — `trackW - thumbW` against
 *  `duration - span` — or the bar runs out before the song does and the last
 *  seconds cannot be reached. */
function geometry(view: View, duration: number, trackW: number) {
  const span = Math.max(1e-6, view.to - view.from);
  const total = Math.max(span, duration);
  const thumbW = clamp((span / total) * trackW, Math.min(MIN_THUMB_PX, trackW), trackW);
  const runway = Math.max(0, trackW - thumbW);
  const scrollable = Math.max(0, total - span);
  const x = scrollable === 0 ? 0 : (clamp(view.from, 0, scrollable) / scrollable) * runway;
  return { span, total, thumbW, runway, scrollable, x };
}

export function TimelineScrollbar({
  view,
  duration,
  onView,
  controls,
}: {
  view: View;
  duration: number;
  /** Always a whole window, never a delta: the bar knows where it is going. */
  onView: (v: View) => void;
  /** The id of the box this bar scrolls, for anything reading the page aloud. */
  controls: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [trackW, setTrackW] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setTrackW(e.contentRect.width));
    ro.observe(el);
    setTrackW(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const g = geometry(view, duration, trackW);
  /* Nothing is off screen, so there is nowhere to go. The bar stays — a control
     that vanishes when it is satisfied teaches nobody where it lives — but it
     stops offering a grab it could not honour. */
  const idle = g.scrollable <= 0 || trackW <= 0;

  /* The gesture reads the geometry ONCE, at the press. Everything it needs —
     how long the runway is, how much song is scrollable, how wide the window
     is — is fixed for the duration of a drag: the zoom cannot change while the
     pointer is down, and neither can the track. Only `from` moves, and the
     drag is the thing moving it. So there is no live value to chase and no ref
     to keep in step with the render. */
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = ref.current;
      if (!el || g.runway <= 0 || g.scrollable <= 0) return;
      /* The bar is a navigation control, not a place in the song: the press
         must not also reach the timeline underneath and drag the playhead. */
      e.preventDefault();
      e.stopPropagation();

      const box = el.getBoundingClientRect();
      const at = e.clientX - box.left;
      const { runway, scrollable, span, x } = g;

      /** Put the window where a thumb LEFT EDGE of `left` would put it. */
      const seekTo = (left: number) => {
        const from = (clamp(left, 0, runway) / runway) * scrollable;
        onView(clampView({ from, to: from + span }, duration, MIN_SPAN_S));
      };

      /* Grabbed the thumb: keep the point under the pointer under the pointer.
         Pressed the track: take the thumb to the press first — landing where
         you pointed is what a person expects, and it makes one gesture out of
         "go roughly there" and "now adjust". */
      const onThumb = at >= x - GRAB_SLOP_PX && at <= x + g.thumbW + GRAB_SLOP_PX;
      const grip = onThumb ? at - x : g.thumbW / 2;
      if (!onThumb) seekTo(at - grip);

      setDragging(true);

      const move = (ev: PointerEvent) => seekTo(ev.clientX - box.left - grip);
      const up = () => {
        setDragging(false);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [g, duration, onView],
  );

  const pct = g.total > 0 ? Math.round((view.from / g.total) * 100) : 0;

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      role="scrollbar"
      aria-orientation="horizontal"
      aria-label="Scroll the timeline through the song"
      aria-controls={controls}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      style={{ height: SCROLLBAR_H }}
      className={`relative flex-none border-t border-solid border-line bg-bg select-none touch-none ${
        idle ? "cursor-default" : "cursor-grab"
      } ${dragging ? "cursor-grabbing" : ""}`}
    >
      {trackW > 0 && (
        <span
          aria-hidden
          className="absolute top-[2px] bottom-[2px] rounded-full transition-colors duration-[var(--dur-state)]"
          style={{
            left: g.x,
            width: g.thumbW,
            background: idle
              ? "var(--line)"
              : dragging
                ? "var(--ink-dim)"
                : "var(--line-strong)",
          }}
        />
      )}
    </div>
  );
}
