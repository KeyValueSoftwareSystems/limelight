"use client";

import Image from "next/image";

import { effectIcon } from "@/lib/effectIcons";
import { dialsOf, kindNote } from "@/lib/dials";
import { rgb01ToHex } from "@/lib/palette";
import type { Effect } from "@/lib/types";

/* What an effect will let you do, read BEFORE you commit to putting it down.
   The tile is an icon and a name; the name says what the effect is called and
   nothing about what you get to steer once it is on the timeline. Finding that
   out meant dropping one, selecting it and reading its card — three moves to
   answer a question asked while choosing.

   It is a read, so it never takes the pointer: `pointer-events-none` throughout.
   The tile underneath stays live, and a drag that starts on it is not
   interrupted by the thing describing it. */

/** Wide enough for "Intensity 30–80%" on one line without wrapping. */
const CARD_W = 236;
/** Clearance from the rail, and from the top and bottom of the window. */
const GAP = 8;
const EDGE = 8;

function Swatches({ rgb }: { rgb: [number, number, number][] }) {
  return (
    <span className="inline-flex items-center gap-[3px] align-middle">
      {rgb.slice(0, 4).map((c, i) => (
        <span
          key={i}
          className="block w-[9px] h-[9px] rounded-full"
          style={{ background: rgb01ToHex(c), boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.45)" }}
        />
      ))}
    </span>
  );
}

/** One dial. The mark is the list's bullet AND its state: filled for something
 *  you can turn, hollow for something the effect arrives set to. */
function Row({ label, value, editable, swatches }: {
  label: string;
  value: string;
  editable: boolean;
  swatches: [number, number, number][];
}) {
  return (
    <li className="flex items-baseline gap-[6px] leading-[15px]">
      <span
        aria-hidden
        className="flex-none w-[4px] h-[4px] rounded-full mt-[5px]"
        style={{
          background: editable ? "var(--accent)" : "transparent",
          boxShadow: editable ? "none" : "inset 0 0 0 1px var(--line-strong)",
        }}
      />
      <span className={`flex-1 min-w-0 truncate ${editable ? "text-ink" : "text-ink-dim"}`}>
        {label}
      </span>
      <span className="flex-none mono text-[10px] text-ink-dimmer tabular-nums">
        {swatches.length ? <Swatches rgb={swatches} /> : value}
      </span>
    </li>
  );
}

export function EffectCard({ effect, anchor }: {
  effect: Effect;
  /** The tile this describes, in viewport coordinates. */
  anchor: DOMRect;
}) {
  const dials = dialsOf(effect);
  const editable = dials.filter((d) => d.editable);
  const preset = dials.filter((d) => !d.editable);

  /* Beside the tile, never over it, and never off the screen. The rail is on
     the left and is the full height of the window, so the card goes to its
     right and only has to be kept inside the window vertically. Estimated from
     the row count rather than measured: the card is read, not interacted with,
     so being a few pixels out costs nothing and measuring would cost a second
     paint on every hover. */
  const height = 120 + dials.length * 16 + (preset.length ? 18 : 0);
  const viewportH = typeof window === "undefined" ? 800 : window.innerHeight;
  const top = Math.max(EDGE, Math.min(anchor.top - 8, viewportH - height - EDGE));

  return (
    <div
      role="tooltip"
      className="fixed z-50 pointer-events-none rounded-[8px] border border-solid border-line-strong bg-bg-overlay p-[10px]"
      style={{ left: anchor.right + GAP, top, width: CARD_W, boxShadow: "var(--elev-popover)" }}
    >
      <div className="flex items-start gap-[7px]">
        <Image src={effectIcon(effect)} alt="" width={18} height={18} className="mt-[1px] flex-none" />
        <div className="min-w-0">
          <div className="text-[13px] leading-[16px] text-ink truncate">{effect.name}</div>
          <div className="text-[10px] leading-[13px] text-ink-dimmer">{kindNote(effect)}</div>
        </div>
      </div>

      <p className="m-0 mt-[7px] text-[11px] leading-[15px] text-ink-dim">{effect.blurb}</p>

      <div className="mt-[9px] pt-[8px] border-t border-solid border-line">
        <span className="text-[9px] uppercase tracking-[0.14em] text-ink-dimmer">Editable</span>
        <ul className="list-none m-0 mt-[5px] p-0 text-[11px]">
          {editable.map((d) => (
            <Row key={d.id} label={d.label} value={d.value} editable swatches={d.swatches} />
          ))}
          {/* Always true and never a dial: a clip's length is its two ends, and
              they are dragged. Saying so here is what makes the list a complete
              answer to "what will I be able to change" — without it an Impact,
              which declares no turnable dial at all, reads as having nothing. */}
          <Row label="Length" value="drag its ends" editable swatches={[]} />
        </ul>
      </div>

      {preset.length > 0 && (
        <div className="mt-[8px]">
          <span className="text-[9px] uppercase tracking-[0.14em] text-ink-dimmer">
            Set by the effect
          </span>
          <ul className="list-none m-0 mt-[5px] p-0 text-[11px]">
            {preset.map((d) => (
              <Row key={d.id} label={d.label} value={d.value} editable={false} swatches={d.swatches} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
