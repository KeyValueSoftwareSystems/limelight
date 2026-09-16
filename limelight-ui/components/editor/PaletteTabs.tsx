"use client";

import Image from "next/image";
import { useState } from "react";
import { effectIcon } from "@/lib/effectIcons";
import { beginPaletteDrag, useDrag } from "@/store/drag";
import type { Effect } from "@/lib/types";

/* The palette: one tabbed section, four across, every tile labelled. An unnamed
   icon grid makes a creator guess what "the wavy one" does; the name is what
   makes the set usable.

   Four across rather than five: at five the tile was 39px in a 248px rail, which
   is smaller than the pointer aiming at it and left the mark inside it too small
   to tell one effect from another. Four gives 50px, and the list scrolls — a
   palette is a drawer to reach into, not a diagram that has to fit on screen. */
const GRID = "grid grid-cols-4 gap-[8px]";

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
      className="flex flex-col items-center gap-[6px] bg-transparent border-0 p-0 cursor-grab active:cursor-grabbing touch-none group"
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
          width={28}
          height={28}
          className="pointer-events-none"
          style={{ opacity: active ? 1 : 0.85 }}
        />
      </span>
      <span
        className={`text-[10px] leading-[12px] truncate max-w-full transition-colors duration-[var(--dur-state)] ${
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
    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
      <div className="flex-none flex gap-[var(--spacing-s4)] px-[var(--spacing-s4)] pt-[var(--spacing-s3)] border-b border-solid border-line">
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

      {/* the only thing in the rail that scrolls */}
      <div className="flex-1 min-h-0 overflow-y-auto px-[var(--spacing-s3)] py-[var(--spacing-s3)]">
        {tab === "effects" ? (
          <div className={GRID}>
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
          <div className={GRID}>
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

      {/* One line, always here, empty or not. A note that appeared only when
          something was armed took its height out of the tiles above it, so the
          grid jumped the moment you picked an effect — under the pointer that
          was already aiming at it. */}
      <div className="flex-none h-[26px] flex items-center px-[var(--spacing-s4)] border-t border-solid border-line text-[10px]">
        {tab === "styles" ? (
          <span className="truncate text-ink-dimmer">Styles aren&apos;t wired to the baker yet.</span>
        ) : armed ? (
          <span className="truncate text-accent" title={`${armed.name} armed — click the timeline to place it`}>
            {armed.name} armed — click to place
          </span>
        ) : null}
      </div>
    </div>
  );
}
