# Timeline Editor — Rendering (Plan 3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the timeline editor visible — the song's structure, the arranger's show drawn as ghost clips in family lanes, a playhead you can scrub, and zoom that feels right. Read-only. Editing arrives in Plan 3c.

**Architecture:** One route renders an editor layout of four stacked regions. A `Timeline` container measures its own width and hands every child the same `(view, width)` so all bands stay aligned to one pixel mapping. Bands are dumb renderers over data from `lib/fixture.ts` + `lib/clips.ts`; all view maths lives in `lib/timeline.ts`, already proven.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, Zustand 5, Tailwind v4. **No new dependencies.**

---

## UI only, and no git

The backend belongs to another developer. **Do not touch `portal/`, `readers/`, `hub/` or any backend file.**

The user handles all git manually. **Do not run `git commit`, `git add`, `git stash`, `git reset`, `git checkout`, `git restore`, `git merge`, `git rebase` or `git pull`.** Read-only `git status`/`git diff` are fine. The repo is mid-merge with ~133 staged paths that are not yours; never run a bare `git add .`.

## Where things are

One repo: `/home/muhammedmuzammil/Desktop/Projects/limelight-global/limelight`. UI is the `limelight-ui/` subdirectory — run `npm`/`npx` from there. Paths below are relative to it.

## What this builds on

- **Plan 1** — `lib/types.ts` (`Edit`, `Clip`, `Family`, `ShowPlan`), `lib/families.ts` (`FAMILY_ORDER`, `familyOfFx`, `acceptsClips`, `FAMILY_LABEL`), `lib/clips.ts` (`buildClips`), `lib/snap.ts`, `lib/grid.ts` (`makeGridClock`, `mmss`, `clamp`).
- **Plan 2** — dark token system, `lib/tokens.ts` (`familyHue`, `phaseTint`), primitives in `components/primitives/`.
- **Plan 3a** — `lib/fixture.ts` (`FIXTURE`), `lib/timeline.ts` (`View`, `timeToX`, `xToTime`, `fit`, `clampView`, `zoomAt`, `panBy`, `barTicks`, `beatAtTime`), `store/editor.ts` (`useEditor`).

**Baseline: `npm test` passes 75, `npx tsc --noEmit` is clean, `npx next build` succeeds.** Keep all three true. This plan adds no tests — it is visual work, verified by looking, exactly as the design system was.

## Verified environment facts — do not re-derive

- Tailwind v4.3.3 via `@theme` in `app/globals.css`. No config file; do not create one.
- Token utilities available: `bg-bg`, `bg-bg-sunken`, `bg-bg-raised`, `bg-bg-overlay`, `text-ink`, `text-ink-dim`, `text-ink-dimmer`, `border-line`, `border-line-strong`, `text-ok`/`warn`/`danger`.
- CSS vars for metrics: `--ruler-h`, `--section-h`, `--energy-h`, `--moments-h`, `--lane-h`, `--lane-gap`, `--clip-radius`, `--handle-w`, `--snap-threshold`, `--hit`, `--dur-state`, `--ease`.
- Family hues come from `familyHue(family)` in `lib/tokens.ts`, never hardcoded. Phase tints from `phaseTint(phase)`.
- **Next skips route folders starting with `_`.** Do not create `app/_editor`.
- In Next 16 a page's `params` is a **Promise** and must be awaited in a server component.
- After deleting or renaming a route, re-run `next build` before `tsc` or stale `.next/types` produce phantom errors.
- A dev server is already running on **port 3002**. Do not start or kill one; view work at `http://localhost:3002`.

## The one rule that keeps the timeline honest

Every band — ruler, sections, energy, moments, lanes — receives **the same `view` and the same `width`** and maps time to pixels with `timeToX` from `lib/timeline.ts`. Nothing computes its own mapping. If one band drifts from the others, the whole thing stops being trustworthy, and that only stays true if there is one mapping.

---

## Task 1: The editor route and layout

Four stacked regions. The split between preview and timeline is draggable, because the preview and the timeline are each the thing you care about at different moments and a fixed ratio is always wrong for one of them.

**Files:**
- Create: `app/studio/edit/[song]/page.tsx`
- Create: `components/editor/EditorLayout.tsx`

- [ ] **Step 1: The route**

Create `app/studio/edit/[song]/page.tsx`:

```tsx
import { EditorLayout } from "@/components/editor/EditorLayout";

/* In Next 16 params is a Promise. The editor itself is a client component; this
   server component exists only to unwrap the route param. */
export default async function EditSongPage({
  params,
}: {
  params: Promise<{ song: string }>;
}) {
  const { song } = await params;
  return <EditorLayout song={decodeURIComponent(song)} />;
}
```

- [ ] **Step 2: The layout**

Create `components/editor/EditorLayout.tsx`:

```tsx
"use client";

import { useCallback, useRef, useState } from "react";
import { FIXTURE } from "@/lib/fixture";
import { mmss } from "@/lib/grid";

const MIN_TIMELINE = 180;
const MIN_PREVIEW = 160;

export function EditorLayout({ song }: { song: string }) {
  const [timelineH, setTimelineH] = useState(300);
  const bodyRef = useRef<HTMLDivElement>(null);

  /* Drag the divider. No easing anywhere near a pointer gesture. */
  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      const box = bodyRef.current?.getBoundingClientRect();
      if (!box) return;
      const next = box.bottom - ev.clientY;
      setTimelineH(Math.max(MIN_TIMELINE, Math.min(next, box.height - MIN_PREVIEW)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);

  const show = FIXTURE.show;

  return (
    <div className="h-screen flex flex-col bg-bg text-ink overflow-hidden">
      {/* header */}
      <header className="flex-none flex items-center gap-[var(--spacing-s4)] px-[var(--spacing-s5)] h-[52px] border-b border-solid border-line">
        <a
          href="/studio"
          className="text-[length:var(--text-sm)] text-ink-dim hover:text-ink no-underline transition-colors duration-[var(--dur-state)]"
        >
          ‹ Songs
        </a>
        <div className="flex items-baseline gap-[var(--spacing-s3)] min-w-0">
          <h1 className="text-[length:var(--text-lg)] font-medium truncate">{FIXTURE.title}</h1>
          <span className="mono text-[length:var(--text-xs)] text-ink-dim whitespace-nowrap">
            {Math.round(show.grid.bpm)} bpm · {show.grid.bars} bars · {mmss(show.duration_s ?? 0)}
          </span>
        </div>
        <span className="flex-1" />
        <span className="label">Designing for</span>
        <span className="text-[length:var(--text-sm)]">KeyCode Stage · {show.rig}</span>
      </header>

      <div ref={bodyRef} className="flex-1 min-h-0 flex flex-col">
        {/* palette | preview | inspector */}
        <div className="flex-1 min-h-0 flex">
          <aside className="flex-none w-[190px] border-r border-solid border-line overflow-y-auto p-[var(--spacing-s4)]">
            <div className="label">Effects</div>
          </aside>

          <main className="flex-1 min-w-0 p-[var(--spacing-s4)]">
            <div className="w-full h-full rounded-[7px] bg-[var(--stage)] border border-solid border-line flex items-center justify-center">
              <span className="text-[length:var(--text-xs)] text-ink-dimmer">stage preview</span>
            </div>
          </main>

          <aside className="flex-none w-[260px] border-l border-solid border-line overflow-y-auto p-[var(--spacing-s4)]">
            <div className="label">Inspector</div>
          </aside>
        </div>

        {/* divider */}
        <div
          onPointerDown={startResize}
          className="flex-none h-[7px] cursor-row-resize bg-bg border-y border-solid border-line hover:bg-bg-raised transition-colors duration-[var(--dur-state)]"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize timeline"
        />

        {/* timeline */}
        <section
          style={{ height: timelineH }}
          className="flex-none min-h-0 bg-bg-sunken overflow-hidden flex flex-col"
        >
          <div className="p-[var(--spacing-s4)] text-[length:var(--text-xs)] text-ink-dimmer">
            timeline · {song}
          </div>
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run `npx tsc --noEmit` (no output) and `npx next build` (`✓ Compiled successfully`, and `/studio/edit/[song]` appears in the route list as a dynamic route).

Open `http://localhost:3002/studio/edit/levels`. Confirm the header shows **Levels · 128 bpm · 124 bars · 3:57**, the three regions sit side by side, and dragging the divider resizes the timeline without the preview collapsing.

> **Do not commit.**

---

## Task 2: The timeline container and ruler

`Timeline` owns the width measurement and the view, and hands both to every child. This is the single mapping everything else obeys.

**Files:**
- Create: `components/editor/Timeline.tsx`
- Create: `components/editor/Ruler.tsx`
- Modify: `components/editor/EditorLayout.tsx`

- [ ] **Step 1: The container**

Create `components/editor/Timeline.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState, createContext, useContext } from "react";
import type { View } from "@/lib/timeline";

interface TimelineCtx {
  view: View;
  width: number;
  duration: number;
}

const Ctx = createContext<TimelineCtx | null>(null);

export function useTimeline(): TimelineCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTimeline must be used inside <Timeline>");
  return c;
}

/** Owns the one time→pixel mapping every band shares. */
export function Timeline({
  view,
  duration,
  children,
}: {
  view: View;
  duration: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className="relative w-full h-full overflow-hidden select-none">
      {width > 0 && (
        <Ctx.Provider value={{ view, width, duration }}>{children}</Ctx.Provider>
      )}
    </div>
  );
}
```

- [ ] **Step 2: The ruler**

Create `components/editor/Ruler.tsx`:

```tsx
"use client";

import { barTicks, timeToX } from "@/lib/timeline";
import { mmss } from "@/lib/grid";
import { useTimeline } from "./Timeline";
import type { Grid } from "@/lib/types";

/* Bars are the unit a musician counts in, so they lead. Time is secondary and
   only appears when there is room for it. */
export function Ruler({ grid }: { grid: Grid }) {
  const { view, width } = useTimeline();
  const ticks = barTicks(view, grid, width);

  return (
    <div className="relative h-[var(--ruler-h)] border-b border-solid border-line">
      {ticks.map((t) => {
        const x = timeToX(t.t, view, width);
        return (
          <div key={t.bar} className="absolute top-0 bottom-0" style={{ left: x }}>
            <span className="absolute top-0 bottom-0 w-px bg-line-strong" />
            <span className="absolute left-[5px] top-[3px] mono text-[length:var(--text-2xs)] text-ink-dim whitespace-nowrap">
              {t.bar}
            </span>
            <span className="absolute left-[5px] bottom-[2px] mono text-[9px] text-ink-dimmer whitespace-nowrap">
              {mmss(t.t)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Mount them**

In `components/editor/EditorLayout.tsx`, add imports:

```tsx
import { useEditor } from "@/store/editor";
import { Timeline } from "./Timeline";
import { Ruler } from "./Ruler";
```

Inside the component, before the `return`, add:

```tsx
  const view = useEditor((s) => s.view);
```

Replace the timeline `<section>`'s inner `<div>` (the `timeline · {song}` placeholder) with:

```tsx
          <Timeline view={view} duration={show.duration_s ?? 0}>
            <Ruler grid={show.grid} />
          </Timeline>
```

- [ ] **Step 4: Verify**

`npx tsc --noEmit`, `npx next build` — both clean.

At `http://localhost:3002/studio/edit/levels`: bar numbers march across the ruler starting at 1, each with a timecode beneath. Nothing should be crowded or overlapping.

> **Do not commit.**

---

## Task 3: The music — sections, energy, moments

This is the timeline's answer to a waveform. A video editor shows you the video; here we show the shape of the song, because that is what a creator is actually reacting to.

**Files:**
- Create: `components/editor/SectionBand.tsx`
- Create: `components/editor/EnergyBand.tsx`
- Create: `components/editor/MomentsBand.tsx`
- Modify: `components/editor/EditorLayout.tsx`

- [ ] **Step 1: Sections**

Create `components/editor/SectionBand.tsx`:

```tsx
"use client";

import { timeToX } from "@/lib/timeline";
import { phaseTint } from "@/lib/tokens";
import { useTimeline } from "./Timeline";
import type { Section } from "@/lib/types";

/* Tinted from the score's own phase context, at low chroma on purpose: sections
   are background, clips are foreground, and they must never compete. */
export function SectionBand({ sections }: { sections: Section[] }) {
  const { view, width } = useTimeline();

  return (
    <div className="relative h-[var(--section-h)] border-b border-solid border-line">
      {sections.map((s, i) => {
        const x0 = timeToX(s.start, view, width);
        const x1 = timeToX(s.end, view, width);
        if (x1 < 0 || x0 > width) return null;
        return (
          <div
            key={i}
            className="absolute top-0 bottom-0 overflow-hidden border-l border-solid border-line"
            style={{ left: x0, width: Math.max(1, x1 - x0), background: phaseTint(s.phase) }}
          >
            <span className="absolute left-[6px] top-[6px] text-[length:var(--text-2xs)] uppercase tracking-[0.12em] text-ink whitespace-nowrap">
              {s.name || "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Energy**

Create `components/editor/EnergyBand.tsx`:

```tsx
"use client";

import { timeToX } from "@/lib/timeline";
import { makeGridClock } from "@/lib/grid";
import { useTimeline } from "./Timeline";
import type { Grid } from "@/lib/types";

/* The score's per-bar intensity, drawn as a filled area. This is the closest
   thing the product has to a waveform, and it is where a creator's eye goes to
   find the lift. */
export function EnergyBand({ energy, grid }: { energy: (number | null)[]; grid: Grid }) {
  const { view, width } = useTimeline();
  const { secondsAtBar } = makeGridClock(grid);
  const H = 28;

  const pts: string[] = [];
  for (let i = 0; i < energy.length; i++) {
    const v = energy[i];
    if (v === null || v === undefined) continue;
    const t = secondsAtBar(i + 1);
    if (t < view.from - 5 || t > view.to + 5) continue;
    pts.push(`${timeToX(t, view, width).toFixed(1)},${(H - v * H).toFixed(1)}`);
  }

  return (
    <div className="relative h-[var(--energy-h)] border-b border-solid border-line bg-bg">
      {pts.length > 1 && (
        <svg width={width} height={H} className="absolute inset-0 pointer-events-none">
          <polygon
            points={`${pts[0].split(",")[0]},${H} ${pts.join(" ")} ${pts[pts.length - 1].split(",")[0]},${H}`}
            fill="var(--ink)"
            opacity="0.13"
          />
          <polyline points={pts.join(" ")} fill="none" stroke="var(--ink)" strokeOpacity="0.4" strokeWidth="1" />
        </svg>
      )}
      <span className="absolute left-[6px] top-[3px] label pointer-events-none">Energy</span>
    </div>
  );
}
```

- [ ] **Step 3: Moments**

Create `components/editor/MomentsBand.tsx`:

```tsx
"use client";

import { timeToX } from "@/lib/timeline";
import { useTimeline } from "./Timeline";
import type { Moment } from "@/lib/types";

/* The events the score itself found — where the drums enter, where the riff
   lands, where tension releases. These are the strongest "put something here"
   hints in the product, and in Plan 3c they become snap targets. */
export function MomentsBand({ moments }: { moments: Moment[] }) {
  const { view, width } = useTimeline();

  return (
    <div className="relative h-[var(--moments-h)] border-b border-solid border-line">
      {moments.map((m, i) => {
        const x = timeToX(m.t, view, width);
        if (x < -40 || x > width + 40) return null;
        const weight = m.weight ?? 0.5;
        return (
          <div
            key={i}
            className="absolute top-0 bottom-0 flex items-center gap-[3px] pointer-events-none"
            style={{ left: x }}
            title={`${m.kind}${m.what ? " · " + m.what : ""}`}
          >
            <span
              className="block rounded-full bg-ink flex-none"
              style={{ width: 3 + weight * 4, height: 3 + weight * 4, opacity: 0.35 + weight * 0.55 }}
            />
            <span className="text-[9px] text-ink-dim whitespace-nowrap">{m.what ?? m.kind}</span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Mount them**

In `EditorLayout.tsx`, import the three bands and place them after `<Ruler>`:

```tsx
            <SectionBand sections={show.sections} />
            <EnergyBand energy={FIXTURE.energy} grid={show.grid} />
            <MomentsBand moments={show.moments} />
```

- [ ] **Step 5: Verify**

`npx tsc --noEmit`, `npx next build` — clean.

At `/studio/edit/levels`: eleven section bands in tinted blocks with names (intro, drop, breakdown…), an energy curve that visibly rises into the drops, and twelve moment pins labelled `drums`, `the riff`, `tension`, `everything but bass`. **The section boundaries must line up exactly with the ruler's bar lines** — if they drift, a band is not using the shared mapping.

> **Do not commit.**

---

## Task 4: Lanes and clips

The point of the whole design. The arranger has already written ~41 pieces of punctuation; they appear as ghost clips in family lanes, and only the lanes actually in use are shown.

**Files:**
- Create: `components/editor/Clip.tsx`
- Create: `components/editor/Lane.tsx`
- Modify: `components/editor/EditorLayout.tsx`

- [ ] **Step 1: The clip**

Create `components/editor/Clip.tsx`:

```tsx
"use client";

import { timeToX } from "@/lib/timeline";
import { familyHue } from "@/lib/tokens";
import { useTimeline } from "./Timeline";
import type { Clip as ClipModel } from "@/lib/types";

/* Three states carry the whole story: a ghost is what the machine wrote, a solid
   clip is yours, and a struck-through ghost is one your clip has taken over. */
export function Clip({ clip, selected }: { clip: ClipModel; selected: boolean }) {
  const { view, width } = useTimeline();
  const x0 = timeToX(clip.startS, view, width);
  const x1 = timeToX(clip.endS, view, width);
  if (x1 < 0 || x0 > width) return null;

  const w = Math.max(3, x1 - x0);
  const hue = familyHue(clip.family);
  const mine = clip.source === "mine";

  return (
    <div
      className="absolute top-[2px] bottom-[2px] rounded-[var(--clip-radius)] overflow-hidden border border-solid"
      style={{
        left: x0,
        width: w,
        background: mine ? hue : "transparent",
        borderColor: hue,
        borderStyle: mine ? "solid" : "dashed",
        opacity: clip.overridden ? 0.3 : 1,
      }}
      title={`${clip.name} · bar ${clip.bar}${clip.beat > 1 ? "." + clip.beat : ""} · ${clip.beats} beats`}
    >
      {w > 26 && (
        <span
          className="absolute left-[5px] top-[2px] text-[9px] tracking-[0.06em] whitespace-nowrap pointer-events-none"
          style={{
            color: mine ? "var(--bg)" : hue,
            textDecoration: clip.overridden ? "line-through" : undefined,
          }}
        >
          {clip.name}
        </span>
      )}
      {selected && (
        <span className="absolute inset-0 border-2 border-solid rounded-[var(--clip-radius)] pointer-events-none" style={{ borderColor: "var(--select)" }} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: The lane**

Create `components/editor/Lane.tsx`:

```tsx
"use client";

import { FAMILY_LABEL } from "@/lib/families";
import { familyHue } from "@/lib/tokens";
import { Clip } from "./Clip";
import type { Clip as ClipModel, Family } from "@/lib/types";

export function Lane({
  family,
  clips,
  selection,
  bypassed,
  onToggleBypass,
}: {
  family: Family;
  clips: ClipModel[];
  selection: string[];
  bypassed: boolean;
  onToggleBypass: () => void;
}) {
  const mine = clips.filter((c) => c.source === "mine").length;

  return (
    <div className="flex border-b border-solid border-line" style={{ opacity: bypassed ? 0.4 : 1 }}>
      <div className="flex-none w-[96px] flex items-center gap-[6px] px-[var(--spacing-s2)] border-r border-solid border-line">
        <span className="w-[3px] h-[13px] rounded-full flex-none" style={{ background: familyHue(family) }} />
        <span className="text-[length:var(--text-2xs)] text-ink-dim truncate">{FAMILY_LABEL[family]}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onToggleBypass}
          aria-pressed={bypassed}
          title={bypassed ? "Include this lane" : "Hear the show without this lane"}
          className="mono text-[9px] text-ink-dimmer hover:text-ink bg-transparent border-0 cursor-pointer p-0"
        >
          {mine > 0 ? mine : "·"}
        </button>
      </div>
      <div className="relative flex-1 min-w-0" style={{ height: "var(--lane-h)" }}>
        {clips.map((c) => (
          <Clip key={c.key} clip={c} selected={selection.includes(c.key)} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Mount the lanes**

In `EditorLayout.tsx` add imports:

```tsx
import { useMemo } from "react";
import { buildClips } from "@/lib/clips";
import { clipFamilies } from "@/lib/families";
import { Lane } from "./Lane";
import { SectionBand } from "./SectionBand";
import { EnergyBand } from "./EnergyBand";
import { MomentsBand } from "./MomentsBand";
```

Inside the component, after the `view` line:

```tsx
  const edits = useEditor((s) => s.edits);
  const selection = useEditor((s) => s.selection);
  const bypass = useEditor((s) => s.bypass);
  const toggleBypass = useEditor((s) => s.toggleBypass);

  const clips = useMemo(
    () => buildClips(show.plan ?? null, edits, FIXTURE.effects, show.grid),
    [edits, show],
  );

  /* Only lanes in use are shown — a new show opens as one drop zone, not six
     empty rows — but a bypassed lane stays visible so it can be switched back. */
  const lanes = useMemo(
    () => clipFamilies().filter((f) => clips.some((c) => c.family === f) || bypass.includes(f)),
    [clips, bypass],
  );
```

and render after `<MomentsBand …/>`:

```tsx
            <div className="border-t-2 border-solid border-line-strong">
              {lanes.map((f) => (
                <Lane
                  key={f}
                  family={f}
                  clips={clips.filter((c) => c.family === f)}
                  selection={selection}
                  bypassed={bypass.includes(f)}
                  onToggleBypass={() => toggleBypass(f)}
                />
              ))}
            </div>
```

- [ ] **Step 4: Verify**

`npx tsc --noEmit`, `npx next build` — clean.

At `/studio/edit/levels` you should now see the arranger's show: **several lanes (Hits, Darkness, Lift, Breath, Wash, Strobe), each holding dashed ghost clips in that lane's hue**, roughly 41 in total. Lane hues must match the design system. Clicking a lane's count toggles its bypass and dims it.

> **Do not commit.**

---

## Task 5: Playhead, scrubbing and transport

**Files:**
- Create: `components/editor/Playhead.tsx`
- Create: `components/editor/Transport.tsx`
- Modify: `components/editor/Timeline.tsx`, `components/editor/EditorLayout.tsx`

- [ ] **Step 1: The playhead**

Create `components/editor/Playhead.tsx`:

```tsx
"use client";

import { timeToX } from "@/lib/timeline";
import { useTimeline } from "./Timeline";

/* One high-contrast neutral, never a hue — it has to win against every family
   colour underneath it. Positioned directly, never CSS-transitioned. */
export function Playhead({ t }: { t: number }) {
  const { view, width } = useTimeline();
  const x = timeToX(t, view, width);
  if (x < 0 || x > width) return null;
  return (
    <div className="absolute top-0 bottom-0 pointer-events-none z-20" style={{ left: x }}>
      <span className="absolute top-0 bottom-0 w-[2px] -ml-px" style={{ background: "var(--playhead)" }} />
      <span
        className="absolute top-0 -ml-[5px] w-[10px] h-[10px]"
        style={{ background: "var(--playhead)", clipPath: "polygon(0 0, 100% 0, 50% 100%)" }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Scrubbing on the ruler**

In `components/editor/Timeline.tsx`, extend the props and add a scrub handler. Replace the whole `Timeline` function with:

```tsx
export function Timeline({
  view,
  duration,
  onScrub,
  children,
}: {
  view: View;
  duration: number;
  onScrub?: (t: number) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  /* Scrubbing lives on the ruler strip only. That frees a plain drag on the
     lanes for box-selection in Plan 3c. */
  const scrub = (e: React.PointerEvent) => {
    if (!onScrub || width === 0) return;
    const box = ref.current?.getBoundingClientRect();
    if (!box || e.clientY - box.top > 22) return;
    const at = (cx: number) =>
      onScrub(view.from + ((cx - box.left) / width) * (view.to - view.from));
    at(e.clientX);
    const move = (ev: PointerEvent) => at(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      ref={ref}
      onPointerDown={scrub}
      className="relative w-full h-full overflow-hidden select-none"
    >
      {width > 0 && (
        <Ctx.Provider value={{ view, width, duration }}>{children}</Ctx.Provider>
      )}
    </div>
  );
}
```

- [ ] **Step 3: The transport**

Create `components/editor/Transport.tsx`:

```tsx
"use client";

import { mmss, positionAt } from "@/lib/grid";
import { Button, IconButton } from "@/components/primitives";
import type { Grid } from "@/lib/types";

export function Transport({
  t,
  duration,
  grid,
  playing,
  onToggle,
  onFit,
  snap,
  onSnap,
}: {
  t: number;
  duration: number;
  grid: Grid;
  playing: boolean;
  onToggle: () => void;
  onFit: () => void;
  snap: string;
  onSnap: () => void;
}) {
  const pos = positionAt(t, grid);
  return (
    <div className="flex-none flex items-center gap-[var(--spacing-s3)] px-[var(--spacing-s4)] h-[42px] border-b border-solid border-line bg-bg">
      <IconButton label={playing ? "Pause" : "Play"} onClick={onToggle}>
        {playing ? "❚❚" : "▶"}
      </IconButton>
      <span className="mono text-[length:var(--text-sm)] tabular-nums">
        {mmss(t)} <span className="text-ink-dimmer">/ {mmss(duration)}</span>
      </span>
      <span className="mono text-[length:var(--text-xs)] text-ink-dim">
        bar {pos ? pos.bar : "—"}
        <span className="text-ink-dimmer">·{pos ? pos.beat : "—"}</span>
      </span>
      <span className="flex-1" />
      <Button variant="ghost" onClick={onSnap} title="Snapping granularity">
        snap: {snap}
      </Button>
      <Button variant="ghost" onClick={onFit}>Fit</Button>
    </div>
  );
}
```

- [ ] **Step 4: Wire them up**

In `EditorLayout.tsx`, import:

```tsx
import { Playhead } from "./Playhead";
import { Transport } from "./Transport";
import { fit } from "@/lib/timeline";
```

Add state pulls:

```tsx
  const playhead = useEditor((s) => s.playhead);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const playing = useEditor((s) => s.playing);
  const setPlaying = useEditor((s) => s.setPlaying);
  const setView = useEditor((s) => s.setView);
  const snap = useEditor((s) => s.snap);
  const setSnap = useEditor((s) => s.setSnap);
```

Put `<Transport …/>` directly above the `<Timeline>` (inside the timeline `<section>`), pass `onScrub={setPlayhead}` to `<Timeline>`, and render `<Playhead t={playhead} />` as the **last** child inside `<Timeline>`:

```tsx
          <Transport
            t={playhead}
            duration={show.duration_s ?? 0}
            grid={show.grid}
            playing={playing}
            onToggle={() => setPlaying(!playing)}
            onFit={() => setView(fit(show.duration_s ?? 0))}
            snap={snap}
            onSnap={() => setSnap(snap === "bar" ? "beat" : snap === "beat" ? "off" : "bar")}
          />
          <Timeline view={view} duration={show.duration_s ?? 0} onScrub={setPlayhead}>
            {/* …ruler, bands, lanes… */}
            <Playhead t={playhead} />
          </Timeline>
```

The `<Timeline>` needs to fill the remaining height, so give its wrapper `className="flex-1 min-h-0"`.

- [ ] **Step 5: Verify**

`npx tsc --noEmit`, `npx next build` — clean.

At `/studio/edit/levels`: dragging on the **ruler strip** moves the playhead and the readout updates to the right bar and beat; dragging on the lanes does **not** scrub. `Fit` returns to the whole song. The snap button cycles bar → beat → off.

> **Do not commit.**

---

## Task 6: Zoom and pan

**Files:**
- Modify: `components/editor/Timeline.tsx`, `components/editor/EditorLayout.tsx`

- [ ] **Step 1: Wheel handling**

In `Timeline.tsx`, add `onZoom` and `onPan` props and a wheel handler. Add to the props type:

```tsx
  onZoom?: (anchorT: number, factor: number) => void;
  onPan?: (dt: number) => void;
```

and inside the component, before the `return`:

```tsx
  /* Ctrl/Cmd-scroll zooms about the cursor; a plain scroll pans. Both are
     continuous — the old four fixed zoom steps made close work impossible. */
  const wheel = (e: React.WheelEvent) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || width === 0) return;
    if (e.ctrlKey || e.metaKey) {
      if (!onZoom) return;
      e.preventDefault();
      const anchorT = view.from + ((e.clientX - box.left) / width) * (view.to - view.from);
      onZoom(anchorT, e.deltaY > 0 ? 1.15 : 0.87);
    } else if (onPan) {
      e.preventDefault();
      const span = view.to - view.from;
      onPan(((e.deltaX !== 0 ? e.deltaX : e.deltaY) / width) * span);
    }
  };
```

Add `onWheel={wheel}` to the outer `<div>`.

- [ ] **Step 2: Wire it**

In `EditorLayout.tsx`, import `zoomAt, panBy` from `@/lib/timeline` and pass:

```tsx
            onZoom={(anchorT, factor) =>
              setView(zoomAt(view, anchorT, factor, show.duration_s ?? 0, 1))
            }
            onPan={(dt) => setView(panBy(view, dt, show.duration_s ?? 0, 1))}
```

- [ ] **Step 3: Verify**

`npx tsc --noEmit`, `npx next build` — clean.

At `/studio/edit/levels`: ⌘/Ctrl-scroll zooms and **the time under the cursor stays under the cursor**; plain scroll pans and stops cleanly at both ends; bar labels thin out as you zoom out and never crowd; section boundaries stay locked to bar lines at every zoom level.

> **Do not commit.**

---

## Final pass

- [ ] Run `npm test` (75 pass), `npx tsc --noEmit` (clean), `npx next build` (compiles).
- [ ] Look at `http://localhost:3002/studio/edit/levels` and check, deliberately:
  1. Ruler bars, section boundaries and clips all agree at every zoom level.
  2. The energy curve visibly rises into the drops.
  3. Ghost clips read as the machine's work — dashed, unfilled — and are legible against their lane hue.
  4. Lane hues match the gallery at `/gallery`.
  5. Scrubbing is smooth, with no easing lag on the playhead.
  6. Nothing overlaps or clips at a narrow window width.

Report anything that looked wrong, with what you saw.

---

## Self-review

**Coverage.** Spec §5.1 layout → Task 1. §5.2 bands → Tasks 2–3. §5.2 lanes + §5.4 clip states → Task 4. §5.7 navigation → Tasks 5–6. Lane bypass (§6.2) → Task 4.

**Deferred to Plan 3c.** Drag-to-place from the palette, move, trim, snapping, selection, contextual toolbar, inspector, undo/redo keybindings, and the stage preview canvas. This plan is deliberately read-only so the rendering can be judged before interaction is layered on.

**Type consistency.** `View` from `lib/timeline.ts` throughout. `Clip`, `Family`, `Grid`, `Section`, `Moment` from `lib/types.ts`. `useTimeline()` is the only way a band learns `view`/`width`, which is what keeps every band on one mapping. `FAMILY_LABEL` and `clipFamilies` come from `lib/families.ts`; `familyHue`/`phaseTint` from `lib/tokens.ts`.
