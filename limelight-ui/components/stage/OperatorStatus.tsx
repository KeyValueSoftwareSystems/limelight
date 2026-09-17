"use client";

import { useEffect, useRef, useState } from "react";
import { usePortalStore } from "@/store/portal";
import { readFixtures, placeFixtures } from "@/lib/fixtures";
import { frameFor } from "@/lib/sync";
import type { AnchoredClock } from "@/hooks/useAnchoredClock";

function Row({ label, value, tone }: { label: string; value: string; tone?: "warn" | "ok" }) {
  return (
    <div className="flex items-baseline justify-between gap-[10px] py-[4px]">
      <span className="text-[11.5px] text-ink-dim truncate">{label}</span>
      <span
        className="mono text-[11.5px] tabular-nums flex-none"
        style={{ color: tone === "warn" ? "var(--warn)" : tone === "ok" ? "var(--ok)" : "var(--ink)" }}
      >
        {value}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-[16px] py-[12px] border-b border-solid border-white/[0.05]">
      <span className="block text-[11px] font-medium text-ink-dimmer mb-[6px]">{title}</span>
      {children}
    </section>
  );
}

/** What the rig is doing right now, which is the one thing a desk must show. */
export function OperatorStatus({
  clockRef,
  playing,
  currentTime,
}: {
  clockRef: React.RefObject<AnchoredClock | null>;
  playing: boolean;
  currentTime: number;
}) {
  const rig = usePortalStore((s) => s.rig);
  const show = usePortalStore((s) => s.show);
  const frames = usePortalStore((s) => s.frames);
  const limits = usePortalStore((s) => s.limits);
  const syncLatency = usePortalStore((s) => s.syncLatency);
  const syncNudge = usePortalStore((s) => s.syncNudge);

  /* A meter that only moves when React happens to render is not a meter, so the
     live position is pulled on an animation frame into state. The clock is read
     inside the effect, never during render. */
  const [liveT, setLiveT] = useState(currentTime);
  const clock = useRef(clockRef);
  clock.current = clockRef;

  useEffect(() => {
    if (!playing) { setLiveT(currentTime); return; }
    let raf = 0;
    const loop = () => {
      const pos = clock.current.current?.position();
      if (typeof pos === "number") setLiveT(pos);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, currentTime]);

  const place = show ? placeFixtures(show) : null;
  const t = playing ? liveT : currentTime;
  const state =
    show && frames && place
      ? readFixtures(
          frameFor(t, show.fps, show.frame_count, syncLatency + syncNudge),
          frames,
          show,
          place,
        )
      : null;

  const lamps = state?.lamps ?? [];
  const lit = lamps.filter((l) => l.k > 0.02);
  const peak = lamps.reduce((m, l) => Math.max(m, l.k), 0);
  const mean = lamps.length ? lamps.reduce((s, l) => s + l.k, 0) / lamps.length : 0;
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  const sending = !!rig?.sending;
  const reachable = !!rig?.can_send;

  return (
    <div className="h-full overflow-y-auto">
      <Section title="Output">
        <div className="flex items-end gap-[3px] h-[44px] mb-[8px]">
          {lamps.map((l, i) => (
            <span
              key={i}
              title={`${l.id} · ${pct(l.k)}`}
              className="flex-1 rounded-[2px] min-w-[2px]"
              style={{
                height: `${Math.max(3, l.k * 100)}%`,
                background: l.k > 0.02
                  ? `rgb(${Math.round(l.rgb[0] * 255)},${Math.round(l.rgb[1] * 255)},${Math.round(l.rgb[2] * 255)})`
                  : "rgba(255,255,255,0.07)",
              }}
            />
          ))}
          {lamps.length === 0 && (
            <span className="text-[11px] text-ink-dimmer">No frames loaded</span>
          )}
        </div>
        <Row label="Lit" value={`${lit.length} of ${lamps.length}`} />
        <Row label="Peak" value={pct(peak)} tone={peak > 0.97 ? "warn" : undefined} />
        <Row label="Average" value={pct(mean)} />
      </Section>

      <Section title="Rig">
        <Row
          label="State"
          value={sending ? "Sending" : reachable ? "Armed" : "Offline"}
          tone={sending ? "ok" : reachable ? undefined : "warn"}
        />
        <Row label="Frames sent" value={(rig?.frames_sent ?? 0).toLocaleString()} />
        {rig?.gateway && <Row label="Gateway" value={rig.gateway} />}
        {rig?.universe != null && <Row label="Universe" value={String(rig.universe)} />}
        <Row
          label="Sync offset"
          value={`${Math.round((syncLatency + syncNudge) * 1000)} ms`}
        />
      </Section>

      {limits && (
        <Section title="Venue limits">
          <Row label="Max par" value={pct(limits.max_intensity.par)} />
          <Row label="Max head" value={pct(limits.max_intensity.head)} />
          <Row
            label="Strobe"
            value={limits.strobe.allowed ? `Up to ${limits.strobe.max} Hz` : "Not allowed"}
            tone={limits.strobe.allowed ? undefined : "warn"}
          />
          {limits.keep_out.map((k) => (
            <Row key={k.name} label={`Keep out · ${k.name}`} value={`${k.from}\u00b0 to ${k.to}\u00b0`} />
          ))}
          {!!limits.frames_clamped && (
            <Row
              label="Frames clamped"
              value={limits.frames_clamped.toLocaleString()}
              tone="warn"
            />
          )}
        </Section>
      )}
    </div>
  );
}
