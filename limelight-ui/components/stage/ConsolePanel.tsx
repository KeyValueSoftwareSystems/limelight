"use client";

import { useCallback, useRef } from "react";
import { usePortalStore } from "@/store/portal";
import { Fader } from "@/components/ui/Fader";
import { Button } from "@/components/ui/Button";
import * as api from "@/lib/api";
import { SYNC_NUDGE_LIMIT } from "@/lib/sync";

export function ConsolePanel() {
  const trims = usePortalStore((s) => s.trims);
  const setTrims = usePortalStore((s) => s.setTrims);
  const setRig = usePortalStore((s) => s.setRig);
  const want = usePortalStore((s) => s.want);
  const natural = usePortalStore((s) => s.natural);
  const swapping = usePortalStore((s) => s.swapping);
  const syncLatency = usePortalStore((s) => s.syncLatency);
  const syncNudge = usePortalStore((s) => s.syncNudge);
  const setSyncNudge = usePortalStore((s) => s.setSyncNudge);
  const trimAtRef = useRef(0);

  const pushTrim = useCallback(
    (immediate = false) => {
      const now = performance.now();
      if (!immediate && now - trimAtRef.current < 60) return;
      trimAtRef.current = now;
      const current = usePortalStore.getState().trims;
      api.rig
        .trim(current)
        .then(setRig)
        .catch(() => {});
    },
    [setRig],
  );

  const setTrimValue = useCallback(
    (patch: Partial<typeof trims>, immediate = false) => {
      setTrims(patch);
      pushTrim(immediate);
    },
    [setTrims, pushTrim],
  );

  const pct = (v: number) => Math.round(v * 100) + "%";
  const w = want === null ? natural : want;
  const wantDisplay =
    w === null || w === undefined
      ? "—"
      : Math.round(w * 100) + "%" + (want === null ? " (the song's own)" : "");

  return (
    <div className="px-[var(--spacing-s5)] pt-[var(--spacing-s5)] mt-[var(--spacing-s5)] border-t border-solid border-line">
      <div className="label">Console</div>
      <div className="flex flex-col gap-[var(--spacing-s4)] mt-[var(--spacing-s3)]">
        {/* panic buttons */}
        <div className="grid grid-cols-2 gap-[var(--spacing-s2)]">
          <Button
            variant="panic"
            wide
            active={trims.blackout}
            onClick={() => setTrimValue({ blackout: !trims.blackout }, true)}
            className={`col-span-2 ${trims.blackout ? "!bg-danger !border-danger !text-white" : "!border-danger !text-danger"}`}
          >
            {trims.blackout ? "Blackout — on" : "Blackout"}
          </Button>
          <Button
            variant="panic"
            active={trims.strobe_kill}
            onClick={() => setTrimValue({ strobe_kill: !trims.strobe_kill }, true)}
            className={trims.strobe_kill ? "!bg-warn !border-warn !text-[#120d00]" : ""}
          >
            Strobe kill
          </Button>
          <Button
            variant="panic"
            active={trims.hold}
            onClick={() => setTrimValue({ hold: !trims.hold }, true)}
            className={trims.hold ? "!bg-warn !border-warn !text-[#120d00]" : ""}
          >
            {trims.hold ? "Release" : "Take control"}
          </Button>
        </div>

        <Fader
          label="Grand master"
          value={Math.round(trims.master * 100)}
          displayValue={pct(trims.master)}
          onChange={(v) => setTrimValue({ master: v / 100 })}
        />
        <Fader
          label="Pars"
          value={Math.round(trims.par * 100)}
          displayValue={pct(trims.par)}
          onChange={(v) => setTrimValue({ par: v / 100 })}
        />
        <Fader
          label="Heads"
          value={Math.round(trims.head * 100)}
          displayValue={pct(trims.head)}
          onChange={(v) => setTrimValue({ head: v / 100 })}
        />
        {/* The lights are drawn for what you HEAR, not for where the decoder
            is — those differ by the output buffer, which is tens of
            milliseconds wired and can be a third of a second over Bluetooth.
            The device is asked, but plenty of them under-report or say nothing,
            so this is the ear's correction on top. */}
        <Fader
          label="Sync"
          value={Math.round(syncNudge * 1000)}
          min={-Math.round(SYNC_NUDGE_LIMIT * 1000)}
          max={Math.round(SYNC_NUDGE_LIMIT * 1000)}
          displayValue={`${syncNudge >= 0 ? "+" : ""}${Math.round(syncNudge * 1000)} ms`}
          hint={
            syncLatency > 0
              ? `device reports ${Math.round(syncLatency * 1000)} ms; this nudges on top · + holds the lights back`
              : "your device does not report its latency · + holds the lights back"
          }
          onChange={(v) => setSyncNudge(v / 1000)}
        />
        <Fader
          label="How much"
          value={w !== null && w !== undefined ? Math.round(w * 100) : 50}
          displayValue={wantDisplay}
          hint={
            swapping
              ? "rebuilding… the running show keeps playing until the next bar"
              : "restrained → maximal · rebuilds the plan, changes on the next bar"
          }
          onChange={() => {
            /* appetite changes trigger a rebuild — handled by parent */
          }}
        />
      </div>
    </div>
  );
}
