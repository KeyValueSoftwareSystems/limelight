"use client";

import { useState, useMemo } from "react";
import Image from "next/image";
import { effectIcon } from "@/lib/effectIcons";
import { beginPaletteDrag, useDrag } from "@/store/drag";
import type { Effect } from "@/lib/types";

const FAMILIES: { id: string; label: string }[] = [
  { id: "all", label: "All" },
  { id: "movement", label: "Movement" },
  { id: "intensity", label: "Intensity" },
  { id: "colour", label: "Colour" },
  { id: "beam", label: "Beam" },
  { id: "utility", label: "Utility" },
];

function familyOf(fx: Effect): string {
  if (fx.dimension === "place" || fx.dimension === "rate") return "movement";
  if (fx.dimension === "amount") return "intensity";
  if (fx.dimension === "colour") return "colour";
  const id = fx.id.toLowerCase();
  if (id.includes("strobe") || id.includes("flash") || id.includes("hit") || id.includes("blast")) return "intensity";
  if (id.includes("chase") || id.includes("sweep") || id.includes("drive") || id.includes("pan")) return "movement";
  if (id.includes("wash") || id.includes("colour") || id.includes("hue")) return "colour";
  if (id.includes("beam") || id.includes("gobo") || id.includes("prism")) return "beam";
  return "utility";
}

export function EffectPalette({ effects }: { effects: Effect[] }) {
  const dragging = useDrag((s) => s.effect);
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState("all");

  const filtered = useMemo(() => {
    let list = effects;
    if (family !== "all") {
      list = list.filter((fx) => familyOf(fx) === family);
    }
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(
        (fx) =>
          fx.name.toLowerCase().includes(q) ||
          fx.blurb.toLowerCase().includes(q) ||
          fx.id.toLowerCase().includes(q),
      );
    }
    return list;
  }, [effects, query, family]);

  const grouped = useMemo(() => {
    if (family !== "all") return [{ label: "", effects: filtered }];
    const map = new Map<string, Effect[]>();
    for (const fx of filtered) {
      const f = familyOf(fx);
      const label = FAMILIES.find((fam) => fam.id === f)?.label ?? "Other";
      const arr = map.get(label) || [];
      arr.push(fx);
      map.set(label, arr);
    }
    return Array.from(map.entries()).map(([label, effects]) => ({ label, effects }));
  }, [filtered, family]);

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex-none px-[12px] pt-[10px] pb-[8px]">
        <div className="relative">
          <svg className="absolute left-[8px] top-1/2 -translate-y-1/2 text-ink-dimmer pointer-events-none" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="7" cy="7" r="5" />
            <path d="M11 11l3.5 3.5" />
          </svg>
          <input
            type="text"
            placeholder="Search effects…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full h-[28px] pl-[26px] pr-[8px] rounded-[5px] border border-solid border-line bg-bg-sunken text-[12px] text-ink outline-none focus:border-accent placeholder:text-ink-dimmer"
          />
        </div>
      </div>

      <div className="flex-none flex gap-[2px] px-[10px] pb-[6px] overflow-x-auto">
        {FAMILIES.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFamily(f.id)}
            className={`px-[8px] h-[22px] rounded-[4px] border-0 text-[10px] tracking-[0.04em] whitespace-nowrap cursor-pointer transition-colors duration-[var(--dur-state)] ${
              family === f.id
                ? "bg-bg-overlay text-ink font-medium"
                : "bg-transparent text-ink-dimmer hover:text-ink-dim"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-[10px] pb-[12px]">
        {grouped.map(({ label, effects: groupFx }) => (
          <div key={label || "all"}>
            {label && (
              <p className="text-[10px] tracking-[0.1em] uppercase text-ink-dimmer m-0 mt-[10px] mb-[4px] px-[4px]">
                {label}
              </p>
            )}
            <div className="flex flex-col gap-[2px]">
              {groupFx.map((fx) => {
                const active = dragging?.id === fx.id;
                return (
                  <button
                    key={fx.id}
                    type="button"
                    title={fx.blurb}
                    onPointerDown={(e) => beginPaletteDrag(fx, e)}
                    className={`flex items-center gap-[8px] px-[8px] py-[6px] rounded-[5px] border border-solid bg-transparent cursor-grab active:cursor-grabbing touch-none transition-colors duration-[var(--dur-state)] text-left ${
                      active
                        ? "border-accent bg-accent-soft"
                        : "border-transparent hover:border-line hover:bg-bg-raised"
                    }`}
                  >
                    <Image
                      src={effectIcon(fx)}
                      alt=""
                      width={16}
                      height={16}
                      className="flex-none"
                      style={{ opacity: active ? 1 : 0.8 }}
                    />
                    <div className="min-w-0 flex-1">
                      <span className="block text-[12px] text-ink truncate">{fx.name}</span>
                      <span className="block text-[10px] text-ink-dimmer truncate leading-[14px]">{fx.blurb}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="text-[11px] text-ink-dimmer text-center py-[20px] m-0">
            No effects match
          </p>
        )}
      </div>
    </div>
  );
}
