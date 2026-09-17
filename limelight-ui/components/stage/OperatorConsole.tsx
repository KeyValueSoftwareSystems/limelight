"use client";

import { useCallback, useRef } from "react";
import { usePortalStore } from "@/store/portal";
import { Fader } from "@/components/ui/Fader";
import { TransportPill } from "@/components/editor/TransportPill";
import * as api from "@/lib/api";
import { SYNC_NUDGE_LIMIT } from "@/lib/sync";
import { OperatorTimeline } from "./OperatorTimeline";
import type { Grid, TrimState } from "@/lib/types";

/** A momentary key: full while held, back to where it was on release. */
function Bump({
  label,
  onDown,
  onUp,
}: {
  label: string;
  onDown: () => void;
  onUp: () => void;
}) {
  return (
    <button
      type="button"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); onDown(); }}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onLostPointerCapture={onUp}
      title={`Hold to flash ${label.toLowerCase()} to full`}
      className="liquid liquid-key h-[34px] px-[12px] rounded-[var(--radius-sm)] text-[12px] font-medium text-ink cursor-pointer select-none"
    >
      {label}
    </button>
  );
}

function Group({
  title,
  span,
  children,
}: {
  title: string;
  span: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`flex flex-col gap-[10px] min-w-0 ${span}`}>
      <span className="text-[11px] font-medium text-ink-dimmer">{title}</span>
      {children}
    </section>
  );
}

export function OperatorConsole({
  currentTime,
  duration,
  grid,
  playing,
  onToggle,
  onSeek,
}: {
  currentTime: number;
  duration: number;
  grid: Grid | null;
  playing: boolean;
  onToggle: () => void;
  onSeek: (t: number) => void;
}) {
  const trims = usePortalStore((s) => s.trims);
  const setTrims = usePortalStore((s) => s.setTrims);
  const setRig = usePortalStore((s) => s.setRig);
  const show = usePortalStore((s) => s.show);
  const syncLatency = usePortalStore((s) => s.syncLatency);
  const syncNudge = usePortalStore((s) => s.syncNudge);
  const setSyncNudge = usePortalStore((s) => s.setSyncNudge);
  const trimAtRef = useRef(0);
  const heldRef = useRef<Partial<TrimState> | null>(null);

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

  /* A flash remembers what it interrupted, so releasing puts the desk back
     exactly where the operator left it rather than at some default. */
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

  const pct = (v: number) => Math.round(v * 100) + "%";
  const sections = show?.sections ?? [];

  return (
    <div className="h-full flex flex-col min-h-0" style={{ background: "var(--bg)" }}>
      {show && <OperatorTimeline show={show} currentTime={currentTime} onSeek={onSeek} />}

      <div className="flex-1 min-h-0 overflow-y-auto px-[20px] py-[16px]">
      {/* One grid across the full width. The groups were a wrapping flex row,
          which huddled every control at the left and left the rest of the desk
          empty. */}
      <div className="grid grid-cols-12 gap-x-[24px] gap-y-[18px] items-start">
        <Group title="Transport" span="col-span-12 sm:col-span-4 lg:col-span-3">
          <TransportPill
            currentTime={currentTime}
            duration={duration}
            grid={grid}
            playing={playing}
            onToggle={onToggle}
          />
        </Group>

        <Group title="Panic" span="col-span-12 sm:col-span-8 lg:col-span-5">
          <div className="flex items-center gap-[8px]">
            <button
              type="button"
              onClick={() => set({ blackout: !trims.blackout }, true)}
              aria-pressed={trims.blackout}
              title="Take every lamp to zero"
              className={`h-[34px] px-[18px] rounded-[var(--radius-sm)] border-0 text-[12.5px] font-semibold cursor-pointer transition-colors duration-150 ${
                trims.blackout
                  ? "bg-danger text-[#140406]"
                  : "liquid liquid-key text-danger"
              }`}
            >
              {trims.blackout ? "Blackout on" : "Blackout"}
            </button>
            <button
              type="button"
              onClick={() => set({ strobe_kill: !trims.strobe_kill }, true)}
              aria-pressed={trims.strobe_kill}
              title="Stop every strobe channel"
              className={`h-[34px] px-[12px] rounded-[var(--radius-sm)] text-[12px] font-medium cursor-pointer ${
                trims.strobe_kill ? "liquid-well text-ink" : "liquid liquid-key text-ink-dim"
              }`}
            >
              Strobe kill
            </button>
            <button
              type="button"
              onClick={() => set({ hold: !trims.hold }, true)}
              aria-pressed={trims.hold}
              title="Freeze the look where it is; the show keeps running underneath"
              className={`h-[34px] px-[12px] rounded-[var(--radius-sm)] text-[12px] font-medium cursor-pointer ${
                trims.hold ? "liquid-well text-ink" : "liquid liquid-key text-ink-dim"
              }`}
            >
              {trims.hold ? "Release" : "Freeze"}
            </button>
          </div>
        </Group>

        <Group title="Flash" span="col-span-12 lg:col-span-4">
          <div className="flex items-center gap-[8px] flex-wrap">
            <Bump label="Pars" onDown={() => flashDown({ par: 1 })} onUp={flashUp} />
            <Bump label="Heads" onDown={() => flashDown({ head: 1 })} onUp={flashUp} />
            <Bump
              label="All"
              onDown={() => flashDown({ master: 1, par: 1, head: 1 })}
              onUp={flashUp}
            />
          </div>
        </Group>

        <Group title="Levels" span="col-span-12 lg:col-span-7">
          <div className="grid grid-cols-3 gap-x-[18px] gap-y-[10px]">
            <Fader
              label="Grand master"
              value={Math.round(trims.master * 100)}
              displayValue={pct(trims.master)}
              onChange={(v) => set({ master: v / 100 })}
            />
            <Fader
              label="Pars"
              value={Math.round(trims.par * 100)}
              displayValue={pct(trims.par)}
              onChange={(v) => set({ par: v / 100 })}
            />
            <Fader
              label="Heads"
              value={Math.round(trims.head * 100)}
              displayValue={pct(trims.head)}
              onChange={(v) => set({ head: v / 100 })}
            />
          </div>
        </Group>

        <Group title="Timing" span="col-span-12 lg:col-span-5">
          <div className="grid grid-cols-2 gap-x-[18px]">
            {/* syncNudge is SECONDS; the desk works in milliseconds. Feeding
                the 0.3s limit straight to a slider whose step is 1 gave the
                control a single position, which is why it would not move. */}
            <Fader
              label="Sync"
              min={-Math.round(SYNC_NUDGE_LIMIT * 1000)}
              max={Math.round(SYNC_NUDGE_LIMIT * 1000)}
              value={Math.round(syncNudge * 1000)}
              displayValue={`${syncNudge >= 0 ? "+" : ""}${Math.round(syncNudge * 1000)} ms`}
              hint={
                syncLatency > 0
                  ? `Device reports ${Math.round(syncLatency * 1000)} ms; this nudges on top. Plus holds the lights back.`
                  : "Your device does not report its latency. Plus holds the lights back."
              }
              onChange={(v) => setSyncNudge(v / 1000)}
            />
            <Fader
              label="Lamps lead"
              min={0}
              max={200}
              value={Math.round(trims.lead_ms ?? 0)}
              displayValue={`${Math.round(trims.lead_ms ?? 0)} ms`}
              hint="Frames go to the rig this early, to cover the lamps' own response. Raise it if hits land late."
              onChange={(v) => set({ lead_ms: v })}
            />
          </div>
        </Group>

        </div>
      </div>
    </div>
  );
}
