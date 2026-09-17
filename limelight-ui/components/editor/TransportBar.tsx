"use client";

import { familyHue } from "@/lib/tokens";
import { beatsLabel, mmss, mmssms, positionAt } from "@/lib/grid";
import type { Clip, Grid } from "@/lib/types";
import type { SnapStrength } from "@/lib/snap";
import { Menu } from "@/components/primitives/Menu";
import { GUIDES, type GuideKind } from "./Guides";

/* One control system for the whole bar. Before this it carried five text sizes
   and eight button styles, so nothing read as more or less important than
   anything else. */

const H = "h-[24px]";
const LABEL = "text-[11px] tracking-[0.06em]";
const BASE =
  `inline-flex items-center justify-center ${H} rounded-[4px] border border-solid ` +
  `cursor-pointer whitespace-nowrap transition-colors duration-[var(--dur-state)] ` +
  `disabled:cursor-default disabled:opacity-40`;

/** ⌘ on a Mac, Ctrl everywhere else. A shortcut list that names the wrong key
 *  is worse than none: it teaches the chord that does not work. */
const MOD =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)
    ? "⌘"
    : "Ctrl+";

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
      ? "text-ink"
      : "border-transparent bg-transparent text-ink-dim hover:text-ink hover:bg-white/[0.04]";
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
const Rule = () => <span className="w-px h-[14px] bg-white/[0.06] flex-none" />;

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
  note,
  clipCount,
  snap,
  onSetSnap,
  guides,
  onToggleGuide,
  follow,
  onToggleFollow,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onCopy,
  onCut,
  onPaste,
  onDuplicate,
  canPaste,
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
  /** A short-lived receipt for a keystroke that leaves no mark on screen. */
  note: string | null;
  clipCount: number;
  snap: SnapStrength;
  onSetSnap: (snap: SnapStrength) => void;
  guides: GuideKind[];
  onToggleGuide: (kind: GuideKind) => void;
  follow: boolean;
  onToggleFollow: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  canPaste: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}) {
  const pos = positionAt(currentTime, grid);
  const one = selected.length === 1 ? selected[0] : null;
  const has = selected.length > 0;

  return (
    <div className="flex-none flex items-center gap-[var(--spacing-s3)] px-[var(--spacing-s3)] h-[38px] border-b border-solid border-white/[0.05] bg-bg">
      {/* playback */}
      <Btn onClick={onToggle} icon active={playing} title={playing ? "Pause (space)" : "Play (space)"}>
        <span aria-hidden>{playing ? "❚❚" : "▶"}</span>
        <span className="sr-only">{playing ? "Pause" : "Play"}</span>
      </Btn>

      {/* Milliseconds on the playhead and whole seconds on the length. The
          playhead is the thing you are placing AGAINST, so it is read at the
          resolution you can place at; the song's length is just how far there
          is to go. */}
      <span className={`mono ${LABEL} tabular-nums text-ink`} title="Playhead · song length">
        {mmssms(currentTime)}
        <span className="text-ink-dimmer"> / {mmss(duration)}</span>
      </span>

      <Rule />

      <span className={`mono ${LABEL} tabular-nums text-ink-dim`}>
        bar <span className="text-ink">{pos ? pos.bar : "—"}</span>
        <span className="text-ink-dimmer">·{pos ? pos.beat : "—"}</span>
      </span>

      <span className="flex-1 min-w-0" />

      {/* A copy, a cut, a paste and a fine nudge all leave nothing visible on a
          38px bar, and a keystroke with no answer reads as a dead key. The
          receipt gets its own slot rather than sharing the one below, which
          only shows when NOTHING is selected — where a copy never is. */}
      {note && <span className={`${LABEL} text-ink flex-none`}>{note}</span>}

      {/* what is selected, or what the timeline is doing */}
      {has ? (
        <span className="flex items-center gap-[var(--spacing-s2)] min-w-0">
          <span
            className="w-[7px] h-[7px] rounded-full flex-none"
            style={{ background: familyHue(selected[0].family) }}
          />
          <span className={`${LABEL} text-ink truncate`} title={one ? `${one.name} at ${mmssms(one.startS)}` : undefined}>
            {one
              ? `${one.name} · ${mmssms(one.startS)} · ${beatsLabel(one.beats)}b`
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
        <span className="flex items-center gap-[6px]">
          <span className="w-[6px] h-[6px] rounded-full bg-accent animate-pulse-bar flex-none" />
          <span className={`${LABEL} text-accent`}>Building…</span>
        </span>
      ) : clipCount > 0 ? (
        <span className={`${LABEL} text-ink-dim`}>
          <span className="tabular-nums text-ink font-medium">{clipCount}</span>{" "}
          effect{clipCount === 1 ? "" : "s"}
        </span>
      ) : (
        <span className={`${LABEL} text-ink-dimmer`}>—</span>
      )}

      <Rule />

      {/* Edit. Also the only place the keyboard half of this editor is written
          down — a shortcut nobody can discover is a shortcut nobody has. */}
      <Menu
        align="right"
        trigger={
          <span
            className={`${BASE} border-transparent bg-transparent text-ink-dim hover:text-ink hover:bg-bg-raised px-[8px] ${LABEL}`}
            title="Copy, paste and nudge the selection"
          >
            Edit ▾
          </span>
        }
        items={[
          /* Undo leads. It is the item people open this menu looking for, and
             the only one here that is worth reaching for when NOTHING is
             selected — which is also when the keyboard half of the editor is
             least likely to have been discovered. */
          { id: "undo", label: "Undo", hint: `${MOD}Z`, disabled: !canUndo },
          { id: "redo", label: "Redo", hint: `${MOD}\u21e7Z`, disabled: !canRedo },
          { id: "copy", label: "Copy", hint: `${MOD}C`, disabled: !has },
          { id: "cut", label: "Cut", hint: `${MOD}X`, disabled: removableCount === 0 },
          { id: "paste", label: "Paste where you clicked", hint: `${MOD}V`, disabled: !canPaste },
          { id: "duplicate", label: "Duplicate", hint: `${MOD}D`, disabled: !has },
          { id: "-nudge", label: "Move by a beat", hint: "← →", disabled: true },
          { id: "-bar", label: "…by a bar", hint: "⇧← →", disabled: true },
          { id: "-fine", label: "…by 10ms", hint: "⌥← →", disabled: true },
          { id: "-len", label: "Shorter / longer", hint: "[ ]", disabled: true },
          { id: "-del", label: "Remove", hint: "⌫", disabled: true },
        ]}
        onPick={(id) => {
          if (id === "undo") onUndo();
          else if (id === "redo") onRedo();
          else if (id === "copy") onCopy();
          else if (id === "cut") onCut();
          else if (id === "paste") onPaste();
          else if (id === "duplicate") onDuplicate();
        }}
      />

      {/* view controls */}

      {/* What the editor is ruled against. A toggle list rather than a choice:
          bars AND the drop is the pair you actually work between, and making
          that two trips to the same button would be absurd. */}
      <Menu
        align="right"
        keepOpen
        trigger={
          <span
            className={`${BASE} ${
              guides.length
                ? "text-ink"
                : "border-transparent bg-transparent text-ink-dim hover:text-ink hover:bg-white/[0.04]"
            } px-[8px] ${LABEL}`}
            title="Rule vertical lines through the timeline"
          >
            Grid: {guides.length === 0 ? "off" : guides.length === 1
              ? (GUIDES.find((g) => g.id === guides[0])?.label.toLowerCase() ?? "on")
              : guides.length} ▾
          </span>
        }
        items={GUIDES.map((g) => ({
          id: g.id,
          label: g.label,
          hint: g.hint,
          checked: guides.includes(g.id),
        }))}
        onPick={(id) => onToggleGuide(id as GuideKind)}
      />

      <Menu
        align="right"
        trigger={
          <span
            className={`${BASE} ${
              snap !== "off"
                ? "text-ink"
                : "border-transparent bg-transparent text-ink-dim hover:text-ink hover:bg-white/[0.04]"
            } px-[8px] ${LABEL}`}
            title="Where a clip lands when you drop or drag it"
          >
            Snap: {snap === "off" ? "free" : snap} ▾
          </span>
        }
        items={[
          { id: "bar", label: "Bar", hint: "and drops, sections" },
          { id: "beat", label: "Beat", hint: "finer" },
          /* Free is now genuinely free. The renderer is beat-locked in what it
             DRAWS — an effect's envelope is a function of the musical beat — but
             the baker takes a gesture's window in absolute seconds, so where a
             cue starts and how long it runs are exact. Rounding to the nearest
             beat here was giving away precision the show could already keep. */
          { id: "off", label: "Free", hint: "exact, to the ms" },
        ]}
        onPick={(id) => onSetSnap(id as SnapStrength)}
      />
      <Btn
        onClick={onToggleFollow}
        active={follow}
        title="Scroll the timeline to keep the playhead in view while the song plays"
      >
        Auto-scroll
      </Btn>
      <Btn onClick={onZoomOut} icon title="Zoom out">
        <span aria-hidden>−</span>
        <span className="sr-only">Zoom out</span>
      </Btn>
      <Btn onClick={onZoomIn} icon title="Zoom in (⌘-scroll over the timeline)">
        <span aria-hidden>+</span>
        <span className="sr-only">Zoom in</span>
      </Btn>
      <Btn onClick={onFit} title="Fit the whole song">
        Fit
      </Btn>
    </div>
  );
}
