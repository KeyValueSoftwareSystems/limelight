"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { demoStates } from "@/lib/rigdemo";
import { paintStage, ground } from "@/lib/renderer";
import { placeFixtures, unplaceFixture, roomBounds } from "@/lib/fixtures";
import type { Fixture, Room } from "@/lib/types";

export interface Placed {
  key: string;
  type: string;
  at: [number, number, number];
}

const SHORT: Record<string, string> = {
  par5: "PAR", par7: "PAR", wash12: "Wash", spot29: "Spot", head13: "Head",
  blinder1: "Blind", strobe3: "Strobe", laser8: "Laser", pixelbar24: "Bar",
};

export function StagePlan({
  placed,
  room,
  selected,
  onMove,
  onSelect,
  geometry = "line",
}: {
  placed: Placed[];
  room: Room;
  selected: string | null;
  onMove: (key: string, x: number, height: number) => void;
  onSelect: (key: string | null) => void;
  geometry?: string | null;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const dprRef = useRef(1);
  const dragRef = useRef<{ key: string; depth: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const bounds = useMemo(() => roomBounds(room), [room]);

  const fixtures: Fixture[] = useMemo(
    () => placed.map((f, i) => ({
      id: f.key,
      type: f.type,
      at: f.at,
      universe: 0,
      address: i + 1,
    } as Fixture)),
    [placed],
  );

  const lamps = useMemo(
    () => placeFixtures({ fixtures, geometry, room } as never, bounds).lamps,
    [fixtures, geometry, room, bounds],
  );

  const paint = useCallback((t: number) => {
    const cv = canvasRef.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const dpr = dprRef.current;
    const W = cv.width / dpr;
    const H = cv.height / dpr;
    if (!fixtures.length) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ground(ctx, W, H);
      return;
    }
    paintStage(ctx, demoStates(fixtures, t, geometry, bounds) as never, W, H, dpr, { t, quality: "card" });
  }, [fixtures, geometry, bounds]);

  const size = useCallback(() => {
    const cv = canvasRef.current;
    const box = boxRef.current;
    if (!cv || !box) return;
    const r = box.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    dprRef.current = dpr;
    cv.width = Math.max(1, Math.round(r.width * dpr));
    cv.height = Math.max(1, Math.round(r.height * dpr));
  }, []);

  useEffect(() => {
    size();
    const ro = new ResizeObserver(() => { size(); paint(performance.now() / 1000); });
    if (boxRef.current) ro.observe(boxRef.current);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      paint(2.0);
    } else {
      const loop = () => { paint(performance.now() / 1000); rafRef.current = requestAnimationFrame(loop); };
      rafRef.current = requestAnimationFrame(loop);
    }
    return () => {
      ro.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [paint, size]);

  const drop = useCallback(
    (clientX: number, clientY: number) => {
      const d = dragRef.current;
      const r = boxRef.current?.getBoundingClientRect();
      if (!d || !r || !bounds) return;
      const world = unplaceFixture(
        { x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height },
        d.depth,
        bounds,
        geometry,
      );
      const half = room.width / 2;
      onMove(
        d.key,
        Math.round(Math.max(-half, Math.min(half, world.x)) * 20) / 20,
        Math.round(Math.max(0, Math.min(room.height, world.height)) * 20) / 20,
      );
    },
    [bounds, geometry, onMove, room.width, room.height],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => { if (dragRef.current) drop(e.clientX, e.clientY); },
    [drop],
  );

  const end = useCallback(() => { dragRef.current = null; setDragging(null); }, []);

  return (
    <div
      ref={boxRef}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onSelect(null); }}
      className="relative w-full rounded-[var(--radius-md)] overflow-hidden select-none"
      style={{ aspectRatio: "16 / 9", background: "#05070C", touchAction: "none" }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />

      {!placed.length && (
        <div className="absolute inset-0 flex items-center justify-center text-[12.5px] text-ink-dimmer pointer-events-none">
          Add a fixture and it lands on the rig.
        </div>
      )}

      {lamps.map((l) => {
        const on = l.id === selected;
        const held = l.id === dragging;
        return (
          <button
            key={l.id}
            type="button"
            title={`${SHORT[l.type] ?? l.type} — drag to hang it somewhere else`}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              (e.currentTarget.parentElement as HTMLElement)?.setPointerCapture?.(e.pointerId);
              dragRef.current = { key: l.id, depth: l.depth };
              setDragging(l.id);
              onSelect(l.id);
            }}
            className="absolute border-0 bg-transparent p-0"
            style={{
              left: `${l.x * 100}%`,
              top: `${l.y * 100}%`,
              transform: "translate(-50%, -50%)",
              cursor: held ? "grabbing" : "grab",
              zIndex: on || held ? 3 : 2,
            }}
          >
            <span
              className="block rounded-full transition-[width,height,box-shadow] duration-150"
              style={{
                width: on || held ? 20 : 15,
                height: on || held ? 20 : 15,
                border: `1.5px solid ${on || held ? "var(--accent)" : "rgba(238,242,250,0.55)"}`,
                background: on || held ? "rgba(110,151,206,0.28)" : "rgba(8,11,18,0.35)",
                boxShadow: on || held ? "0 0 0 3px rgba(110,151,206,0.22)" : "none",
              }}
            />
          </button>
        );
      })}

      <span className="absolute left-[10px] bottom-[8px] mono text-[10.5px] text-ink-dimmer tabular-nums pointer-events-none">
        {room.width.toFixed(1)} m across · {room.height.toFixed(1)} m to the grid
      </span>
    </div>
  );
}
