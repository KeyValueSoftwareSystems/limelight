"use client";

import Image from "next/image";
import { useState } from "react";
import { effectIcon } from "@/lib/effectIcons";
import { beginPaletteDrag, useDrag } from "@/store/drag";
import type { Effect } from "@/lib/types";

/* The palette: one tabbed section, five across, every tile labelled. An unnamed
   icon grid makes a creator guess what "the wavy one" does; the name is what
   makes the set usable. */

const STYLES: { id: string; name: string }[] = [
  { id: "club", name: "Club" },
  { id: "concert", name: "Concert" },
  { id: "festival", name: "Festival" },
  { id: "bar", name: "Bar" },
  { id: "lounge", name: "Lounge" },
  { id: "theatre", name: "Theatre" },
  { id: "corporate", name: "Corporate" },
  { id: "wedding", name: "Wedding" },
  { id: "custom", name: "Custom" },
];

function Tile({
  src,
  label,
  active,
  onPointerDown,
  onClick,
  title,
}: {
  src: string;
  label: string;
  active?: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title ?? label}
      onPointerDown={onPointerDown}
      onClick={onClick}
      aria-pressed={active}
      className="flex flex-col items-center gap-[5px] bg-transparent border-0 p-0 cursor-grab active:cursor-grabbing touch-none group"
    >
      <span
        className={`w-full aspect-square flex items-center justify-center rounded-[7px] border border-solid transition-colors duration-[var(--dur-state)] ${
          active
            ? "border-accent bg-accent-soft"
            : "border-line group-hover:border-line-strong group-hover:bg-bg-raised"
        }`}
      >
        <Image
          src={src}
          alt=""
          width={22}
          height={22}
          className="pointer-events-none"
          style={{ opacity: active ? 1 : 0.85 }}
        />
      </span>
      <span
        className={`text-[9px] leading-[11px] truncate max-w-full transition-colors duration-[var(--dur-state)] ${
          active ? "text-accent" : "text-ink-dim"
        }`}
      >
        {label}
      </span>
    </button>
  );
}

export function PaletteTabs({ effects }: { effects: Effect[] }) {
  const [tab, setTab] = useState<"effects" | "styles">("effects");
  const [style, setStyle] = useState<string | null>(null);
  const dragging = useDrag((s) => s.effect);
  const armed = useDrag((s) => s.armed);
  const arm = useDrag((s) => s.arm);

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex-none flex gap-[var(--spacing-s4)] px-[var(--spacing-s4)] border-b border-solid border-line">
        {(["effects", "styles"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`pb-[8px] bg-transparent border-0 border-b-2 border-solid cursor-pointer text-[11px] tracking-[0.16em] uppercase transition-colors duration-[var(--dur-state)] ${
              tab === t ? "text-ink border-b-accent" : "text-ink-dimmer border-b-transparent hover:text-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-[var(--spacing-s3)] py-[var(--spacing-s3)]">
        {tab === "effects" ? (
          <div className="grid grid-cols-5 gap-[7px]">
            {effects.map((fx) => (
              <Tile
                key={fx.id}
                src={effectIcon(fx)}
                label={fx.name}
                title={`${fx.name} — ${fx.blurb}`}
                active={dragging?.id === fx.id || armed?.id === fx.id}
                onPointerDown={(e) => beginPaletteDrag(fx, e)}
                onClick={() => arm(fx)}
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-[7px]">
            {STYLES.map((s) => (
              <Tile
                key={s.id}
                src={`/icons/styles/${s.id}.png`}
                label={s.name}
                active={style === s.id}
                onClick={() => setStyle((cur) => (cur === s.id ? null : s.id))}
              />
            ))}
          </div>
        )}
      </div>

      {tab === "effects" && armed && (
        <div className="flex-none px-[var(--spacing-s4)] pb-[var(--spacing-s3)] text-[10px] text-accent">
          {armed.name} armed — click the timeline to place it
        </div>
      )}
      {tab === "styles" && (
        <div className="flex-none px-[var(--spacing-s4)] pb-[var(--spacing-s3)] text-[10px] text-ink-dimmer">
          Styles aren&apos;t wired to the baker yet.
        </div>
      )}
    </div>
  );
}
