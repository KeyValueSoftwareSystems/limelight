"use client";

import { useEffect, useRef, useState, createContext, useContext } from "react";
import { clamp } from "@/lib/grid";
import type { View } from "@/lib/timeline";

interface TimelineCtx {
  view: View;
  width: number;
  /** The box's own height, so anything floating over it can stay inside it. */
  height: number;
  duration: number;
}

const Ctx = createContext<TimelineCtx | null>(null);

export function useTimeline(): TimelineCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTimeline must be used inside <Timeline>");
  return c;
}

/** A wheel notch reported in LINES rather than pixels — Firefox does this on
 *  some platforms, and a delta of 3 across a 1000px editor is indistinguishable
 *  from the gesture not working. Pages (deltaMode 2) are rarer still, and are a
 *  screenful by definition. */
const LINE_PX = 16;

function wheelPx(delta: number, mode: number, pagePx: number): number {
  if (mode === 1) return delta * LINE_PX;
  if (mode === 2) return delta * pagePx;
  return delta;
}

/** Owns the one time→pixel mapping every band shares. If a band computed its
 *  own, the picture would drift out of agreement with itself. */
export function Timeline({
  view,
  duration,
  onScrub,
  onBackground,
  onZoom,
  onPan,
  children,
}: {
  view: View;
  duration: number;
  onScrub?: (t: number) => void;
  /** Fired on a press that did not land on a clip. Return true to CLAIM that
   *  press — an armed tile does, because that press is a placement, not a seek.
   *  It gets the y as well as the x: a placement needs a LANE, and the lane is
   *  the only thing that says which of two overlapping effects will play. */
  onBackground?: (clientX: number, clientY: number) => boolean | void;
  onZoom?: (anchorT: number, factor: number) => void;
  onPan?: (dt: number) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setBox({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setBox({ width: r.width, height: r.height });
    return () => ro.disconnect();
  }, []);

  /* Scrubbing is the WHOLE timeline, not a 22px strip at the top of it.
     Confining it to the ruler meant the one gesture everybody tries first —
     click where you want to hear — did nothing over nine tenths of the surface,
     and the only way to find that out was to try it. Clips stop propagation, so
     reaching here already means the press landed on empty timeline: there is
     nothing under it for a seek to take away. */
  const scrub = (e: React.PointerEvent) => {
    if (onBackground?.(e.clientX, e.clientY)) return;
    if (!onScrub || box.width === 0) return;
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const at = (cx: number) =>
      onScrub(view.from + ((clamp(cx, r.left, r.right) - r.left) / box.width) * (view.to - view.from));
    at(e.clientX);
    /* Held down, it drags — the same gesture whether it started on the ruler or
       halfway down a lane. */
    const move = (ev: PointerEvent) => at(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /* Ctrl/Cmd-scroll zooms about the cursor; shift-scroll and a horizontal
     trackpad swipe pan. Both continuous — four fixed zoom steps made close work
     impossible. A plain vertical scroll is left alone, so it still scrolls the
     lanes underneath. */
  useEffect(() => {
    const el = ref.current;
    if (!el || box.width === 0) return;
    const onWheel = (e: WheelEvent) => {
      const r = el.getBoundingClientRect();
      const span = view.to - view.from;
      const px = (d: number) => wheelPx(d, e.deltaMode, box.width);

      const wantsZoom =
        e.ctrlKey ||
        e.metaKey ||
        (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX));

      if (wantsZoom) {
        if (!onZoom) return;
        e.preventDefault();
        const anchorT = view.from + ((e.clientX - r.left) / box.width) * span;
        const step = Math.min(2.5, 1 + Math.abs(px(e.deltaY)) / 320);
        onZoom(anchorT, e.deltaY > 0 ? step : 1 / step);
        return;
      }
      if (!onPan) return;

      /* Shift-scroll is the web's horizontal scroll, but the browser only does
         it for a REAL scroller — and this is deliberately not one. Where the
         timeline is in the song is `view`, not a scrollLeft, so there was
         nothing for the browser to scroll and the gesture did nothing at all.

         Which axis the delta arrives on is not agreed between platforms
         either: some browsers swap shift-scroll onto deltaX for you, others
         leave it on deltaY and only set shiftKey. Take whichever is moving
         rather than betting on one. */
      const dx = e.shiftKey
        ? (e.deltaX || e.deltaY)
        : Math.abs(e.deltaX) > Math.abs(e.deltaY)
          ? e.deltaX
          : 0;
      if (!dx) return;
      e.preventDefault();
      onPan((px(dx) / box.width) * span);
    };
    /* Not passive: zooming must be able to cancel the browser's page zoom, and
       panning must be able to cancel its back-swipe. */
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [view, box.width, onZoom, onPan]);

  return (
    <div
      ref={ref}
      onPointerDown={scrub}
      className="relative w-full h-full overflow-hidden select-none"
    >
      {box.width > 0 && (
        <Ctx.Provider value={{ view, width: box.width, height: box.height, duration }}>
          {children}
        </Ctx.Provider>
      )}
    </div>
  );
}
