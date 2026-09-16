"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePortalStore } from "@/store/portal";
import { colourName, nextColour } from "@/lib/palette";
import type { PaletteColour } from "@/lib/types";

/**
 * The colours this show is spending.
 *
 * A venue arrives with a palette and a creator spends it; portal/recolour.py
 * maps the show's existing colours onto whatever is set here, positionally, and
 * rewrites every cue. Nothing else about the show moves — an edit here changes
 * what the room looks like, never what it does.
 *
 * Every change is local the instant it happens and the show is remade once the
 * hand comes off, the same rule the timeline uses for a clip drag: a picker
 * fires continuously while it is dragged, and a round trip behind each tick
 * would mean a queue of dead shows and a UI that stutters under the pointer.
 */

/** how long the palette has to be still before it is worth remaking the show */
const SETTLE_MS = 450;

/* Five. The mapping is positional and a show carries a handful of roles —
   primary, secondary, accent, highlight — so a sixth entry has nothing to map
   onto and the ones past the end wrap back around to the start. */
const MAX = 5;
const MIN = 2;

interface PalettePanelProps {
  /** hand the new set to /api/recolour and rebake what comes back */
  onRecolour: (colours: PaletteColour[]) => void;
}

export function PalettePanel({ onRecolour }: PalettePanelProps) {
  const room = usePortalStore((s) => s.room);
  const palette = usePortalStore((s) => s.palette);
  const base = usePortalStore((s) => s.paletteBase);
  const setPalette = usePortalStore((s) => s.setPalette);

  const [selected, setSelected] = useState<string | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* read at fire time, not closed over: the settle timer outlives the render
     that started it */
  const commitRef = useRef<() => void>(null);

  useEffect(() => {
    commitRef.current = () => onRecolour(usePortalStore.getState().palette);
  });

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const edit = useCallback(
    (next: PaletteColour[]) => {
      setPalette(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => commitRef.current?.(), SETTLE_MS);
    },
    [setPalette],
  );

  const recolour = useCallback(
    (id: string, hex: string) => {
      edit(usePortalStore.getState().palette.map((c) => (c.id === id ? { ...c, hex } : c)));
    },
    [edit],
  );

  const add = useCallback(() => {
    const cur = usePortalStore.getState().palette;
    if (cur.length >= MAX) return;
    const c = { id: `c${Date.now().toString(36)}`, hex: nextColour(cur.map((x) => x.hex)) };
    edit([...cur, c]);
    setSelected(c.id);
  }, [edit]);

  const remove = useCallback(
    (id: string) => {
      const cur = usePortalStore.getState().palette;
      /* A palette of one is not a palette: every cue in the show would map onto
         the same colour and the whole thing would come back monochrome. */
      if (cur.length <= MIN) return;
      edit(cur.filter((c) => c.id !== id));
      setSelected(null);
    },
    [edit],
  );

  const reset = useCallback(() => {
    edit(base);
    setSelected(null);
  }, [edit, base]);

  const dirty =
    base.length > 0 &&
    (palette.length !== base.length || palette.some((c, i) => c.hex !== base[i]?.hex));

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="flex-none flex items-baseline gap-[var(--spacing-s2)] px-[var(--spacing-s4)] pt-[var(--spacing-s3)] pb-[var(--spacing-s2)]">
        <span className="label">Room colours</span>
        <span className="flex-1" />
        {dirty && (
          <button
            type="button"
            onClick={reset}
            className="bg-transparent border-0 p-0 cursor-pointer text-[10px] text-ink-dimmer hover:text-ink transition-colors duration-[var(--dur-state)]"
          >
            reset
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-[var(--spacing-s4)] pb-[var(--spacing-s3)]">
        {!palette.length ? (
          <p className="m-0 text-[10px] text-ink-dimmer leading-[1.5]">
            {room ? "This show declares no colours yet." : "Pick a room and its colours appear here."}
          </p>
        ) : (
          <>
            <p className="m-0 text-[10px] text-ink-dimmer leading-[1.5] truncate" title={room?.name}>
              {room?.name ?? "—"}{dirty ? " · edited" : ""}
            </p>

            {/* Chips, not squares in boxes. A colour is the only thing on this
                panel worth looking at, so nothing is drawn around it that is not
                doing work: the ring is the selection and the rim is the edge
                against a near-black ground. */}
            <div className="flex flex-wrap items-center gap-[8px] mt-[var(--spacing-s3)]">
              {palette.map((c) => {
                const on = selected === c.id;
                return (
                  <div key={c.id} className="relative leading-none">
                    {/* The chip IS the picker: a colour input painted by its own
                        value, so the thing you click is the thing you are
                        changing rather than a proxy for it. */}
                    <input
                      type="color"
                      value={c.hex}
                      aria-label={`${colourName(c.hex)} — change this colour`}
                      title={`${colourName(c.hex)} · ${c.hex}`}
                      onFocus={() => setSelected(c.id)}
                      onChange={(e) => recolour(c.id, e.target.value)}
                      className="block w-[34px] h-[34px] p-0 border-0 rounded-full bg-transparent cursor-pointer transition-transform duration-[var(--dur-state)] hover:scale-105"
                      style={{
                        /* rim, then the ring when it is the selected one — both
                           as shadows so neither one resizes the chip */
                        boxShadow: on
                          ? "inset 0 0 0 1px rgba(0,0,0,0.45), 0 0 0 2px var(--bg), 0 0 0 4px var(--ink)"
                          : "inset 0 0 0 1px rgba(0,0,0,0.45), 0 0 0 1px var(--line-strong)",
                      }}
                    />
                    {on && palette.length > MIN && (
                      <button
                        type="button"
                        onClick={() => remove(c.id)}
                        aria-label={`remove ${colourName(c.hex)}`}
                        title="remove this colour"
                        className="absolute -top-[5px] -right-[5px] w-[15px] h-[15px] flex items-center justify-center rounded-full border border-solid border-line-strong bg-bg-overlay text-ink-dim text-[10px] leading-none cursor-pointer hover:text-danger hover:border-danger transition-colors duration-[var(--dur-state)]"
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}

              {palette.length < MAX && (
                <button
                  type="button"
                  onClick={add}
                  aria-label="add a colour"
                  title="add a colour"
                  className="w-[34px] h-[34px] flex items-center justify-center rounded-full border border-dashed border-line-strong bg-transparent text-ink-dimmer text-[15px] leading-none cursor-pointer hover:text-ink hover:border-ink-dimmer transition-colors duration-[var(--dur-state)]"
                >
                  +
                </button>
              )}
            </div>

            {/* One line that says what is under the pointer, or what the set is.
                It is a fixed height so naming a colour cannot shunt the chips. */}
            <div className="mt-[var(--spacing-s3)] h-[14px] flex items-baseline gap-[var(--spacing-s2)] text-[10px] leading-[14px]">
              {selected ? (
                <>
                  <span className="text-ink-dim">
                    {colourName(palette.find((c) => c.id === selected)?.hex ?? "")}
                  </span>
                  <span className="mono text-ink-dimmer tabular-nums">
                    {palette.find((c) => c.id === selected)?.hex}
                  </span>
                </>
              ) : (
                <span className="text-ink-dimmer">
                  {palette.length} of {MAX} · every cue maps onto one
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
