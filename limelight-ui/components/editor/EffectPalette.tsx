"use client";

import { useState, useMemo } from "react";
import Image from "next/image";
import { Search, GripVertical } from "lucide-react";
import { effectIcon } from "@/lib/effectIcons";
import { beginPaletteDrag, useDrag } from "@/store/drag";
import type { Effect } from "@/lib/types";

const FAMILIES: { id: string; label: string }[] = [
  { id: "all", label: "All" },
  { id: "movement", label: "Movement" },
  { id: "intensity", label: "Intensity" },
  { id: "colour", label: "Colour" },
  { id: "beam", label: "Beam" },
  { id: "utility", label: "Other" },
];

function familyOf(fx: Effect): string {
  if (fx.dimension === "place" || fx.dimension === "rate") return "movement";
  if (fx.dimension === "amount") return "intensity";
  if (fx.dimension === "colour") return "colour";
  const id = fx.id.toLowerCase();
  if (id.includes("strobe") || id.includes("flash") || id.includes("hit") || id.includes("blast") || id.includes("impact")) return "intensity";
  if (id.includes("chase") || id.includes("sweep") || id.includes("drive") || id.includes("pan") || id.includes("tilt")) return "movement";
  if (id.includes("wash") || id.includes("colour") || id.includes("hue") || id.includes("rainbow")) return "colour";
  if (id.includes("beam") || id.includes("gobo") || id.includes("prism") || id.includes("focus")) return "beam";
  return "utility";
}

export function EffectPalette({ effects }: { effects: Effect[] }) {
  const dragging = useDrag((s) => s.effect);
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState("all");

  const filtered = useMemo(() => {
    let list = effects;
    if (family !== "all") list = list.filter((fx) => familyOf(fx) === family);
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((fx) => fx.name.toLowerCase().includes(q) || fx.blurb.toLowerCase().includes(q) || fx.id.toLowerCase().includes(q));
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
      <div className="flex-none px-[10px] pt-[10px] pb-[6px]">
        <div className="relative">
          <Search size={12} className="absolute left-[8px] top-1/2 -translate-y-1/2 text-ink-dimmer pointer-events-none" />
          <input
            type="text"
            placeholder="Search effects…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full h-[28px] pl-[26px] pr-[8px] rounded-[var(--radius-sm)] border border-solid border-white/[0.06] bg-white/[0.03] text-[12px] text-ink outline-none focus:border-accent/50 focus:bg-white/[0.05] focus:shadow-[0_0_0_2px_rgba(255, 217, 163,0.08)] transition-all duration-200 placeholder:text-ink-dimmer"
          />
        </div>
      </div>

      <div className="flex-none flex gap-[2px] px-[8px] pb-[6px] overflow-x-auto scrollbar-none">
        {FAMILIES.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFamily(f.id)}
            className={`px-[7px] h-[22px] rounded-[6px] border-0 text-[10px] font-medium whitespace-nowrap cursor-pointer transition-all duration-200 ease-[var(--ease)] ${
              family === f.id
                ? "text-ink"
                : "bg-transparent text-ink-dimmer hover:text-ink-dim hover:bg-white/[0.04]"
            }`}
            style={family === f.id ? {
              background: "linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.04) 100%)",
              boxShadow: "0 1px 2px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.04)",
            } : undefined}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-[8px] pb-[12px]">
        {grouped.map(({ label, effects: groupFx }) => (
          <div key={label || "all"}>
            {label && (
              <p className="text-[9px] font-semibold tracking-[0.12em] text-ink-dimmer m-0 mt-[10px] mb-[4px] px-[6px]">
                {label}
              </p>
            )}
            <div className="flex flex-col gap-[1px]">
              {groupFx.map((fx) => {
                const active = dragging?.id === fx.id;
                return (
                  <button
                    key={fx.id}
                    type="button"
                    title={fx.blurb}
                    onPointerDown={(e) => beginPaletteDrag(fx, e)}
                    className={`group/fx flex items-center gap-[8px] px-[8px] py-[6px] rounded-[var(--radius-sm)] border border-solid cursor-grab active:cursor-grabbing touch-none transition-all duration-200 ease-[var(--ease)] text-left ${
                      active
                        ? "border-accent/30 scale-[1.02]"
                        : "border-transparent hover:border-white/[0.06] bg-transparent"
                    }`}
                    style={active
                      ? { background: "rgba(255, 217, 163,0.08)" }
                      : undefined
                    }
                    onMouseEnter={(e) => {
                      if (!active) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)";
                    }}
                    onMouseLeave={(e) => {
                      if (!active) (e.currentTarget as HTMLElement).style.background = "transparent";
                    }}
                  >
                    <GripVertical size={10} className="text-ink-dimmer/0 group-hover/fx:text-ink-dimmer/60 transition-opacity flex-none" />
                    <Image
                      src={effectIcon(fx)}
                      alt=""
                      width={16}
                      height={16}
                      className="flex-none"
                      style={{ opacity: active ? 1 : 0.7 }}
                    />
                    <div className="min-w-0 flex-1">
                      <span className="block text-[12px] text-ink truncate leading-[16px]">{fx.name}</span>
                      <span className="block text-[10px] text-ink-dimmer truncate leading-[13px]">{fx.blurb}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="flex flex-col items-center py-[24px]">
            <Search size={16} className="text-ink-dimmer/30 mb-[6px]" />
            <p className="text-[11px] text-ink-dimmer m-0">No effects match</p>
          </div>
        )}
      </div>
    </div>
  );
}
