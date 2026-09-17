"use client";

import { useCallback, useRef } from "react";

export interface Placed {
  key: string;
  type: string;
  at: [number, number, number];
}

/** Metres the plan shows, in the audience frame. */
const X_SPAN = 9;      // -9 .. +9 across
const Z_TOP = 7;       // 0 .. 7 up

const TINT: Record<string, string> = {
  par5: "#7FA6DC",
  par7: "#7FA6DC",
  wash12: "#8ED0C0",
  spot29: "#E7C978",
  head13: "#E7C978",
  blinder1: "#EDEDED",
  strobe3: "#C9C9F5",
  laser8: "#E48BB0",
  pixelbar24: "#9BD08E",
};

const SHORT: Record<string, string> = {
  par5: "PAR", par7: "PAR", wash12: "Wash", spot29: "Spot", head13: "Head",
  blinder1: "Blind", strobe3: "Strobe", laser8: "Laser", pixelbar24: "Bar",
};

/**
 * The rig as you would draw it on paper: looking at the stage from the room,
 * width across and height up. Drag a fixture to hang it somewhere else.
 *
 * Depth is not on this view. A front elevation is how a plot is read, and a
 * third axis on a flat drawing reads as a mistake; depth stays at whatever the
 * fixture was created with.
 */
export function RigPlan({
  fixtures,
  selected,
  onMove,
  onSelect,
}: {
  fixtures: Placed[];
  selected: string | null;
  onMove: (key: string, x: number, z: number) => void;
  onSelect: (key: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef<string | null>(null);

  const toMetres = useCallback((clientX: number, clientY: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return null;
    const fx = (clientX - r.left) / r.width;
    const fy = (clientY - r.top) / r.height;
    return {
      x: Math.max(-X_SPAN / 2, Math.min(X_SPAN / 2, (fx - 0.5) * X_SPAN)),
      z: Math.max(0, Math.min(Z_TOP, (1 - fy) * Z_TOP)),
    };
  }, []);

  const move = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const m = toMetres(e.clientX, e.clientY);
      if (m) onMove(dragging.current, Math.round(m.x * 20) / 20, Math.round(m.z * 20) / 20);
    },
    [toMetres, onMove],
  );

  /* Bars: fixtures hanging at the same height are on the same truss, which is
     what turns a scatter of dots into a plot you can read. */
  const bars = Object.values(
    fixtures.reduce<Record<string, { z: number; min: number; max: number }>>((acc, f) => {
      const k = f.at[2].toFixed(2);
      const b = acc[k] ?? { z: f.at[2], min: f.at[0], max: f.at[0] };
      b.min = Math.min(b.min, f.at[0]);
      b.max = Math.max(b.max, f.at[0]);
      acc[k] = b;
      return acc;
    }, {}),
  ).filter((b) => b.max > b.min);

  const pcx = (x: number) => ((x + X_SPAN / 2) / X_SPAN) * 100;
  const pcy = (z: number) => 100 - (z / Z_TOP) * 100;

  return (
    <div
      ref={ref}
      onPointerMove={move}
      onPointerUp={() => { dragging.current = null; }}
      onPointerLeave={() => { dragging.current = null; }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onSelect(null); }}
      className="liquid-well relative w-full aspect-[16/9] rounded-[var(--radius-md)] overflow-hidden select-none touch-none"
      style={{ background: "#05070C" }}
    >
      <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
        <defs>
          {fixtures.map((f) => (
            <linearGradient key={`g${f.key}`} id={`beam-${f.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={TINT[f.type] ?? "#9AA0B1"} stopOpacity="0.30" />
              <stop offset="1" stopColor={TINT[f.type] ?? "#9AA0B1"} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {/* metre grid, quiet */}
        {Array.from({ length: X_SPAN + 1 }).map((_, i) => (
          <line key={`v${i}`} x1={`${(i / X_SPAN) * 100}%`} y1="0" x2={`${(i / X_SPAN) * 100}%`} y2="100%"
            stroke="rgba(255,255,255,0.035)" strokeWidth="1" />
        ))}
        {Array.from({ length: Z_TOP + 1 }).map((_, i) => (
          <line key={`h${i}`} x1="0" y1={`${100 - (i / Z_TOP) * 100}%`} x2="100%" y2={`${100 - (i / Z_TOP) * 100}%`}
            stroke="rgba(255,255,255,0.035)" strokeWidth="1" />
        ))}

        {/* the beams, so the plan reads as light rather than as pins */}
        {fixtures.map((f) => {
          const x = pcx(f.at[0]);
          const y = pcy(f.at[2]);
          const spread = 3.4;
          return (
            <polygon
              key={`b${f.key}`}
              points={`${x},${y} ${x + spread},100 ${x - spread},100`}
              fill={`url(#beam-${f.key})`}
            />
          );
        })}

        {/* the steel */}
        {bars.map((b, i) => (
          <line
            key={`bar${i}`}
            x1={`${pcx(b.min) - 1.6}%`} y1={`${pcy(b.z)}%`}
            x2={`${pcx(b.max) + 1.6}%`} y2={`${pcy(b.z)}%`}
            stroke="rgba(190,200,220,0.30)" strokeWidth="3" strokeLinecap="round"
          />
        ))}

        {/* the deck */}
        <line x1="4%" y1="100%" x2="96%" y2="100%" stroke="rgba(255,255,255,0.22)" strokeWidth="2" />
      </svg>

      <span className="absolute left-[8px] bottom-[6px] mono text-[10px] text-ink-dimmer">Deck</span>
      <span className="absolute right-[8px] top-[6px] mono text-[10px] text-ink-dimmer">{Z_TOP} m</span>

      {fixtures.map((f) => {
        const on = selected === f.key;
        const tint = TINT[f.type] ?? "#9AA0B1";
        const mover = f.type === "spot29" || f.type === "head13" || f.type === "wash12";
        const bar = f.type === "pixelbar24";
        return (
          <button
            key={f.key}
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              dragging.current = f.key;
              onSelect(f.key);
            }}
            onPointerUp={() => { dragging.current = null; }}
            title={`${SHORT[f.type] ?? f.type} \u00b7 ${f.at[0].toFixed(2)} m across, ${f.at[2].toFixed(2)} m up`}
            className="absolute -translate-x-1/2 translate-y-1/2 border-0 bg-transparent p-0 cursor-grab active:cursor-grabbing"
            style={{ left: `${pcx(f.at[0])}%`, bottom: `${(f.at[2] / Z_TOP) * 100}%` }}
          >
            <span
              className="block"
              style={{
                width: bar ? 30 : mover ? 15 : 13,
                height: bar ? 6 : mover ? 15 : 13,
                borderRadius: bar ? 3 : mover ? 4 : "50%",
                background: tint,
                boxShadow: on
                  ? `0 0 0 2px #05070C, 0 0 0 4px ${tint}, 0 0 16px 1px ${tint}`
                  : `0 0 10px -1px ${tint}`,
              }}
            />
            {on && (
              <span className="absolute left-1/2 -translate-x-1/2 top-[-17px] mono text-[9px] text-ink whitespace-nowrap">
                {SHORT[f.type] ?? f.type}
              </span>
            )}
          </button>
        );
      })}

      {fixtures.length === 0 && (
        <span className="absolute inset-0 flex items-center justify-center text-[12px] text-ink-dimmer">
          Add fixtures and they appear here to place.
        </span>
      )}
    </div>
  );
}
