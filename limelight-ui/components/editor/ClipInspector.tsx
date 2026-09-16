"use client";

import Image from "next/image";
import { useState } from "react";
import { effectIcon } from "@/lib/effectIcons";
import { beatsLabel, mmssms, parseTime } from "@/lib/grid";
import { colourName, hexToRgb01, rgb01ToHex } from "@/lib/palette";
import { usePortalStore } from "@/store/portal";
import type { Clip, Effect } from "@/lib/types";
import type { Rgb01 } from "@/lib/palette";

/* The popover that appears on the selected clip. Its controls come from the
   effect's own dials, so a clip only offers what the renderer will actually
   read — an Impact has no `amount`, and pretending otherwise would give a
   creator a slider that changes nothing. */

/** One press of a stepper, in seconds. Ten milliseconds is about a frame and a
 *  half of the 40fps light stream — the smallest move that changes what you
 *  see rather than what the number says. */
const STEP_S = 0.01;

/** The card's width, exported because the timeline has to know it to decide
 *  whether the card clears the clip to the left or the right. Two copies of
 *  this number is a card that thinks it fits somewhere it does not. */
export const INSPECTOR_W = 212;

function sameColour(a: unknown, b: Rgb01) {
  return Array.isArray(a) && a.length === 3 && a.every((v, i) => Math.abs(Number(v) - b[i]) < 0.02);
}

/** The current colour of the clip as a hex string for the native picker. */
function currentHex(clip: Clip, fallback: unknown): string {
  const v = clip.params.colour ?? fallback;
  if (Array.isArray(v) && v.length === 3) return rgb01ToHex(v.map(Number) as Rgb01);
  return "#ffffff";
}

/** A stepper pair. Small, because it sits inside a 248px card, but still a real
 *  hit target — these are the control you reach for when the drag was close. */
function Step({ onLess, onMore, less, more }: {
  onLess: () => void; onMore: () => void; less: string; more: string;
}) {
  const cls =
    "w-[20px] h-[20px] flex items-center justify-center rounded-[4px] border border-solid " +
    "border-line bg-transparent text-ink-dim text-[11px] leading-none cursor-pointer " +
    "hover:text-ink hover:border-line-strong transition-colors duration-[var(--dur-state)]";
  return (
    <span className="flex-none flex gap-[3px]">
      <button type="button" onClick={onLess} title={less} className={cls}><span aria-hidden>−</span></button>
      <button type="button" onClick={onMore} title={more} className={cls}><span aria-hidden>+</span></button>
    </span>
  );
}

/** A value you can also type. It holds a draft only while it has the focus, so
 *  a drag happening elsewhere is never fighting a half-typed number for the
 *  same field, and a value that will not parse puts back what was there. */
function TimeField({ value, onCommit, title }: {
  value: string; onCommit: (text: string) => void; title: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      value={draft ?? value}
      title={title}
      spellCheck={false}
      onFocus={(e) => { setDraft(value); e.currentTarget.select(); }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== null) onCommit(draft); setDraft(null); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.currentTarget.blur(); return; }
        if (e.key === "Escape") { setDraft(null); e.currentTarget.blur(); }
        e.stopPropagation();
      }}
      className="mono flex-1 min-w-0 h-[20px] px-[5px] rounded-[4px] border border-solid border-line bg-bg text-[11px] text-ink tabular-nums focus:border-line-strong"
    />
  );
}

/* ── the colour section ────────────────────────────────────────────────────
   The show's palette as quick-pick chips, plus a native colour picker for
   anything outside it. The chips are the colours the show is spending —
   the same set the sidebar shows — so picking one keeps the show coherent,
   and the picker is the escape hatch for when none of them are right. */
function ClipColourPicker({
  clip,
  defaultColour,
  onChange,
}: {
  clip: Clip;
  defaultColour: unknown;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const palette = usePortalStore((s) => s.palette);
  const hex = currentHex(clip, defaultColour);

  return (
    <div className="mt-[10px]">
      <span className="text-[11px] text-ink-dim">Colour</span>
      <div className="flex flex-wrap items-center gap-[6px] mt-[5px]">
        {/* Show palette swatches when available */}
        {palette.map((c) => {
          const rgb = hexToRgb01(c.hex);
          const on = sameColour(clip.params.colour ?? defaultColour, rgb);
          return (
            <button
              key={c.id}
              type="button"
              title={`${colourName(c.hex)} · ${c.hex}`}
              onClick={() => onChange({ colour: [...rgb] })}
              className="w-[22px] h-[22px] flex-none rounded-full border-0 bg-transparent cursor-pointer p-0"
            >
              <span
                aria-hidden
                className="block w-[22px] h-[22px] rounded-full transition-transform duration-[var(--dur-state)]"
                style={{
                  background: c.hex,
                  boxShadow: on
                    ? "inset 0 0 0 1px rgba(0,0,0,0.45), 0 0 0 2px var(--bg), 0 0 0 3px var(--ink)"
                    : "inset 0 0 0 1px rgba(0,0,0,0.45)",
                  transform: on ? "scale(1.1)" : undefined,
                }}
              />
            </button>
          );
        })}

        {/* Native colour picker for any colour outside the palette */}
        <input
          type="color"
          value={hex}
          aria-label="Pick a custom colour"
          title={`Custom · ${hex}`}
          onChange={(e) => onChange({ colour: [...hexToRgb01(e.target.value)] })}
          className="w-[22px] h-[22px] p-0 border-0 rounded-full bg-transparent cursor-pointer"
          style={{
            boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.45), 0 0 0 1px var(--line-strong)",
          }}
        />
      </div>

      {/* Name of the current colour */}
      <div className="mt-[4px] h-[14px] text-[10px] leading-[14px]">
        <span className="text-ink-dimmer">{colourName(hex)} · </span>
        <span className="mono text-ink-dimmer tabular-nums">{hex}</span>
      </div>
    </div>
  );
}

export function ClipInspector({
  clip,
  effect,
  onChange,
  onRetime,
  onRemove,
  onClose,
  ref,
}: {
  clip: Clip;
  effect: Effect | undefined;
  onChange: (patch: Record<string, unknown>) => void;
  /** Absolute placement, in seconds. Every conversion back into bars and beats
   *  happens in the timeline, which owns the grid. */
  onRetime: (patch: { startS?: number; lengthS?: number }) => void;
  onRemove: () => void;
  /** Put the card away WITHOUT letting go of the clip. Dismissing it by
   *  deselecting meant the only way to see the clip you were working on was to
   *  stop working on it. */
  onClose: () => void;
  ref?: React.Ref<HTMLDivElement>;
}) {
  const [menu, setMenu] = useState(false);
  const dials = effect?.dials ?? {};
  const amount = dials.amount;
  const hasColour = "colour" in dials;

  const current = Number(clip.params.amount ?? amount?.default ?? 0.8);
  const min = amount?.min ?? 0;
  const max = amount?.max ?? 1;
  const lengthS = Math.max(0.001, clip.endS - clip.startS);

  return (
    <div
      ref={ref}
      data-clip-inspector
      className="absolute z-40 rounded-[8px] border border-solid border-line-strong bg-bg-overlay p-[10px] overflow-y-auto overscroll-contain"
      /* left/top/maxHeight are written by the timeline after layout — it is the
         only thing that can see where the clip ended up. Hidden until it has,
         so the card is never painted at 0,0 on its way to the right place. */
      style={{ width: INSPECTOR_W, visibility: "hidden", boxShadow: "var(--elev-popover)" }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-start gap-[6px]">
        <Image src={effectIcon({ id: clip.tile ?? clip.fx })} alt="" width={16} height={16} className="mt-[1px] flex-none" />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] text-ink leading-[16px] truncate">{clip.name}</div>
        </div>
        <div className="relative flex-none">
          <button
            type="button"
            onClick={() => setMenu((m) => !m)}
            aria-label="Clip actions"
            aria-expanded={menu}
            className="w-[20px] h-[20px] rounded bg-transparent border-0 cursor-pointer text-ink-dim hover:text-ink text-[13px] leading-none"
          >
            <span aria-hidden>…</span>
          </button>
          {menu && (
            <div className="absolute right-0 top-[22px] z-10 min-w-[128px] py-[3px] rounded-[6px] border border-solid border-line-strong bg-bg-overlay"
              style={{ boxShadow: "var(--elev-popover)" }}>
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
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          title="Close — the clip stays selected"
          className="flex-none w-[20px] h-[20px] rounded bg-transparent border-0 cursor-pointer text-ink-dim hover:text-ink text-[14px] leading-none"
        >
          <span aria-hidden>×</span>
        </button>
      </div>

      {/* ── where it is, exactly ──────────────────────────────────────────────
          A drag gets you close; the last ten milliseconds are typed or stepped.
          Both fields are absolute, so the number you read is the number the
          baker gets — bar·beat is the musician's name for the same instant and
          sits underneath as context, not as the thing being edited. */}
      <div className="mt-[8px] pt-[8px] border-t border-solid border-line">
        <div className="flex items-center gap-[6px]">
          <span className="text-[11px] text-ink-dim flex-none w-[38px]">Start</span>
          <TimeField
            value={mmssms(clip.startS)}
            title="When it starts — m:ss.mmm, or plain seconds"
            onCommit={(t) => { const v = parseTime(t); if (v !== null) onRetime({ startS: v }); }}
          />
          <Step
            onLess={() => onRetime({ startS: clip.startS - STEP_S })}
            onMore={() => onRetime({ startS: clip.startS + STEP_S })}
            less="10ms earlier" more="10ms later"
          />
        </div>

        <div className="flex items-center gap-[6px] mt-[5px]">
          <span className="text-[11px] text-ink-dim flex-none w-[38px]">Length</span>
          <TimeField
            value={lengthS.toFixed(3)}
            title="How long it lasts, in seconds"
            onCommit={(t) => { const v = parseTime(t); if (v !== null && v > 0) onRetime({ lengthS: v }); }}
          />
          <Step
            onLess={() => onRetime({ lengthS: lengthS - STEP_S })}
            onMore={() => onRetime({ lengthS: lengthS + STEP_S })}
            less="10ms shorter" more="10ms longer"
          />
        </div>

        <p className="m-0 mt-[5px] mono text-[10px] text-ink-dimmer tabular-nums">
          bar {clip.bar}·{beatsLabel(clip.beat)} · {beatsLabel(clip.beats)} beat{clip.beats === 1 ? "" : "s"}
        </p>
      </div>

      {/* No blurb. It is the tallest thing the card could hold and its height
          varies per effect, so it was what pushed the card over the clip — and
          what an effect DOES is already read in the palette, at the moment you
          choose it. Here you are adjusting one you have already chosen. */}

      {amount ? (
        <div className="mt-[10px]">
          <div className="flex items-center gap-[8px]">
            <span className="text-[11px] text-ink-dim flex-none w-[50px]">Intensity</span>
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
        <p className="text-[10px] text-ink-dimmer mt-[10px]">
          This effect has no intensity of its own.
        </p>
      )}

      {hasColour && <ClipColourPicker
        clip={clip}
        defaultColour={dials.colour?.default}
        onChange={onChange}
      />}
    </div>
  );
}
