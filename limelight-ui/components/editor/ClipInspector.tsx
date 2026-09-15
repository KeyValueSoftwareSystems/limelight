"use client";

import Image from "next/image";
import { useState } from "react";
import { effectIcon } from "@/lib/effectIcons";
import type { Clip, Effect } from "@/lib/types";

/* The popover that appears on the selected clip. Its controls come from the
   effect's own dials, so a clip only offers what the renderer will actually
   read — an Impact has no `amount`, and pretending otherwise would give a
   creator a slider that changes nothing. */

const SWATCHES: { name: string; rgb: [number, number, number]; css: string }[] = [
  { name: "Warm", rgb: [1, 0.64, 0.24], css: "#e8a33d" },
  { name: "White", rgb: [1, 1, 1], css: "#f2f4f8" },
  { name: "Blue", rgb: [0.2, 0.4, 1], css: "#3366ff" },
  { name: "Magenta", rgb: [1, 0.2, 0.8], css: "#ff33cc" },
  { name: "Cyan", rgb: [0.2, 0.85, 0.9], css: "#33d9e6" },
];

function sameColour(a: unknown, b: [number, number, number]) {
  return Array.isArray(a) && a.length === 3 && a.every((v, i) => Math.abs(Number(v) - b[i]) < 0.02);
}

export function ClipInspector({
  clip,
  effect,
  x,
  y,
  onChange,
  onRemove,
}: {
  clip: Clip;
  effect: Effect | undefined;
  x: number;
  y: number;
  onChange: (patch: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const dials = effect?.dials ?? {};
  const amount = dials.amount;
  const hasColour = "colour" in dials;

  const current = Number(clip.params.amount ?? amount?.default ?? 0.8);
  const min = amount?.min ?? 0;
  const max = amount?.max ?? 1;

  return (
    <div
      data-clip-inspector
      className="absolute z-40 w-[248px] rounded-[8px] border border-solid border-line-strong bg-bg-overlay p-[var(--spacing-s3)] shadow-lg"
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-start gap-[8px]">
        <Image src={effectIcon({ id: clip.tile ?? clip.fx })} alt="" width={18} height={18} className="mt-[1px] flex-none" />
        <div className="flex-1 min-w-0">
          <div className="text-[14px] text-ink leading-[17px]">{clip.name}</div>
        </div>
        <div className="relative flex-none">
          <button
            type="button"
            onClick={() => setMenu((m) => !m)}
            aria-label="Clip actions"
            aria-expanded={menu}
            className="w-[22px] h-[22px] rounded bg-transparent border-0 cursor-pointer text-ink-dim hover:text-ink text-[14px] leading-none"
          >
            <span aria-hidden>…</span>
          </button>
          {menu && (
            <div className="absolute right-0 top-[24px] z-10 min-w-[128px] py-[3px] rounded-[6px] border border-solid border-line-strong bg-bg-overlay">
              <button
                type="button"
                onClick={onRemove}
                className="block w-full text-left px-[10px] py-[6px] bg-transparent border-0 cursor-pointer text-[11px] text-danger hover:bg-danger/15"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-ink-dim leading-[16px] mt-[8px]">
        {effect?.blurb ?? `bar ${clip.bar}${clip.beat > 1 ? "·" + clip.beat : ""} · ${clip.beats} beats`}
      </p>

      {amount ? (
        <div className="mt-[12px]">
          <div className="flex items-center gap-[10px]">
            <span className="text-[11px] text-ink-dim flex-none w-[52px]">Intensity</span>
            <input
              type="range"
              min={Math.round(min * 100)}
              max={Math.round(max * 100)}
              value={Math.round(current * 100)}
              onChange={(e) => onChange({ amount: Number(e.target.value) / 100 })}
              className="flex-1 min-w-0"
              style={{ accentColor: "var(--accent)" }}
            />
            <span className="mono text-[11px] text-ink flex-none w-[34px] text-right">
              {Math.round(current * 100)}%
            </span>
          </div>
        </div>
      ) : (
        <p className="text-[10px] text-ink-dimmer mt-[12px]">
          This effect has no intensity of its own.
        </p>
      )}

      {hasColour && (
        <div className="mt-[12px]">
          <span className="text-[11px] text-ink-dim">Colour</span>
          <div className="flex gap-[9px] mt-[7px]">
            {SWATCHES.map((s) => {
              const on = sameColour(clip.params.colour ?? dials.colour?.default, s.rgb);
              return (
                <button
                  key={s.name}
                  type="button"
                  title={s.name}
                  onClick={() => onChange({ colour: s.rgb })}
                  className="w-[18px] h-[18px] rounded-full border-2 border-solid cursor-pointer transition-transform duration-[var(--dur-state)]"
                  style={{
                    background: s.css,
                    borderColor: on ? "var(--accent)" : "transparent",
                    transform: on ? "scale(1.1)" : undefined,
                  }}
                >
                  <span className="sr-only">{s.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}
