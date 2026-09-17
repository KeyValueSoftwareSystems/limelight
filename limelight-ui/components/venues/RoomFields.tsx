"use client";

import type { Room } from "@/lib/types";

export const DEFAULT_ROOM: Room = { width: 14, depth: 6, height: 7 };

const DIMS: Array<{ key: keyof Room; label: string; min: number; max: number }> = [
  { key: "width", label: "Across", min: 3, max: 40 },
  { key: "height", label: "To the grid", min: 2, max: 18 },
  { key: "depth", label: "Deep", min: 1, max: 25 },
];

export function RoomFields({
  room,
  onChange,
}: {
  room: Room;
  onChange: (room: Room) => void;
}) {
  return (
    <div className="flex items-end gap-[10px] flex-wrap">
      {DIMS.map((d) => (
        <label key={d.key} className="flex flex-col gap-[5px] min-w-0">
          <span className="text-[10.5px] font-medium text-ink-dimmer">{d.label}</span>
          <span className="liquid-well flex items-center gap-[5px] h-[30px] px-[9px] rounded-[var(--radius-sm)]">
            <input
              type="number"
              inputMode="decimal"
              min={d.min}
              max={d.max}
              step={0.5}
              value={room[d.key]}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isFinite(v)) return;
                onChange({ ...room, [d.key]: Math.max(d.min, Math.min(d.max, v)) });
              }}
              className="mono w-[42px] bg-transparent border-0 outline-none text-[12.5px] tabular-nums text-ink p-0"
            />
            <span className="text-[10.5px] text-ink-dimmer">m</span>
          </span>
        </label>
      ))}
    </div>
  );
}
