"use client";

import Image from "next/image";
import { useCallback, useState } from "react";
import { effectIcon } from "@/lib/effectIcons";
import { beginPaletteDrag, useDrag } from "@/store/drag";
import { EffectCard } from "./EffectCard";
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
  onDescribe,
  title,
}: {
  src: string;
  label: string;
  active?: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  onClick?: () => void;
  /** Hand back the tile's own box, or null on the way out, for whatever is
   *  describing it. The tile knows where it is; nothing else does. */
  onDescribe?: (box: DOMRect | null) => void;
  title?: string;
}) {
  const describe = (e: React.SyntheticEvent) =>
    onDescribe?.((e.currentTarget as HTMLElement).getBoundingClientRect());
  return (
    <button
      type="button"
      title={title ?? label}
      onPointerDown={onPointerDown}
      onClick={onClick}
      /* Focus as well as hover: the palette is reachable by tab, and a card
         only the mouse can summon is a card half the keyboard cannot read. */
      onPointerEnter={onDescribe ? describe : undefined}
      onPointerLeave={onDescribe ? () => onDescribe(null) : undefined}
      onFocus={onDescribe ? describe : undefined}
      onBlur={onDescribe ? () => onDescribe(null) : undefined}
      aria-pressed={active}
      className="flex flex-col items-center gap-[6px] bg-transparent border-0 p-0 cursor-grab active:cursor-grabbing touch-none group"
    >
      <span
        className={`w-full aspect-square flex items-center justify-center rounded-[7px] border border-solid transition-colors duration-[var(--dur-state)] ${
          active
            ? "border-accent bg-accent/10"
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

  /* The effect being read about, and the tile it is being read from. */
  const [reading, setReading] = useState<{ fx: Effect; box: DOMRect } | null>(null);

  const describe = useCallback(
    (fx: Effect, box: DOMRect | null) => setReading(box ? { fx, box } : null),
    [],
  );

  /* The rail scrolls under the card, and the card is placed in VIEWPORT
     coordinates off a box measured when the pointer arrived. Rather than
     re-measure on every scroll frame to keep it pinned to a tile that is
     sliding away, it is dismissed: you have moved on. */
  const onScroll = useCallback(() => setReading(null), []);

  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
      <div className="flex-none flex gap-[16px] px-[16px] pt-[12px] border-b border-solid border-white/[0.05]">
        {(["effects", "styles"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`pb-[8px] bg-transparent border-0 border-b-2 border-solid cursor-pointer text-[12px] font-semibold tracking-[0.01em] capitalize transition-colors duration-200 ${
              tab === t ? "text-ink border-b-accent" : "text-ink-dimmer border-b-transparent hover:text-ink-dim"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* the only thing in the rail that scrolls */}
      <div
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto px-[var(--spacing-s3)] py-[var(--spacing-s3)]"
      >
        {tab === "effects" ? (
          <div className={GRID}>
            {effects.map((fx) => (
              <Tile
                key={fx.id}
                src={effectIcon(fx)}
                label={fx.name}
                /* The blurb has its own card now. Leaving it on `title` as
                   well meant the browser's tooltip arrived a second later,
                   underneath, saying the same thing in a different box. */
                title={fx.name}
                active={dragging?.id === fx.id || armed?.id === fx.id}
                /* Picking the tile up is the moment the deciding stops, so the
                   card goes with the press. It has to be dropped HERE rather
                   than when the drag ends: a pointer captured by the drag never
                   gives the tile its pointerleave, so the card would sit in the
                   rail naming an effect the pointer left two seconds ago. */
                onPointerDown={(e) => { setReading(null); beginPaletteDrag(fx, e); }}
                onClick={() => arm(fx)}
                onDescribe={(box) => describe(fx, box)}
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

      {reading && !dragging && <EffectCard effect={reading.fx} anchor={reading.box} />}
    </div>
  );
}
