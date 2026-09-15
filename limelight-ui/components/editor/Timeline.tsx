"use client";

import { useEffect, useRef, useState, createContext, useContext } from "react";
import type { View } from "@/lib/timeline";

interface TimelineCtx {
  view: View;
  width: number;
  duration: number;
}

const Ctx = createContext<TimelineCtx | null>(null);

export function useTimeline(): TimelineCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTimeline must be used inside <Timeline>");
  return c;
}

/** Height of the ruler strip, in px. Scrubbing is confined to it so a plain
 *  drag lower down stays free for selecting and moving clips. */
const RULER_H = 22;

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
  /** Fired on a press that did not land on a clip. */
  onBackground?: (clientX: number) => void;
  onZoom?: (anchorT: number, factor: number) => void;
  onPan?: (dt: number) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const scrub = (e: React.PointerEvent) => {
    /* Clips stop propagation, so reaching here means the press landed on empty
       timeline — which is how you let go of a selection. */
    onBackground?.(e.clientX);
    if (!onScrub || width === 0) return;
    const box = ref.current?.getBoundingClientRect();
    if (!box || e.clientY - box.top > RULER_H) return;
    const at = (cx: number) =>
      onScrub(view.from + ((cx - box.left) / width) * (view.to - view.from));
    at(e.clientX);
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
    if (!el || width === 0) return;
    const onWheel = (e: WheelEvent) => {
      const box = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        if (!onZoom) return;
        e.preventDefault();
        const anchorT = view.from + ((e.clientX - box.left) / width) * (view.to - view.from);
        onZoom(anchorT, e.deltaY > 0 ? 1.15 : 0.87);
      } else if (onPan && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        onPan((e.deltaX / width) * (view.to - view.from));
      }
    };
    /* Not passive: zooming must be able to cancel the browser's page zoom. */
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [view, width, onZoom, onPan]);

  return (
    <div
      ref={ref}
      onPointerDown={scrub}
      className="relative w-full h-full overflow-hidden select-none"
    >
      {width > 0 && <Ctx.Provider value={{ view, width, duration }}>{children}</Ctx.Provider>}
    </div>
  );
}
