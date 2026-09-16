"use client";

import { familyHue } from "@/lib/tokens";
import { mmss, positionAt } from "@/lib/grid";
import type { Clip, Grid } from "@/lib/types";
import type { SnapStrength } from "@/lib/snap";
import { Menu } from "@/components/primitives/Menu";

/* One control system for the whole bar. Before this it carried five text sizes
   and eight button styles, so nothing read as more or less important than
   anything else. */

const H = "h-[24px]";
const LABEL = "text-[11px] tracking-[0.06em]";
const BASE =
  `inline-flex items-center justify-center ${H} rounded-[4px] border border-solid ` +
  `cursor-pointer whitespace-nowrap transition-colors duration-[var(--dur-state)] ` +
  `disabled:cursor-default disabled:opacity-40`;

function Btn({
  children,
  onClick,
  title,
  active,
  danger,
  icon,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
  active?: boolean;
  danger?: boolean;
  icon?: boolean;
  disabled?: boolean;
}) {
  const tone = danger
    ? "border-danger text-danger bg-transparent hover:bg-danger hover:text-bg disabled:hover:bg-transparent disabled:hover:text-danger"
    : active
      ? "border-line-strong bg-bg-raised text-ink"
      : "border-transparent bg-transparent text-ink-dim hover:text-ink hover:bg-bg-raised";
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      aria-pressed={active}
      className={`${BASE} ${tone} ${icon ? "w-[24px]" : "px-[8px]"} ${LABEL}`}
    >
      {children}
    </button>
  );
}

/** A hairline between groups of controls, so the bar reads in zones. */
const Rule = () => <span className="w-px h-[14px] bg-line flex-none" />;

export function TransportBar({
  currentTime,
  duration,
  grid,
  playing,
  onToggle,
  selected,
  removableCount,
  onRemove,
  onClearSelection,
  baking,
  clipCount,
  snap,
  onSetSnap,
  follow,
  onToggleFollow,
  onZoomIn,
  onZoomOut,
  onFit,
}: {
  currentTime: number;
  duration: number;
  grid: Grid;
  playing: boolean;
  onToggle: () => void;
  selected: Clip[];
  removableCount: number;
  onRemove: () => void;
  onClearSelection: () => void;
  baking: string | null;
  clipCount: number;
  snap: SnapStrength;
  onSetSnap: (snap: SnapStrength) => void;
  follow: boolean;
  onToggleFollow: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}) {
  const pos = positionAt(currentTime, grid);
  const one = selected.length === 1 ? selected[0] : null;

  return (
    <div className="flex-none flex items-center gap-[var(--spacing-s3)] px-[var(--spacing-s3)] h-[38px] border-b border-solid border-line bg-bg">
      {/* playback */}
      <Btn onClick={onToggle} icon active={playing} title={playing ? "Pause (space)" : "Play (space)"}>
        <span aria-hidden>{playing ? "❚❚" : "▶"}</span>
        <span className="sr-only">{playing ? "Pause" : "Play"}</span>
      </Btn>

      <span className={`mono ${LABEL} tabular-nums text-ink`}>
        {mmss(currentTime)}
        <span className="text-ink-dimmer"> / {mmss(duration)}</span>
      </span>

      <Rule />

      <span className={`mono ${LABEL} tabular-nums text-ink-dim`}>
        bar <span className="text-ink">{pos ? pos.bar : "—"}</span>
        <span className="text-ink-dimmer">·{pos ? pos.beat : "—"}</span>
      </span>

      <span className="flex-1 min-w-0" />

      {/* what is selected, or what the timeline is showing */}
      {selected.length > 0 ? (
        <span className="flex items-center gap-[var(--spacing-s2)] min-w-0">
          <span
            className="w-[7px] h-[7px] rounded-full flex-none"
            style={{ background: familyHue(selected[0].family) }}
          />
          <span className={`${LABEL} text-ink truncate`}>
            {one
              ? `${one.name} · bar ${one.bar}${one.beat > 1 ? "·" + one.beat : ""} · ${one.beats}b`
              : `${selected.length} selected`}
          </span>
          <Btn
            onClick={onRemove}
            danger
            disabled={removableCount === 0}
            title={
              removableCount === 0
                ? "Written by the arranger — drag or trim it to make it yours, then it can be removed"
                : "Remove (⌫)"
            }
          >
            Remove
          </Btn>
          <Btn onClick={onClearSelection} icon title="Clear selection (Esc)">
            <span aria-hidden>×</span>
            <span className="sr-only">Clear selection</span>
          </Btn>
        </span>
      ) : baking ? (
        <span className={`${LABEL} text-ink-dimmer`}>{baking}</span>
      ) : (
        <span className={`${LABEL} text-ink-dimmer`}>
          {clipCount} effect{clipCount === 1 ? "" : "s"}
        </span>
      )}

      <Rule />

      {/* view controls */}
      <Menu
        align="right"
        trigger={
          <span
            className={`${BASE} ${
              snap !== "off"
                ? "border-line-strong bg-bg-raised text-ink"
                : "border-transparent bg-transparent text-ink-dim hover:text-ink hover:bg-bg-raised"
            } px-[8px] ${LABEL}`}
            title="Where a clip lands when you drop or drag it"
          >
            snap: {snap === "off" ? "free" : snap} ▾
          </span>
        }
        items={[
          { id: "bar", label: "Bar", hint: "and drops, sections" },
          { id: "beat", label: "Beat", hint: "finer" },
          /* Not "exactly where you drop": the renderer is beat-locked (readers/
             lights/frame.js) and the bake rounds the beat, so a clip drawn
             between two beats would be a picture of something the lights cannot
             do. Free means the nearest beat with nothing pulling at it. */
          { id: "off", label: "Free", hint: "nearest beat, no pull" },
        ]}
        onPick={(id) => onSetSnap(id as SnapStrength)}
      />
      <Btn
        onClick={onToggleFollow}
        active={follow}
        title="Scroll the timeline to keep the playhead in view while the song plays"
      >
        auto-scroll
      </Btn>
      <Btn onClick={onZoomOut} icon title="Zoom out">
        <span aria-hidden>−</span>
        <span className="sr-only">Zoom out</span>
      </Btn>
      <Btn onClick={onZoomIn} icon title="Zoom in">
        <span aria-hidden>+</span>
        <span className="sr-only">Zoom in</span>
      </Btn>
      <Btn onClick={onFit} title="Fit the whole song">
        fit
      </Btn>
    </div>
  );
}
