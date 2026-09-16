"use client";

import Image from "next/image";
import { useState } from "react";
import { effectIcon } from "@/lib/effectIcons";
import { beatsLabel, mmssms, parseTime } from "@/lib/grid";
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

/** One press of a stepper, in seconds. Ten milliseconds is about a frame and a
 *  half of the 40fps light stream — the smallest move that changes what you
 *  see rather than what the number says. */
const STEP_S = 0.01;

function sameColour(a: unknown, b: [number, number, number]) {
  return Array.isArray(a) && a.length === 3 && a.every((v, i) => Math.abs(Number(v) - b[i]) < 0.02);
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

export function ClipInspector({
  clip,
  effect,
  x,
  y,
  maxHeight,
  onChange,
  onRetime,
  onRemove,
  ref,
}: {
  clip: Clip;
  effect: Effect | undefined;
  x: number;
  y: number;
  /** The tallest the card may be here. Past it the card scrolls rather than
   *  hanging off the bottom of the editor, which on a short editor is off the
   *  bottom of the screen. */
  maxHeight?: number;
  onChange: (patch: Record<string, unknown>) => void;
  /** Absolute placement, in seconds. Every conversion back into bars and beats
   *  happens in the timeline, which owns the grid. */
  onRetime: (patch: { startS?: number; lengthS?: number }) => void;
  onRemove: () => void;
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
      className="absolute z-40 w-[248px] rounded-[8px] border border-solid border-line-strong bg-bg-overlay p-[var(--spacing-s3)] overflow-y-auto overscroll-contain"
      style={{ left: x, top: y, maxHeight, boxShadow: "var(--elev-popover)" }}
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
            <div className="absolute right-0 top-[24px] z-10 min-w-[128px] py-[3px] rounded-[6px] border border-solid border-line-strong bg-bg-overlay"
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
      </div>

      {/* ── where it is, exactly ──────────────────────────────────────────────
          A drag gets you close; the last ten milliseconds are typed or stepped.
          Both fields are absolute, so the number you read is the number the
          baker gets — bar·beat is the musician's name for the same instant and
          sits underneath as context, not as the thing being edited. */}
      <div className="mt-[10px] pt-[10px] border-t border-solid border-line">
        <div className="flex items-center gap-[8px]">
          <span className="text-[11px] text-ink-dim flex-none w-[40px]">Start</span>
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

        <div className="flex items-center gap-[8px] mt-[5px]">
          <span className="text-[11px] text-ink-dim flex-none w-[40px]">Length</span>
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

      {effect?.blurb && (
        <p className="text-[11px] text-ink-dim leading-[16px] mt-[10px]">{effect.blurb}</p>
      )}

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
          <div className="flex gap-[5px] mt-[5px] -ml-[2px]">
            {SWATCHES.map((s) => {
              const on = sameColour(clip.params.colour ?? dials.colour?.default, s.rgb);
              return (
                <button
                  key={s.name}
                  type="button"
                  title={s.name}
                  onClick={() => onChange({ colour: s.rgb })}
                  className="w-[22px] h-[22px] flex-none inline-flex items-center justify-center rounded-full bg-transparent border-0 cursor-pointer p-0"
                >
                  <span
                    aria-hidden
                    className="w-[18px] h-[18px] rounded-full border-2 border-solid transition-transform duration-[var(--dur-state)]"
                    style={{
                      background: s.css,
                      borderColor: on ? "var(--accent)" : "transparent",
                      transform: on ? "scale(1.1)" : undefined,
                    }}
                  />
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
