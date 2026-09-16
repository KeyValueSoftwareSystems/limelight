"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePortalStore } from "@/store/portal";
import { colourName, nextColour } from "@/lib/palette";
import * as api from "@/lib/api";
import type { PaletteColour } from "@/lib/types";

/**
 * The room's colours.
 *
 * A venue ships a palette and a creator spends it; the baker snaps every cue to
 * the nearest entry, so this set is what stops a show being a bag of hues. The
 * venue's is the starting point, not a cage — an edit here is the creator's and
 * regenerates the show.
 *
 * Every change is local the instant it happens and the show is rebuilt once the
 * hand comes off, the same rule the timeline uses for a clip drag: a picker
 * fires continuously while it is dragged, and a bake behind each tick would
 * mean a queue of dead shows and a UI that stutters under the pointer.
 */

/** how long the palette has to be still before it is worth regenerating */
const SETTLE_MS = 450;

const MAX = 8;

interface PalettePanelProps {
  /** rebake the show — the same call the timeline makes when a clip lands */
  onChange: () => void;
}

export function PalettePanel({ onChange }: PalettePanelProps) {
  const room = usePortalStore((s) => s.room);
  const palette = usePortalStore((s) => s.palette);
  const setPalette = usePortalStore((s) => s.setPalette);

  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [venueDefault, setVenueDefault] = useState<PaletteColour[]>([]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* the callbacks are read at fire time, not closed over: the settle timer
     outlives the render that started it */
  const commitRef = useRef<() => void>(null);

  /* ── the venue's own palette, whenever the room changes ─────────────── */
  useEffect(() => {
    if (!room) return;
    let live = true;
    api.palette.get(room.id, room.name).then((d) => {
      if (!live) return;
      setPalette(d.palette.colours);
      setVenueDefault(d.palette.colours);
      setDirty(false);
    }).catch(() => {});
    return () => { live = false; };
  }, [room, setPalette]);

  /* ── save, then regenerate ──────────────────────────────────────────── */
  useEffect(() => {
    commitRef.current = () => {
      const st = usePortalStore.getState();
      if (!st.room) return;
      api.palette.save(st.room.id, st.palette, st.room.name).catch(() => {});
      onChange();
    };
  });

  const settle = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commitRef.current?.(), SETTLE_MS);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const edit = useCallback(
    (next: PaletteColour[]) => {
      setPalette(next);
      setDirty(true);
      settle();
    },
    [setPalette, settle],
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
      /* a palette of nothing is not a palette; the baker would have nothing to
         snap to and every cue would keep whatever colour it was given */
      if (cur.length <= 2) return;
      edit(cur.filter((c) => c.id !== id));
      setSelected(null);
    },
    [edit],
  );

  const reset = useCallback(() => {
    edit(venueDefault);
    setSelected(null);
    setDirty(false);
  }, [edit, venueDefault]);

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="flex-none flex items-baseline gap-[var(--spacing-s2)] px-[var(--spacing-s4)] pt-[var(--spacing-s3)] pb-[var(--spacing-s2)]">
        <span className="label">Room colours</span>
        <span className="flex-1" />
        {dirty && venueDefault.length > 0 && (
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
        {!room ? (
          <p className="m-0 text-[10px] text-ink-dimmer leading-[1.5]">
            Pick a room and its colours appear here.
          </p>
        ) : (
          <>
            <p className="m-0 text-[10px] text-ink-dimmer leading-[1.5] truncate" title={room.name}>
              {dirty ? `${room.name} · edited` : room.name}
            </p>

            <div className="flex flex-wrap gap-[6px] mt-[var(--spacing-s3)]">
              {palette.map((c) => {
                const on = selected === c.id;
                return (
                  <div key={c.id} className="relative">
                    {/* The swatch IS the picker: a colour input painted over by
                        its own value, so the thing you click is the thing you
                        are changing rather than a proxy for it. */}
                    <input
                      type="color"
                      value={c.hex}
                      aria-label={`${colourName(c.hex)} — change this colour`}
                      title={`${colourName(c.hex)} · ${c.hex}`}
                      onFocus={() => setSelected(c.id)}
                      onChange={(e) => recolour(c.id, e.target.value)}
                      className={`w-[30px] h-[30px] p-0 rounded-full cursor-pointer appearance-none bg-transparent border-2 border-solid transition-colors duration-[var(--dur-state)] ${
                        on ? "border-ink" : "border-line-strong hover:border-ink-dimmer"
                      }`}
                      style={{ backgroundColor: c.hex }}
                    />
                    {on && palette.length > 2 && (
                      <button
                        type="button"
                        onClick={() => remove(c.id)}
                        aria-label={`remove ${colourName(c.hex)}`}
                        title="remove this colour"
                        className="absolute -top-[4px] -right-[4px] w-[14px] h-[14px] flex items-center justify-center rounded-full border border-solid border-line-strong bg-bg-overlay text-ink-dim text-[9px] leading-none cursor-pointer hover:text-danger hover:border-danger"
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
                  className="w-[30px] h-[30px] rounded-full border border-dashed border-line-strong bg-transparent text-ink-dimmer text-[14px] leading-none cursor-pointer hover:text-ink hover:border-ink-dimmer transition-colors duration-[var(--dur-state)]"
                >
                  +
                </button>
              )}
            </div>

            <p className="m-0 mt-[var(--spacing-s3)] text-[10px] text-ink-dimmer leading-[1.5]">
              {selected
                ? colourName(palette.find((c) => c.id === selected)?.hex ?? "")
                : `${palette.length} colours · every cue snaps to one`}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
