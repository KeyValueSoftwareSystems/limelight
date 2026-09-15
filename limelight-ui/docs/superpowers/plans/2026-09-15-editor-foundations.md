# Timeline Editor Foundations (Plan 3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The pure, testable layer the timeline editor sits on — a real data fixture so the UI runs with no backend, the view maths that turns seconds into pixels and back, and an editor store with undo/redo.

**Architecture:** Three units with no React in them. `lib/fixture.ts` types a captured real show. `lib/timeline.ts` is pure view maths (time ↔ pixels ↔ bars, zoom, pan, tick density). `store/editor.ts` holds edits with an undo stack, selection, view and snap. Plan 3b builds the React surface on top.

**Tech Stack:** TypeScript 5, Zustand 5 (already a dependency), `node --test`. **No new dependencies.**

---

## UI only

The backend is another developer's responsibility. **Do not touch `portal/`, `readers/`, `hub/` or any Python/Node backend file.** Everything in this plan is inside `limelight-ui/`.

This is why the fixture exists: the editor must render fully from local data, and light up with live API data later without changing a component.

## No git commits

The user handles all git manually. **Do not run `git commit`, `git add`, `git stash`, `git reset`, `git checkout`, `git restore`, `git merge`, `git rebase`, or `git pull`.** Read-only `git status` / `git diff` are fine. The repo is mid-merge with ~133 staged paths that are not yours; never run a bare `git add .`.

## Where things are

One repo: `/home/muhammedmuzammil/Desktop/Projects/limelight-global/limelight`. The UI is the `limelight-ui/` subdirectory — run all `npm`/`npx` commands from there. All paths below are relative to it.

## State this builds on

- Plan 1: `lib/types.ts` (with `Edit`, `Clip`, `Family`, `ShowPlan`), `lib/families.ts`, `lib/clips.ts` (`buildClips`, `spanOf`, `overlaps`), `lib/snap.ts` (`resolveSnap`), `lib/grid.ts` (`makeGridClock`, `positionAt`, `mmss`, `clamp`).
- Plan 2: the dark token system, `lib/tokens.ts`, and ten primitives in `components/primitives/`.
- **48 tests pass; `npx tsc --noEmit` is clean.** Keep both true.
- `lib/fixture.show.json` already exists (19.2 KB, committed by the controller): a real bake of the song `levels` — 11 sections, 124 downbeats, 12 labelled moments, 125-value energy curve, and the arranger's plan (41 punctuation, 39 dynamics, 11 looks).

Import rules: `import type { … } from "./types"` needs **no** extension; value imports between `.ts` files **do** need `.ts`. JSON imports **must** carry `with { type: "json" }` — Node's test runner rejects them otherwise. Verified working in tsc, Turbopack and `node --test`.

The `MODULE_TYPELESS_PACKAGE_JSON` warning when testing is expected and harmless.

---

## Task 1: `lib/fixture.ts` — a real show, without a backend

**Files:**
- Create: `lib/fixture.test.ts`
- Create: `lib/fixture.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/fixture.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURE } from "./fixture.ts";
import { buildClips } from "./clips.ts";

test("the fixture is a coherent show", () => {
  assert.equal(FIXTURE.show.song, "levels");
  assert.ok(FIXTURE.show.duration_s! > 200);
  assert.equal(FIXTURE.show.grid.beats_per_bar, 4);
  assert.ok(FIXTURE.show.sections.length >= 10);
  assert.equal(FIXTURE.show.downbeats.length, 124);
});

test("it carries the musical detail the timeline draws", () => {
  assert.ok(FIXTURE.energy.length > 100);
  assert.ok(FIXTURE.show.moments.length >= 10);
  const m = FIXTURE.show.moments[0];
  assert.equal(typeof m.t, "number");
  assert.equal(typeof m.kind, "string");
});

test("it carries the arranger's plan", () => {
  const p = FIXTURE.show.plan;
  assert.ok(p, "no plan on the fixture");
  assert.ok(p!.punctuation.length > 30);
  assert.ok(p!.dynamics.length > 30);
  assert.equal(p!.looks.length, FIXTURE.show.sections.length);
});

test("every section start lands inside the show", () => {
  for (const s of FIXTURE.show.sections) {
    assert.ok(s.start >= 0 && s.end <= FIXTURE.show.duration_s! + 1, JSON.stringify(s));
    assert.ok(s.end > s.start);
  }
});

test("buildClips turns the fixture plan into ghost clips", () => {
  const clips = buildClips(FIXTURE.show.plan ?? null, [], FIXTURE.effects, FIXTURE.show.grid);
  assert.ok(clips.length > 20, `only ${clips.length} clips`);
  assert.ok(clips.every((c) => c.source === "auto"));
  assert.ok(clips.every((c) => c.startS < c.endS));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test` → FAIL, `Cannot find module` for `./fixture.ts`.

- [ ] **Step 3: Write the implementation**

Create `lib/fixture.ts`:

```ts
import type { Effect, Show } from "./types";
import raw from "./fixture.show.json" with { type: "json" };

/* A real bake of `levels` on the club16-2head rig, captured from the baker so
   the editor renders fully without a backend. The API returns this same shape;
   swapping to live data changes no component. */

/** The effect palette, mirroring portal/effects.json. Used until the API supplies it. */
const EFFECTS: Effect[] = [
  { id: "blackout", name: "Blackout", blurb: "The rig goes dark and stays dark.", fx: "blackout", beats: 4, params: { strength: 1 } },
  { id: "cut", name: "Cut", blurb: "The rig drops out for one beat.", fx: "blackout", beats: 1, params: { strength: 1 } },
  { id: "impact", name: "Impact", blurb: "The whole rig, white, on the beat.", fx: "white_blast", beats: 1, params: { strength: 1, tone: "white" } },
  { id: "flash", name: "Flash", blurb: "A white flick on the outer pair only.", fx: "white_blast", beats: 1, params: { strength: 0.9, coverage: "outer", tone: "white" } },
  { id: "stab", name: "Stab", blurb: "A hit on the centre pair, in the song's own colour.", fx: "white_blast", beats: 1, params: { strength: 0.9, coverage: "inner", tone: "key" } },
  { id: "cross", name: "Cross", blurb: "The hit crosses the room, lamp after lamp.", fx: "white_blast", beats: 2, params: { strength: 0.9, shape: "travel", spread: 0.5, tone: "white" } },
  { id: "swell", name: "Swell", blurb: "A wash that blooms and falls away.", fx: "white_blast", beats: 4, params: { strength: 0.85, shape: "swell", tone: "key" } },
  { id: "hush", name: "Hush", blurb: "Levels fall away and the head sinks toward the wall.", fx: "pause", beats: 4, params: { strength: 0.7 } },
  { id: "hook_lift", name: "Hook lift", blurb: "Lifts the whole rig and opens the head's prism.", fx: "hook", beats: 4, params: { strength: 0.9 } },
  { id: "riser", name: "Riser", blurb: "Colour washes toward white across the span.", fx: "whiten", beats: 8, params: { amount: 0.7 } },
  { id: "fill_flicker", name: "Fill flicker", blurb: "The pars strobe on the front of each beat.", fx: "accent_strobe", beats: 4, params: { strength: 0.9 } },
  { id: "exit_dip", name: "Exit dip", blurb: "Level and movement ease back together.", fx: "modulate", beats: 4, params: { gain: 0.7, motion: -0.3 } },
];

export interface Fixture {
  show: Show;
  energy: (number | null)[];
  title: string;
  effects: Effect[];
}

export const FIXTURE: Fixture = {
  show: raw as unknown as Show,
  energy: (raw as { energy: (number | null)[] }).energy,
  title: (raw as { title: string }).title,
  effects: EFFECTS,
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test` → `fail 0`, 53 tests (48 + 5).
Run: `npx tsc --noEmit` → no output.

> **Do not commit.**

---

## Task 2: `lib/timeline.ts` — the view maths

Every pixel the timeline draws comes from here. It is pure so the arithmetic can be proven without a browser, and because getting it subtly wrong is how a timeline ends up feeling untrustworthy.

Two conventions, fixed here and relied on everywhere after:
- A **view** is a window in seconds, `{from, to}`. It never extends past the song.
- Zoom is expressed as the visible **span**, not a level, so zooming anchored at the cursor is a straight span change plus a shift.

**Files:**
- Create: `lib/timeline.test.ts`
- Create: `lib/timeline.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/timeline.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { timeToX, xToTime, fit, clampView, zoomAt, panBy, barTicks, beatAtTime } from "./timeline.ts";
import type { Grid } from "./types";

const DUR = 240;
const GRID: Grid = { bpm: 120, beats_per_bar: 4, first_beat_s: 0 };
const W = 1000;

test("fit shows the whole song", () => {
  assert.deepEqual(fit(DUR), { from: 0, to: DUR });
});

test("time and pixels round-trip", () => {
  const v = { from: 60, to: 120 };
  for (const t of [60, 75, 90, 119.9]) {
    assert.ok(Math.abs(xToTime(timeToX(t, v, W), v, W) - t) < 1e-9, `round-trip failed at ${t}`);
  }
});

test("the left edge is x=0 and the right edge is the full width", () => {
  const v = { from: 10, to: 20 };
  assert.equal(timeToX(10, v, W), 0);
  assert.equal(timeToX(20, v, W), W);
});

test("a view is never allowed outside the song", () => {
  assert.deepEqual(clampView({ from: -50, to: 100 }, DUR, 1), { from: 0, to: 150 });
  assert.deepEqual(clampView({ from: 200, to: 400 }, DUR, 1), { from: 40, to: 240 });
});

test("a view never shrinks below the minimum span", () => {
  const v = clampView({ from: 10, to: 10.0001 }, DUR, 2);
  assert.ok(v.to - v.from >= 2);
});

test("zoom keeps the anchored time under the same pixel", () => {
  const v = { from: 0, to: DUR };
  const anchor = 90;
  const z = zoomAt(v, anchor, 0.5, DUR, 1);
  assert.ok(z.to - z.from < v.to - v.from, "did not zoom in");
  const before = timeToX(anchor, v, W);
  const after = timeToX(anchor, z, W);
  assert.ok(Math.abs(before - after) < 0.5, `anchor drifted ${before} -> ${after}`);
});

test("zooming out past the song just fits it", () => {
  const z = zoomAt({ from: 100, to: 140 }, 120, 100, DUR, 1);
  assert.deepEqual(z, { from: 0, to: DUR });
});

test("panning shifts the window and stops at the ends", () => {
  assert.deepEqual(panBy({ from: 10, to: 20 }, 5, DUR, 1), { from: 15, to: 25 });
  assert.deepEqual(panBy({ from: 0, to: 10 }, -5, DUR, 1), { from: 0, to: 10 });
  assert.deepEqual(panBy({ from: 230, to: 240 }, 5, DUR, 1), { from: 230, to: 240 });
});

test("beatAtTime is the inverse of the grid", () => {
  assert.equal(beatAtTime(0, GRID), 0);
  assert.equal(beatAtTime(2, GRID), 4);
});

test("bar ticks thin out as the view widens, and never crowd", () => {
  const wide = barTicks({ from: 0, to: 240 }, GRID, W);
  const tight = barTicks({ from: 0, to: 8 }, GRID, W);
  assert.ok(wide.length > 0 && tight.length > 0);
  assert.ok(wide.every((t, i, a) => i === 0 || t.bar > a[i - 1].bar), "bars not ascending");
  // at 1000px nothing should be closer than ~40px apart
  for (const ticks of [wide, tight]) {
    for (let i = 1; i < ticks.length; i++) {
      const gap = timeToX(ticks[i].t, { from: 0, to: ticks === wide ? 240 : 8 }, W)
                - timeToX(ticks[i - 1].t, { from: 0, to: ticks === wide ? 240 : 8 }, W);
      assert.ok(gap >= 39, `ticks only ${gap.toFixed(1)}px apart`);
    }
  }
});

test("every bar tick is a real downbeat", () => {
  const ticks = barTicks({ from: 0, to: 16 }, GRID, W);
  for (const t of ticks) {
    assert.ok(Math.abs(t.t - (t.bar - 1) * 2) < 1e-9, `bar ${t.bar} at ${t.t}`);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test` → FAIL, `Cannot find module` for `./timeline.ts`.

- [ ] **Step 3: Write the implementation**

Create `lib/timeline.ts`:

```ts
import type { Grid } from "./types";
import { makeGridClock, beatIndexAt, clamp } from "./grid.ts";

/** A window onto the song, in seconds. Never extends past the song. */
export interface View {
  from: number;
  to: number;
}

export function fit(duration: number): View {
  return { from: 0, to: duration };
}

export function timeToX(t: number, view: View, width: number): number {
  return ((t - view.from) / (view.to - view.from)) * width;
}

export function xToTime(x: number, view: View, width: number): number {
  return view.from + (x / width) * (view.to - view.from);
}

/** Keeps a view inside the song and no narrower than minSpan. */
export function clampView(view: View, duration: number, minSpan: number): View {
  let span = Math.min(Math.max(view.to - view.from, minSpan), duration);
  if (span >= duration) return { from: 0, to: duration };
  let from = clamp(view.from, 0, duration - span);
  return { from, to: from + span };
}

/** Zoom by `factor` (<1 zooms in) while holding `anchorT` under the same pixel. */
export function zoomAt(
  view: View, anchorT: number, factor: number, duration: number, minSpan: number,
): View {
  const span = view.to - view.from;
  const u = span === 0 ? 0 : (anchorT - view.from) / span;
  const next = Math.min(Math.max(span * factor, minSpan), duration);
  return clampView({ from: anchorT - u * next, to: anchorT - u * next + next }, duration, minSpan);
}

export function panBy(view: View, dt: number, duration: number, minSpan: number): View {
  return clampView({ from: view.from + dt, to: view.to + dt }, duration, minSpan);
}

/** Continuous beat index at a time — the inverse of the grid clock. */
export function beatAtTime(t: number, grid: Grid): number {
  return beatIndexAt(t, grid) ?? 0;
}

export interface BarTick {
  bar: number;
  t: number;
}

/* Labels thin out as the view widens. The step is chosen from a musical ladder
   (1, 2, 4, 8, 16 … bars) rather than an arbitrary number, so a tick is always
   a bar a musician would count to. */
const BAR_STEPS = [1, 2, 4, 8, 16, 32, 64, 128];
const MIN_TICK_PX = 40;

export function barTicks(view: View, grid: Grid, width: number): BarTick[] {
  const { secondsAtBar, bpb } = makeGridClock(grid);
  const secPerBar = (60 / grid.bpm) * bpb;
  const pxPerBar = (secPerBar / (view.to - view.from)) * width;
  const step = BAR_STEPS.find((s) => s * pxPerBar >= MIN_TICK_PX) ?? BAR_STEPS[BAR_STEPS.length - 1];

  const firstBar = Math.max(1, Math.floor(beatAtTime(view.from, grid) / bpb) + 1);
  const out: BarTick[] = [];
  for (let bar = firstBar - ((firstBar - 1) % step); ; bar += step) {
    const t = secondsAtBar(bar);
    if (t > view.to) break;
    if (t >= view.from && bar >= 1) out.push({ bar, t });
    if (out.length > 4096) break;
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test` → `fail 0`, 64 tests (53 + 11).
Run: `npx tsc --noEmit` → no output.

> **Do not commit.**

---

## Task 3: `store/editor.ts` — edits, history, selection, view

The store holds `Edit[]` as the only truth, plus the things the UI needs that are not derived: what is selected, where the view is, how snapping is set, which lanes are bypassed.

Undo/redo is a stack of `Edit[]` snapshots. They are small (a handful of objects), so snapshotting is simpler and more reliable than diffing, and it makes every mutation undoable by construction.

**Files:**
- Create: `store/editor.test.ts`
- Create: `store/editor.ts`

- [ ] **Step 1: Write the failing test**

Create `store/editor.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { useEditor } from "./editor.ts";

const reset = () => useEditor.getState().reset();
const S = () => useEditor.getState();

test("adding an edit records it and selects it", () => {
  reset();
  S().addEdit({ type: "stab", bar: 5, beats: 1 });
  assert.equal(S().edits.length, 1);
  assert.equal(S().edits[0].bar, 5);
});

test("undo restores the previous edit list", () => {
  reset();
  S().addEdit({ type: "stab", bar: 5, beats: 1 });
  S().addEdit({ type: "cut", bar: 9, beats: 2 });
  assert.equal(S().edits.length, 2);
  S().undo();
  assert.equal(S().edits.length, 1);
  S().undo();
  assert.equal(S().edits.length, 0);
});

test("undo past the beginning is a no-op, not a crash", () => {
  reset();
  S().undo();
  S().undo();
  assert.equal(S().edits.length, 0);
});

test("redo replays what undo removed", () => {
  reset();
  S().addEdit({ type: "stab", bar: 5, beats: 1 });
  S().undo();
  assert.equal(S().edits.length, 0);
  S().redo();
  assert.equal(S().edits.length, 1);
  assert.equal(S().edits[0].type, "stab");
});

test("a new edit after undo clears the redo branch", () => {
  reset();
  S().addEdit({ type: "stab", bar: 5, beats: 1 });
  S().undo();
  S().addEdit({ type: "cut", bar: 9, beats: 1 });
  S().redo();
  assert.equal(S().edits.length, 1);
  assert.equal(S().edits[0].type, "cut", "redo resurrected an abandoned branch");
});

test("updateEdit changes one edit in place and is undoable", () => {
  reset();
  S().addEdit({ type: "stab", bar: 5, beats: 1 });
  S().updateEdit(0, { bar: 9, beats: 4 });
  assert.equal(S().edits[0].bar, 9);
  assert.equal(S().edits[0].beats, 4);
  S().undo();
  assert.equal(S().edits[0].bar, 5);
});

test("removeEdit drops it and clears any selection pointing at it", () => {
  reset();
  S().addEdit({ type: "stab", bar: 5, beats: 1 });
  S().select(["mine:0"]);
  S().removeEdit(0);
  assert.equal(S().edits.length, 0);
  assert.deepEqual(S().selection, []);
});

test("selection is replaced by select and extended by addToSelection", () => {
  reset();
  S().select(["a"]);
  assert.deepEqual(S().selection, ["a"]);
  S().addToSelection("b");
  assert.deepEqual(S().selection, ["a", "b"]);
  S().addToSelection("b");
  assert.deepEqual(S().selection, ["a"], "clicking a selected clip should deselect it");
  S().select([]);
  assert.deepEqual(S().selection, []);
});

test("lane bypass toggles and is not part of undo history", () => {
  reset();
  S().addEdit({ type: "stab", bar: 1, beats: 1 });
  S().toggleBypass("hits");
  assert.deepEqual(S().bypass, ["hits"]);
  S().undo();
  assert.deepEqual(S().bypass, ["hits"], "bypass is a view setting, not an edit");
  S().toggleBypass("hits");
  assert.deepEqual(S().bypass, []);
});

test("view and snap are plain settings", () => {
  reset();
  S().setView({ from: 10, to: 20 });
  assert.deepEqual(S().view, { from: 10, to: 20 });
  S().setSnap("beat");
  assert.equal(S().snap, "beat");
});

test("editsForBake drops bypassed lanes without touching the real edit list", () => {
  reset();
  S().addEdit({ type: "stab", bar: 1, beats: 1 });   // hits
  S().addEdit({ type: "cut", bar: 2, beats: 1 });    // darkness
  S().toggleBypass("hits");
  const out = S().editsForBake();
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "cut");
  assert.equal(S().edits.length, 2, "bypass must not mutate the edit list");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test` → FAIL, `Cannot find module` for `./editor.ts`.

- [ ] **Step 3: Write the implementation**

Create `store/editor.ts`:

```ts
import { create } from "zustand";
import type { Edit, Family } from "../lib/types";
import type { View } from "../lib/timeline";
import type { SnapStrength } from "../lib/snap";
import { FIXTURE } from "../lib/fixture.ts";
import { familyOfFx } from "../lib/families.ts";

/* `Edit[]` is the only truth. Everything a timeline draws is derived from it,
   so undo is a stack of whole-list snapshots: edits are small, and snapshotting
   makes every mutation undoable by construction rather than by remembering to
   write an inverse. */

interface EditorState {
  edits: Edit[];
  past: Edit[][];
  future: Edit[][];

  selection: string[];
  view: View;
  snap: SnapStrength;
  bypass: Family[];
  playhead: number;
  playing: boolean;
}

interface EditorActions {
  addEdit: (edit: Edit) => void;
  updateEdit: (index: number, patch: Partial<Edit>) => void;
  removeEdit: (index: number) => void;
  setEdits: (edits: Edit[]) => void;

  undo: () => void;
  redo: () => void;

  select: (keys: string[]) => void;
  addToSelection: (key: string) => void;

  setView: (view: View) => void;
  setSnap: (snap: SnapStrength) => void;
  toggleBypass: (family: Family) => void;
  setPlayhead: (t: number) => void;
  setPlaying: (p: boolean) => void;

  /** What the baker should render: bypassed lanes simply do not send their
   *  edits, so the arranger's own contribution comes back in their place. */
  editsForBake: () => Edit[];

  reset: () => void;
}

const initial: EditorState = {
  edits: [],
  past: [],
  future: [],
  selection: [],
  view: { from: 0, to: FIXTURE.show.duration_s ?? 240 },
  snap: "bar",
  bypass: [],
  playhead: 0,
  playing: false,
};

export const useEditor = create<EditorState & EditorActions>((set, get) => ({
  ...initial,

  addEdit: (edit) =>
    set((s) => ({ past: [...s.past, s.edits], future: [], edits: [...s.edits, edit] })),

  updateEdit: (index, patch) =>
    set((s) => ({
      past: [...s.past, s.edits],
      future: [],
      edits: s.edits.map((e, i) => (i === index ? { ...e, ...patch } : e)),
    })),

  removeEdit: (index) =>
    set((s) => ({
      past: [...s.past, s.edits],
      future: [],
      edits: s.edits.filter((_, i) => i !== index),
      selection: [],
    })),

  setEdits: (edits) => set((s) => ({ past: [...s.past, s.edits], future: [], edits })),

  undo: () =>
    set((s) =>
      s.past.length === 0
        ? s
        : {
            edits: s.past[s.past.length - 1],
            past: s.past.slice(0, -1),
            future: [s.edits, ...s.future],
            selection: [],
          },
    ),

  redo: () =>
    set((s) =>
      s.future.length === 0
        ? s
        : {
            edits: s.future[0],
            past: [...s.past, s.edits],
            future: s.future.slice(1),
            selection: [],
          },
    ),

  select: (keys) => set({ selection: keys }),

  /** Clicking an already-selected clip removes it, which is what shift-click means. */
  addToSelection: (key) =>
    set((s) => ({
      selection: s.selection.includes(key)
        ? s.selection.filter((k) => k !== key)
        : [...s.selection, key],
    })),

  setView: (view) => set({ view }),
  setSnap: (snap) => set({ snap }),
  toggleBypass: (family) =>
    set((s) => ({
      bypass: s.bypass.includes(family)
        ? s.bypass.filter((f) => f !== family)
        : [...s.bypass, family],
    })),
  setPlayhead: (playhead) => set({ playhead }),
  setPlaying: (playing) => set({ playing }),

  editsForBake: () => {
    const { edits, bypass } = get();
    if (bypass.length === 0) return edits;
    const byId = new Map(FIXTURE.effects.map((e) => [e.id, e]));
    return edits.filter((e) => {
      const spec = byId.get(e.type);
      const fam = spec ? familyOfFx(spec.fx) : null;
      return !fam || !bypass.includes(fam);
    });
  },

  reset: () => set({ ...initial }),
}));
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test` → `fail 0`, 75 tests (64 + 11).
Run: `npx tsc --noEmit` → no output.

> **Why relative imports here.** Node's test runner does not read `tsconfig` path aliases, so `@/lib/...` would fail under `npm test`. Relative form works in both Node and Next. Value imports keep the `.ts` extension; type-only imports do not.

- [ ] **Step 5: Verify the app still builds**

Run: `npx next build` → `✓ Compiled successfully`.

> **Do not commit.**

---

## Self-review

**Coverage.** Spec §6.3 (`Edit[]` as the only truth, undo as snapshots) → Task 3. §5.7 navigation maths (zoom anchored at cursor, pan, fit) → Task 2. §5.2's bands need bar ticks and an energy curve → Tasks 1–2. §6.2's lane bypass as a client-side concern → `editsForBake` in Task 3.

**Deliberately deferred to Plan 3b.** Everything React: the editor route, bands, lanes, clips, playhead, transport, palette, drag/trim, inspector. Those need the pure layer proven first.

**Known risk, flagged in Task 3 Step 4.** `@/` path aliases work in Next but not in `node --test`. The plan names the fallback rather than leaving it to be discovered.

**Type consistency.** `View` comes from `lib/timeline.ts`; `SnapStrength` from `lib/snap.ts`; `Family` and `Edit` from `lib/types.ts`. `editsForBake` returns `Edit[]`, the same type the store holds. `reset()` restores the exact `initial` object every test relies on.
