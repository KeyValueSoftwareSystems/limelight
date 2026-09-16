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
   *  press — an armed tile does, because that press is a placement, not a seek. */
  onBackground?: (clientX: number) => boolean | void;
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
    if (onBackground?.(e.clientX)) return;
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

  /* Ctrl/Cmd-scroll zooms about the cursor; a plain horizontal scroll pans.
     Both continuous — four fixed zoom steps made close work impossible. */
  useEffect(() => {
    const el = ref.current;
    if (!el || box.width === 0) return;
    const onWheel = (e: WheelEvent) => {
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        if (!onZoom) return;
        e.preventDefault();
        const anchorT = view.from + ((e.clientX - r.left) / box.width) * (view.to - view.from);
        onZoom(anchorT, e.deltaY > 0 ? 1.15 : 0.87);
      } else if (onPan && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        onPan((e.deltaX / box.width) * (view.to - view.from));
      }
    };
    /* Not passive: zooming must be able to cancel the browser's page zoom. */
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
