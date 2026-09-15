"use client";

import Image from "next/image";
import { useState } from "react";
import { effectIcon } from "@/lib/effectIcons";
import { beginPaletteDrag, useDrag } from "@/store/drag";
import type { Effect } from "@/lib/types";

/* Plain tiles: a drawn icon and a name. No per-effect colour — in this editor
   colour means selection, and spending it on decoration would make the one clip
   you are working on no louder than the seventeen you are not. */
export function EffectPalette({ effects }: { effects: Effect[] }) {
  const dragging = useDrag((s) => s.effect);
  const [tab, setTab] = useState<"effects" | "styles">("effects");

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex-none flex gap-[var(--spacing-s4)] px-[var(--spacing-s4)] pt-[var(--spacing-s3)] border-b border-solid border-line">
        {(["effects", "styles"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`pb-[7px] bg-transparent border-0 border-b-2 border-solid cursor-pointer text-[11px] tracking-[0.14em] uppercase transition-colors duration-[var(--dur-state)] ${
              tab === t ? "text-ink border-b-accent" : "text-ink-dimmer border-b-transparent hover:text-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "effects" ? (
        <div className="flex-1 min-h-0 overflow-y-auto p-[var(--spacing-s3)]">
          <div className="grid grid-cols-5 gap-[6px]">
            {effects.map((fx) => {
              const active = dragging?.id === fx.id;
              return (
                <button
                  key={fx.id}
                  type="button"
                  title={fx.blurb}
                  onPointerDown={(e) => beginPaletteDrag(fx, e)}
                  className={`flex flex-col items-center gap-[5px] px-[2px] py-[9px] rounded-[6px] border border-solid bg-transparent cursor-grab active:cursor-grabbing touch-none transition-colors duration-[var(--dur-state)] ${
                    active
                      ? "border-accent bg-accent-soft"
                      : "border-line hover:border-line-strong hover:bg-bg-raised"
                  }`}
                >
                  <Image
                    src={effectIcon(fx)}
                    alt=""
                    width={22}
                    height={22}
                    className="pointer-events-none"
                    style={{ opacity: active ? 1 : 0.85 }}
                  />
                  <span className="text-[9px] text-ink-dim leading-[11px] truncate max-w-full">
                    {fx.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex items-center justify-center px-[var(--spacing-s4)] text-center">
          <p className="text-[11px] text-ink-dimmer">
            Styles aren&apos;t wired up yet — the catalogue only serves effects so far.
          </p>
        </div>
      )}
    </div>
  );
}
