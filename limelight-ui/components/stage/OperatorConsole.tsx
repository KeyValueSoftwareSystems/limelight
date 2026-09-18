"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePortalStore } from "@/store/portal";
import { VerticalFader, ConsoleKnob, ConsoleButton } from "@/components/ui/VerticalFader";
import * as api from "@/lib/api";
import { SYNC_NUDGE_LIMIT } from "@/lib/sync";
import { OperatorTimeline } from "./OperatorTimeline";
import type { Grid, TrimState, PaletteColour } from "@/lib/types";
import { colourName } from "@/lib/palette";

export function OperatorConsole({
  currentTime,
  duration,
  grid,
  playing,
  onToggle,
  onSeek,
  rate,
  onRate,
  onRecolour,
}: {
  currentTime: number;
  duration: number;
  grid: Grid | null;
  playing: boolean;
  onToggle: () => void;
  onSeek: (t: number) => void;
  rate: number;
  onRate: (r: number) => void;
  onRecolour: (colours: PaletteColour[]) => void;
}) {
  const trims = usePortalStore((s) => s.trims);
  const setTrims = usePortalStore((s) => s.setTrims);
  const setRig = usePortalStore((s) => s.setRig);
  const show = usePortalStore((s) => s.show);
  const syncNudge = usePortalStore((s) => s.syncNudge);
  const setSyncNudge = usePortalStore((s) => s.setSyncNudge);
  const palette = usePortalStore((s) => s.palette);
  const setPalette = usePortalStore((s) => s.setPalette);
  const trimAtRef = useRef(0);
  const heldRef = useRef<Partial<TrimState> | null>(null);
  const fadeRef = useRef<number | null>(null);

  const pushTrim = useCallback(
    (immediate = false) => {
      const now = performance.now();
      if (!immediate && now - trimAtRef.current < 60) return;
      trimAtRef.current = now;
      api.rig.trim(usePortalStore.getState().trims).then(setRig).catch(() => {});
    },
    [setRig],
  );

  const set = useCallback(
    (patch: Partial<TrimState>, immediate = false) => {
      setTrims(patch);
      pushTrim(immediate);
    },
    [setTrims, pushTrim],
  );

  const flashDown = useCallback(
    (patch: Partial<TrimState>) => {
      const cur = usePortalStore.getState().trims;
      heldRef.current = Object.fromEntries(
        Object.keys(patch).map((k) => [k, cur[k as keyof TrimState]]),
      ) as Partial<TrimState>;
      set(patch, true);
    },
    [set],
  );
  const flashUp = useCallback(() => {
    if (heldRef.current) set(heldRef.current, true);
    heldRef.current = null;
  }, [set]);

  const stopFade = useCallback(() => {
    if (fadeRef.current !== null) cancelAnimationFrame(fadeRef.current);
    fadeRef.current = null;
  }, []);
  const fadeTo = useCallback(
    (target: number, seconds: number) => {
      stopFade();
      const from = usePortalStore.getState().trims.master;
      const t0 = performance.now();
      const step = () => {
        const p = Math.min(1, (performance.now() - t0) / (seconds * 1000));
        set({ master: from + (target - from) * p });
        if (p < 1) fadeRef.current = requestAnimationFrame(step);
        else { fadeRef.current = null; set({ master: target }, true); }
      };
      fadeRef.current = requestAnimationFrame(step);
    },
    [set, stopFade],
  );
  useEffect(() => stopFade, [stopFade]);

  const pct = (v: number) => Math.round(v * 100) + "%";
  const FH = 90;

  return (
    <div className="h-full flex flex-col min-h-0 gma-console">
      {show && <OperatorTimeline show={show} currentTime={currentTime} onSeek={onSeek} />}

      <div className="flex-1 min-h-0 flex items-stretch justify-center px-[8px] py-[6px] gap-[2px]">
        {/* Faders: Levels */}
        <div className="gma-section">
          <span className="gma-section-label">Levels</span>
          <div className="flex items-end gap-[3px]">
            <VerticalFader label="Mstr" value={Math.round(trims.master * 100)} displayValue={pct(trims.master)} height={FH} onChange={(v) => set({ master: v / 100 })} />
            <VerticalFader label="Par" value={Math.round(trims.par * 100)} displayValue={pct(trims.par)} height={FH} onChange={(v) => set({ par: v / 100 })} />
            <VerticalFader label="Head" value={Math.round(trims.head * 100)} displayValue={pct(trims.head)} height={FH} onChange={(v) => set({ head: v / 100 })} />
          </div>
        </div>

        <div className="gma-divider" />

        {/* Faders: Timing */}
        <div className="gma-section">
          <span className="gma-section-label">Timing</span>
          <div className="flex items-end gap-[3px]">
            <VerticalFader label="Sync" min={-Math.round(SYNC_NUDGE_LIMIT * 1000)} max={Math.round(SYNC_NUDGE_LIMIT * 1000)} value={Math.round(syncNudge * 1000)} displayValue={`${syncNudge >= 0 ? "+" : ""}${Math.round(syncNudge * 1000)}ms`} height={FH} onChange={(v) => setSyncNudge(v / 1000)} />
            <VerticalFader label="Lead" min={0} max={200} value={Math.round(trims.lead_ms ?? 0)} displayValue={`${Math.round(trims.lead_ms ?? 0)}ms`} height={FH} onChange={(v) => set({ lead_ms: v })} />
            <VerticalFader label="Tempo" min={70} max={130} value={Math.round(rate * 100)} displayValue={`${rate.toFixed(2)}×`} height={FH} onChange={(v) => onRate(v / 100)} />
          </div>
        </div>

        <div className="gma-divider" />

        {/* Knobs */}
        <div className="gma-section">
          <span className="gma-section-label">Encoders</span>
          <div className="flex gap-[4px]">
            <ConsoleKnob label="Master" value={Math.round(trims.master * 100)} displayValue={pct(trims.master)} onChange={(v) => set({ master: v / 100 })} />
            <ConsoleKnob label="Speed" min={70} max={130} value={Math.round(rate * 100)} displayValue={`${rate.toFixed(2)}×`} onChange={(v) => onRate(v / 100)} />
          </div>
        </div>

        <div className="gma-divider" />

        {/* Panic + Override buttons */}
        <div className="gma-section">
          <span className="gma-section-label">Panic</span>
          <div className="flex flex-col gap-[3px]">
            <div className="flex gap-[3px]">
              <ConsoleButton label="Blackout" active={trims.blackout} tone="red" onClick={() => set({ blackout: !trims.blackout, full_on: false }, true)} />
              <ConsoleButton label="Full" active={trims.full_on} tone="red" onClick={() => { stopFade(); set({ full_on: !trims.full_on, blackout: false }, true); }} />
            </div>
            <div className="flex gap-[3px]">
              <ConsoleButton label="Strobe Kill" active={trims.strobe_kill} tone="amber" onClick={() => set({ strobe_kill: !trims.strobe_kill }, true)} />
              <ConsoleButton label={trims.hold ? "Release" : "Freeze"} active={trims.hold} tone="blue" onClick={() => set({ hold: !trims.hold }, true)} />
            </div>
          </div>
        </div>

        <div className="gma-divider" />

        <div className="gma-section">
          <span className="gma-section-label">Override</span>
          <div className="flex flex-col gap-[3px]">
            <div className="flex gap-[3px]">
              <ConsoleButton label="100%" tone="amber" onClick={() => { stopFade(); set({ master: 1, par: 1, head: 1 }, true); }} />
              <ConsoleButton label="Half" tone="default" onClick={() => { stopFade(); set({ master: 0.5 }, true); }} />
            </div>
            <div className="flex gap-[3px]">
              <ConsoleButton label="Fade Out" tone="default" onClick={() => fadeTo(0, 3)} />
              <ConsoleButton label="Fade In" tone="default" onClick={() => fadeTo(1, 3)} />
            </div>
          </div>
        </div>

        <div className="gma-divider" />

        {/* Flash bumps */}
        <div className="gma-section">
          <span className="gma-section-label">Flash</span>
          <div className="flex flex-col gap-[3px]">
            <ConsoleButton label="Pars" tone="amber" onDown={() => flashDown({ par: 1 })} onUp={flashUp} />
            <ConsoleButton label="Heads" tone="amber" onDown={() => flashDown({ head: 1 })} onUp={flashUp} />
            <ConsoleButton label="All" tone="amber" onDown={() => flashDown({ master: 1, par: 1, head: 1 })} onUp={flashUp} />
          </div>
        </div>

        {/* Colour */}
        {palette.length > 0 && (
          <>
            <div className="gma-divider" />
            <div className="gma-section">
              <span className="gma-section-label">Colour</span>
              <div className="flex flex-wrap items-center gap-[4px] max-w-[70px]">
                {palette.map((c) => (
                  <input
                    key={c.id}
                    type="color"
                    value={c.hex}
                    aria-label={colourName(c.hex)}
                    title={`${colourName(c.hex)} · ${c.hex}`}
                    onChange={(e) =>
                      setPalette(palette.map((p) => (p.id === c.id ? { ...p, hex: e.target.value } : p)))
                    }
                    onBlur={() => onRecolour(usePortalStore.getState().palette)}
                    className="block w-[22px] h-[22px] p-0 border-0 rounded-full bg-transparent cursor-pointer"
                    style={{ boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.06)" }}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
