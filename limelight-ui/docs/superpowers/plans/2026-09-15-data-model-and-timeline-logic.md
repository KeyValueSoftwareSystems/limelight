# Data Model and Timeline Logic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the bake contract so effects can start on any beat, carry their own dials, and suppress the arranger — then build and prove the pure frontend logic that turns a plan plus a list of edits into the clips a timeline draws.

**Architecture:** Four additive backend changes to `limelight/portal/` (`server.py`, `effects.js`), then three pure, dependency-free TypeScript modules in `limelight-ui/lib/` — `families.ts` (renderer type ↔ lane), `clips.ts` (plan + edits → `Clip[]`), `snap.ts` (musical snap resolution). No UI is built in this plan. Everything here is verifiable by running tests, which is the point: this is the layer where subtle wrongness hides.

**Tech Stack:** Python 3.12 (stdlib only), Node 24 (CommonJS, no deps), TypeScript 5 via Node 24's native type stripping, `node --test` (no test framework dependency).

---

## Scope note — this is plan 1 of 5

The spec (`docs/superpowers/specs/2026-09-15-studio-timeline-redesign-design.md`) covers two surfaces, nine screens, a full timeline editor, four backend changes and a design system. That is too much for one plan. Following the spec's own §11 staging, it is split into five, each producing working, testable software:

| Plan | Covers | Spec sections |
|---|---|---|
| **1 — Data model and timeline logic** (this plan) | Backend B1–B4; `lib/families.ts`, `lib/clips.ts`, `lib/snap.ts`; test infrastructure | §6, §9 |
| 2 — Design system foundations | Tokens, density modes, component set | §7 |
| 3 — Shell and IA | Routes, surfaces, Songs / My shows / Market / Venues, error and empty states | §4, §8 |
| 4 — Timeline rendering and editing | Ruler, bands, lanes, clips, drag, trim, snap, undo, inspector | §5 |
| 5 — Booth | Run console, rig screens at booth density | §4 (Booth) |

Plan 1 comes first because it is the riskiest work and everything else depends on
its contract. It touches no UI, so it can be verified completely on its own.

---

## Environment facts (verified, do not re-derive)

- `node --version` → **v24.15.0**. TypeScript type stripping is on by default, so `node --test "lib/**/*.test.ts"` runs `.ts` tests with **no test framework and no build step**.
- Value imports between `.ts` files **must carry the `.ts` extension** for Node to resolve them (`import { clamp } from "./grid.ts"`). This requires `allowImportingTsExtensions: true` in `tsconfig.json` (Task 1). Verified: `npx tsc --noEmit` is clean and `npx next build` succeeds with Turbopack.
- `import type { … } from "./types"` needs **no** extension — type-only imports are erased before resolution.
- Running tests prints a `MODULE_TYPELESS_PACKAGE_JSON` warning. It is harmless. Do **not** fix it by adding `"type": "module"` to `package.json` — that would change how `next.config.ts` and the PostCSS/ESLint configs are loaded.
- `limelight/portal/server.py` imports cleanly in-process (`import server` works; `main()` is behind `if __name__ == "__main__"`), so Python tests call its functions directly.
- Backend test idiom: `readers/lights/*.test.js` are plain CommonJS scripts with hand-rolled assertions; `*.test.py` are plain scripts with PASS/FAIL counters. Match these — do not introduce pytest or a JS test framework.
- The backend runs at `http://localhost:8800`. `limelight/hub/files/score/levels.score` exists and bakes.
- **The backend repo has ~48 paths of unrelated in-progress work staged** (`listen/gpu/*`, `hub/score_api.py`, `listen/call.py`) on branch `limelight-portal`. **Never run a bare `git add` + `git commit` there** — it would sweep that work into your commit. Every backend commit in this plan is scoped with `git commit -- <paths>`, which commits only the named files and leaves everything else staged exactly as it was. Do not "tidy up" that staged work.
- The UI repo is on branch `studio-redesign-data-model` with a clean tree. Commits there can use plain `git add` + `git commit`.

**Repository paths.** Two repos side by side:
- UI: `/home/muhammedmuzammil/Desktop/Projects/limelight-global/limelight-ui`
- Backend: `/home/muhammedmuzammil/Desktop/Projects/limelight-global/limelight`

Paths below are relative to whichever repo the file lives in; each task names it.

---

## File structure

**Backend** (`limelight/`)

| File | Responsibility |
|---|---|
| `portal/server.py` *(modify)* | `dial_filter()` (new, extracted); `validate_edits()` accepts `beat`/`params`/`off`; `describe_edits()` uses `beat`; `_bake()` passes `plan` through |
| `portal/effects.js` *(modify)* | Beat-level start; per-edit params merge; `off` suppression; calls `planFor` and writes `plan` |
| `portal/plan.js` *(create)* | `planFor()` — the arranger's punctuation, dynamics and base looks, converted into the page's bar numbering |
| `portal/edits.test.py` *(create)* | Tests for `dial_filter`, `validate_edits`, `describe_edits` |
| `portal/plan.test.js` *(create)* | Tests for the plan's bar-numbering bridge — the riskiest change in this plan |

**Frontend** (`limelight-ui/`)

| File | Responsibility |
|---|---|
| `tsconfig.json` *(modify)* | Allow `.ts` import extensions |
| `package.json` *(modify)* | `test` script |
| `lib/types.ts` *(modify)* | `Edit` gains `beat`/`params`/`off`; add `Family`, `Clip`, `ShowPlan` and friends; `Show.plan` |
| `lib/families.ts` *(create)* | Renderer fx type ↔ lane family ↔ labels. One source of truth for lanes |
| `lib/clips.ts` *(create)* | Beat-span maths, overlap, and `buildClips(plan, edits, catalogue, grid)` |
| `lib/snap.ts` *(create)* | Snap candidate generation and priority resolution |
| `lib/grid.test.ts` *(create)* | Characterisation tests for existing grid maths that `clips.ts` depends on |
| `lib/families.test.ts` *(create)* | |
| `lib/clips.test.ts` *(create)* | |
| `lib/snap.test.ts` *(create)* | |

---

## Task 1: Test infrastructure and grid characterisation

`lib/grid.ts` already exists and works. `clips.ts` will depend on its bar/beat
arithmetic, so pin that behaviour with tests before building on it. These tests
pass immediately — that is expected and correct. They are a safety net, not TDD.

**Files:**
- Modify: `limelight-ui/tsconfig.json`
- Modify: `limelight-ui/package.json`
- Create: `limelight-ui/lib/grid.test.ts`

- [ ] **Step 1: Allow `.ts` import extensions**

In `tsconfig.json`, add one line inside `compilerOptions`, directly after `"noEmit": true,`:

```json
    "allowImportingTsExtensions": true,
```

- [ ] **Step 2: Add the test script**

In `package.json`, in `"scripts"`, add:

```json
    "test": "node --test \"lib/**/*.test.ts\"",
```

The full scripts block should then read:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "node --test \"lib/**/*.test.ts\""
  },
```

- [ ] **Step 3: Write the grid characterisation tests**

Create `lib/grid.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeGridClock, positionAt, mmss, clamp } from "./grid.ts";
import type { Grid } from "./types";

const STEADY: Grid = { bpm: 120, beats_per_bar: 4, first_beat_s: 0 };

test("bar 1 beat 1 sits on the first beat", () => {
  const { secondsAtBar } = makeGridClock(STEADY);
  assert.equal(secondsAtBar(1), 0);
  assert.equal(secondsAtBar(2), 2);
  assert.equal(secondsAtBar(1, 3), 1);
});

test("first_beat_s offsets every bar", () => {
  const { secondsAtBar } = makeGridClock({ ...STEADY, first_beat_s: 4.8609 });
  assert.equal(+secondsAtBar(1).toFixed(4), 4.8609);
  assert.equal(+secondsAtBar(2).toFixed(4), 6.8609);
});

test("beats_per_bar defaults to 4", () => {
  const { bpb } = makeGridClock({ bpm: 120 });
  assert.equal(bpb, 4);
});

test("positionAt is 1-based in both bar and beat", () => {
  assert.deepEqual(positionAt(0, STEADY), { bar: 1, beat: 1 });
  assert.deepEqual(positionAt(0.5, STEADY), { bar: 1, beat: 2 });
  assert.deepEqual(positionAt(2, STEADY), { bar: 2, beat: 1 });
});

test("a tempo change moves every bar after it", () => {
  const g: Grid = {
    bpm: 120, beats_per_bar: 4, first_beat_s: 0,
    tempo: [
      { from_beat: 0, at_s: 0, bpm: 120 },
      { from_beat: 8, at_s: 4, bpm: 60 },
    ],
  };
  const { secondsAtBar } = makeGridClock(g);
  assert.equal(secondsAtBar(3), 4);
  assert.equal(secondsAtBar(4), 8);
});

test("mmss formats, and survives negatives and infinity", () => {
  assert.equal(mmss(0), "0:00");
  assert.equal(mmss(65), "1:05");
  assert.equal(mmss(-2), "-0:02");
  assert.equal(mmss(Infinity), "—");
});

test("clamp bounds both ends", () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(clamp(2, 0, 3), 2);
});
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: `pass 7`, `fail 0`. A `MODULE_TYPELESS_PACKAGE_JSON` warning is printed and is expected.

- [ ] **Step 5: Verify the build still passes**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
git add tsconfig.json package.json lib/grid.test.ts
git commit -m "test: node --test infrastructure and grid characterisation tests"
```

---

## Task 2: Extend the shared types

**Files:**
- Modify: `limelight-ui/lib/types.ts`

- [ ] **Step 1: Extend `Edit` and add the plan and clip types**

In `lib/types.ts`, replace the existing `Edit` interface:

```ts
export interface Edit {
  type: string;
  bar: number;
  beats: number;
}
```

with:

```ts
/** A creator's placement. `off: true` means "clear the arranger's assignments of
 *  this effect's renderer type across this span and place nothing". */
export interface Edit {
  type: string;
  bar: number;
  beat?: number;
  beats: number;
  params?: Record<string, unknown>;
  off?: true;
}
```

- [ ] **Step 2: Add the plan types**

Append to the `/* ── effects / edits ── */` section of `lib/types.ts`:

```ts
/* ── the arranger's own plan, exposed so the page can draw what it wrote ──── */

/** Bars here are in the PAGE's numbering. effects.js converts on the way out. */
export interface PlanPunctuation {
  id: string;
  fx: string;
  bar: number;
  beat: number;
  beats: number;
  params: Record<string, unknown>;
  context: string | null;
}

export interface PlanDynamics {
  bar: number;
  beats: number;
  gain: number;
  motion: number;
  doing: string | null;
}

export interface PlanLook {
  section: number;
  par: string | null;
  head: string | null;
}

export interface ShowPlan {
  punctuation: PlanPunctuation[];
  dynamics: PlanDynamics[];
  looks: PlanLook[];
}

/* ── lanes and clips (derived on the client, never persisted) ────────────── */

export type Family =
  | "hits" | "darkness" | "strobe" | "lift" | "breath" | "wash" | "dynamics";

/** `tile` and `fx` are separate on purpose. A clip a person placed knows both its
 *  palette tile (`stab`) and its renderer type (`white_blast`); one the arranger
 *  wrote only ever has the renderer type, because it was never a tile. */
export interface Clip {
  key: string;
  source: "auto" | "mine";
  editIndex: number | null;
  planId: string | null;
  family: Family;
  tile: string | null;
  fx: string;
  name: string;
  bar: number;
  beat: number;
  beats: number;
  startS: number;
  endS: number;
  params: Record<string, unknown>;
  overridden: boolean;
}
```

- [ ] **Step 3: Add `plan` to `Show`**

In the `Show` interface, after the `fixtures: Fixture[];` line, add:

```ts
  plan?: ShowPlan;
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no output. Nothing consumes the new fields yet, and every added field is optional, so existing code is unaffected.

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts
git commit -m "feat: extend Edit with beat/params/off, add plan and clip types"
```

---

## Task 3: `lib/families.ts` — lanes from renderer types

The seven renderer effect types are the single source of lane identity. This
module is the only place that mapping lives.

**Files:**
- Create: `limelight-ui/lib/families.ts`
- Create: `limelight-ui/lib/families.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/families.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FAMILY_ORDER, FAMILY_LABEL, FAMILY_AUTO_LABEL,
  familyOfFx, acceptsClips, clipFamilies,
} from "./families.ts";

/* Every renderer type the backend declares in server.py's DIALS map. If the
   backend gains one, this test fails until the lane exists. */
const RENDERER_TYPES = [
  "white_blast", "blackout", "pause", "hook", "whiten", "accent_strobe", "modulate",
];

test("every renderer type maps to a family", () => {
  for (const fx of RENDERER_TYPES) {
    assert.ok(familyOfFx(fx), `no family for ${fx}`);
  }
});

test("an unknown renderer type maps to null rather than throwing", () => {
  assert.equal(familyOfFx("laser_sweep"), null);
});

test("the mapping is one family per type, with no family left unused", () => {
  const mapped = new Set(RENDERER_TYPES.map(familyOfFx));
  assert.equal(mapped.size, FAMILY_ORDER.length);
  for (const f of FAMILY_ORDER) assert.ok(mapped.has(f), `${f} has no renderer type`);
});

test("dynamics holds a curve, so it never accepts a drop", () => {
  assert.equal(acceptsClips("dynamics"), false);
  assert.equal(acceptsClips("hits"), true);
});

test("six lanes accept clips", () => {
  assert.equal(clipFamilies().length, 6);
  assert.ok(!clipFamilies().includes("dynamics"));
});

test("every family has both labels", () => {
  for (const f of FAMILY_ORDER) {
    assert.equal(typeof FAMILY_LABEL[f], "string");
    assert.equal(typeof FAMILY_AUTO_LABEL[f], "string");
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module` for `./families.ts`.

- [ ] **Step 3: Write the implementation**

Create `lib/families.ts`:

```ts
import type { Effect, Family } from "./types";

/* The renderer resolves one effect per TYPE per beat (readers/lights/frame.js),
   so the renderer's type is what a lane is. Two clips of the same family can
   never overlap, because the engine could not honour it; different families
   always compose. The UI's rule is the engine's rule. */

export const FAMILY_ORDER: Family[] = [
  "hits", "darkness", "strobe", "lift", "breath", "wash", "dynamics",
];

const FX_TO_FAMILY: Record<string, Family> = {
  white_blast: "hits",
  blackout: "darkness",
  accent_strobe: "strobe",
  hook: "lift",
  pause: "breath",
  whiten: "wash",
  modulate: "dynamics",
};

export const FAMILY_LABEL: Record<Family, string> = {
  hits: "Hits",
  darkness: "Darkness",
  strobe: "Strobe",
  lift: "Lift",
  breath: "Breath",
  wash: "Wash",
  dynamics: "Dynamics",
};

/* What the arranger's own assignment is called when we draw it. It was never a
   palette tile, so it gets the family's own word rather than a tile name. */
export const FAMILY_AUTO_LABEL: Record<Family, string> = {
  hits: "Hit",
  darkness: "Blackout",
  strobe: "Strobe",
  lift: "Lift",
  breath: "Breath",
  wash: "Wash",
  dynamics: "Dynamics",
};

export function familyOfFx(fx: string): Family | null {
  return FX_TO_FAMILY[fx] ?? null;
}

export function familyOfEffect(effect: Effect): Family | null {
  return familyOfFx(effect.fx);
}

/** Dynamics is an envelope, not a stack of clips, so nothing drops onto it. */
export function acceptsClips(family: Family): boolean {
  return family !== "dynamics";
}

export function clipFamilies(): Family[] {
  return FAMILY_ORDER.filter(acceptsClips);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: `fail 0`. Six `families` tests plus the seven from Task 1.

- [ ] **Step 5: Commit**

```bash
git add lib/families.ts lib/families.test.ts
git commit -m "feat: map renderer effect types to timeline lane families"
```

---

## Task 4: `lib/clips.ts` — beat spans and overlap

The arithmetic every later task depends on. Bars and beats are 1-based
everywhere in this codebase; beat *indices* are 0-based. Keeping that boundary in
one tested place is the whole point of this task.

**Files:**
- Create: `limelight-ui/lib/clips.ts`
- Create: `limelight-ui/lib/clips.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/clips.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { spanOf, overlaps } from "./clips.ts";

test("bar 1 beat 1 is beat index 0", () => {
  assert.deepEqual(spanOf(1, 1, 4, 4), { from: 0, to: 4 });
});

test("a later bar starts a whole bar of beats further on", () => {
  assert.deepEqual(spanOf(2, 1, 1, 4), { from: 4, to: 5 });
  assert.deepEqual(spanOf(17, 1, 1, 4), { from: 64, to: 65 });
});

test("the beat within a bar offsets the start", () => {
  assert.deepEqual(spanOf(1, 3, 2, 4), { from: 2, to: 4 });
  assert.deepEqual(spanOf(2, 4, 1, 4), { from: 7, to: 8 });
});

test("beats_per_bar other than 4 is honoured", () => {
  assert.deepEqual(spanOf(2, 1, 3, 3), { from: 3, to: 6 });
});

test("overlap is half-open, so touching spans do not overlap", () => {
  assert.equal(overlaps({ from: 0, to: 4 }, { from: 4, to: 8 }), false);
  assert.equal(overlaps({ from: 4, to: 8 }, { from: 0, to: 4 }), false);
});

test("overlap catches partial and full containment either way round", () => {
  assert.equal(overlaps({ from: 0, to: 4 }, { from: 3, to: 8 }), true);
  assert.equal(overlaps({ from: 0, to: 8 }, { from: 3, to: 4 }), true);
  assert.equal(overlaps({ from: 3, to: 4 }, { from: 0, to: 8 }), true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module` for `./clips.ts`.

- [ ] **Step 3: Write the implementation**

Create `lib/clips.ts`:

```ts
/** A half-open range of beat indices. Beat indices are 0-based; the bars and
 *  beats they are built from are 1-based, as everywhere else in this codebase. */
export interface BeatSpan {
  from: number;
  to: number;
}

export function spanOf(bar: number, beat: number, beats: number, bpb: number): BeatSpan {
  const from = (bar - 1) * bpb + (beat - 1);
  return { from, to: from + beats };
}

/** Half-open, so a clip ending at beat 4 does not collide with one starting there. */
export function overlaps(a: BeatSpan, b: BeatSpan): boolean {
  return a.from < b.to && b.from < a.to;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/clips.ts lib/clips.test.ts
git commit -m "feat: beat-span arithmetic and half-open overlap"
```

---

## Task 5: `buildClips` — the clips a person placed

**Files:**
- Modify: `limelight-ui/lib/clips.ts`
- Modify: `limelight-ui/lib/clips.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `lib/clips.test.ts`:

```ts
import { buildClips } from "./clips.ts";
import type { Effect, Grid } from "./types";

const GRID: Grid = { bpm: 120, beats_per_bar: 4, first_beat_s: 0 };

const CATALOGUE: Effect[] = [
  { id: "stab", name: "Stab", blurb: "", fx: "white_blast", beats: 1,
    params: { strength: 0.9, coverage: "inner", tone: "key" } },
  { id: "cut", name: "Cut", blurb: "", fx: "blackout", beats: 1,
    params: { strength: 1 } },
];

test("an edit becomes a clip in its family's lane", () => {
  const clips = buildClips(null, [{ type: "stab", bar: 2, beats: 2 }], CATALOGUE, GRID);
  assert.equal(clips.length, 1);
  const c = clips[0];
  assert.equal(c.source, "mine");
  assert.equal(c.family, "hits");
  assert.equal(c.tile, "stab");
  assert.equal(c.fx, "white_blast");
  assert.equal(c.name, "Stab");
  assert.equal(c.editIndex, 0);
  assert.equal(c.bar, 2);
  assert.equal(c.beat, 1);
  assert.equal(c.beats, 2);
});

test("beat defaults to 1 when the edit omits it", () => {
  const [c] = buildClips(null, [{ type: "stab", bar: 3, beats: 1 }], CATALOGUE, GRID);
  assert.equal(c.beat, 1);
  assert.equal(c.startS, 4);
});

test("a mid-bar beat resolves to the right seconds", () => {
  const [c] = buildClips(null, [{ type: "stab", bar: 2, beat: 3, beats: 2 }], CATALOGUE, GRID);
  assert.equal(c.startS, 3);
  assert.equal(c.endS, 4);
});

test("edit params override the tile's own dials", () => {
  const [c] = buildClips(
    null,
    [{ type: "stab", bar: 1, beats: 1, params: { coverage: "outer" } }],
    CATALOGUE, GRID,
  );
  assert.equal(c.params.coverage, "outer");
  assert.equal(c.params.tone, "key");
  assert.equal(c.params.strength, 0.9);
});

test("an edit naming no known tile is dropped, as the server drops it", () => {
  const clips = buildClips(null, [{ type: "nonesuch", bar: 1, beats: 1 }], CATALOGUE, GRID);
  assert.equal(clips.length, 0);
});

test("an off edit draws nothing", () => {
  const clips = buildClips(
    null, [{ type: "stab", bar: 1, beats: 1, off: true }], CATALOGUE, GRID,
  );
  assert.equal(clips.length, 0);
});

test("editIndex points into the original edits array, gaps and all", () => {
  const [c] = buildClips(
    null,
    [{ type: "nonesuch", bar: 1, beats: 1 }, { type: "cut", bar: 5, beats: 1 }],
    CATALOGUE, GRID,
  );
  assert.equal(c.editIndex, 1);
  assert.equal(c.family, "darkness");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `buildClips is not exported` / `not a function`.

- [ ] **Step 3: Write the implementation**

Add to `lib/clips.ts` — imports at the very top of the file, then the function:

```ts
import type { Clip, Edit, Effect, Grid, ShowPlan } from "./types";
import { familyOfFx } from "./families.ts";
import { makeGridClock } from "./grid.ts";
```

```ts
/** Turn the arranger's plan and the creator's edits into the clips a timeline
 *  draws. `Edit[]` is the only truth; a Clip is derived and never persisted. */
export function buildClips(
  plan: ShowPlan | null,
  edits: Edit[],
  catalogue: Effect[],
  grid: Grid,
): Clip[] {
  const { secondsAtBar, bpb } = makeGridClock(grid);
  const byId = new Map(catalogue.map((e) => [e.id, e]));

  const secondsAtBeatIndex = (i: number) =>
    secondsAtBar(Math.floor(i / bpb) + 1, (i % bpb) + 1);

  /* Every span a person has claimed, whether it draws a clip or suppresses one.
     Both kinds take the beat away from the arranger. */
  const claims: { fx: string; span: BeatSpan }[] = [];
  const mine: Clip[] = [];

  edits.forEach((edit, i) => {
    const spec = byId.get(edit.type);
    if (!spec) return;
    const family = familyOfFx(spec.fx);
    if (!family) return;

    const beat = edit.beat ?? 1;
    const span = spanOf(edit.bar, beat, edit.beats, bpb);
    claims.push({ fx: spec.fx, span });
    if (edit.off) return;

    mine.push({
      key: `mine:${i}`,
      source: "mine",
      editIndex: i,
      planId: null,
      family,
      tile: edit.type,
      fx: spec.fx,
      name: spec.name,
      bar: edit.bar,
      beat,
      beats: edit.beats,
      startS: secondsAtBeatIndex(span.from),
      endS: secondsAtBeatIndex(span.to),
      params: { ...spec.params, ...(edit.params ?? {}) },
      overridden: false,
    });
  });

  /* Task 6 adds the arranger's own clips here, using `claims` to mark which of
     them a person has taken over. */

  return mine.sort((a, b) => a.startS - b.startS);
}
```

`plan` is unused for now. That is deliberate — Task 6 fills it in. If your linter
objects to the unused parameter, leave it; it is consumed one task later.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/clips.ts lib/clips.test.ts
git commit -m "feat: build timeline clips from a creator's edits"
```

---

## Task 6: `buildClips` — the arranger's clips, and what overrides them

**Files:**
- Modify: `limelight-ui/lib/clips.ts`
- Modify: `limelight-ui/lib/clips.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `lib/clips.test.ts`:

```ts
import type { ShowPlan } from "./types";

const PLAN: ShowPlan = {
  punctuation: [
    { id: "p0", fx: "white_blast", bar: 2, beat: 1, beats: 1, params: {}, context: "drop" },
    { id: "p1", fx: "blackout",    bar: 6, beat: 1, beats: 2, params: {}, context: "silence" },
    { id: "p2", fx: "modulate",    bar: 9, beat: 1, beats: 4, params: {}, context: "drop" },
  ],
  dynamics: [],
  looks: [],
};

test("the arranger's punctuation becomes ghost clips", () => {
  const clips = buildClips(PLAN, [], CATALOGUE, GRID);
  const autos = clips.filter((c) => c.source === "auto");
  assert.equal(autos.length, 2);
  assert.equal(autos[0].planId, "p0");
  assert.equal(autos[0].family, "hits");
  assert.equal(autos[0].tile, null);
  assert.equal(autos[0].name, "Hit");
  assert.equal(autos[0].overridden, false);
});

test("a modulate assignment is a curve, not a clip", () => {
  const clips = buildClips(PLAN, [], CATALOGUE, GRID);
  assert.ok(!clips.some((c) => c.fx === "modulate"));
});

test("your clip overrides the arranger's of the same renderer type", () => {
  const clips = buildClips(PLAN, [{ type: "stab", bar: 2, beats: 1 }], CATALOGUE, GRID);
  const p0 = clips.find((c) => c.planId === "p0");
  assert.equal(p0?.overridden, true);
});

test("a different renderer type at the same place overrides nothing", () => {
  const clips = buildClips(PLAN, [{ type: "cut", bar: 2, beats: 1 }], CATALOGUE, GRID);
  assert.equal(clips.find((c) => c.planId === "p0")?.overridden, false);
});

test("a clip that only touches an auto clip does not override it", () => {
  // p0 occupies beats [4,5). An edit at bar 1 occupies [0,4) — adjacent, not overlapping.
  const clips = buildClips(PLAN, [{ type: "stab", bar: 1, beats: 4 }], CATALOGUE, GRID);
  assert.equal(clips.find((c) => c.planId === "p0")?.overridden, false);
});

test("an off edit overrides without drawing anything", () => {
  const clips = buildClips(
    PLAN, [{ type: "cut", bar: 6, beats: 2, off: true }], CATALOGUE, GRID,
  );
  assert.equal(clips.find((c) => c.planId === "p1")?.overridden, true);
  assert.equal(clips.filter((c) => c.source === "mine").length, 0);
});

test("clips come back in time order regardless of source", () => {
  const clips = buildClips(PLAN, [{ type: "stab", bar: 1, beats: 1 }], CATALOGUE, GRID);
  const starts = clips.map((c) => c.startS);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `the arranger's punctuation becomes ghost clips` reports 0 autos,
because `buildClips` currently ignores `plan` entirely.

- [ ] **Step 3: Write the implementation**

In `lib/clips.ts`, widen the families import to:

```ts
import { familyOfFx, acceptsClips, FAMILY_AUTO_LABEL } from "./families.ts";
```

Then replace the placeholder comment and return at the end of `buildClips`:

```ts
  /* Task 6 adds the arranger's own clips here, using `claims` to mark which of
     them a person has taken over. */

  return mine.sort((a, b) => a.startS - b.startS);
```

with:

```ts
  /* What the arranger wrote. It draws as a ghost until a person takes it over —
     which is any claim of the same renderer type overlapping it, whether that
     claim places something or suppresses it. */
  const auto: Clip[] = [];
  for (const p of plan?.punctuation ?? []) {
    const family = familyOfFx(p.fx);
    if (!family || !acceptsClips(family)) continue;
    const span = spanOf(p.bar, p.beat, p.beats, bpb);
    auto.push({
      key: `auto:${p.id}`,
      source: "auto",
      editIndex: null,
      planId: p.id,
      family,
      tile: null,
      fx: p.fx,
      name: FAMILY_AUTO_LABEL[family],
      bar: p.bar,
      beat: p.beat,
      beats: p.beats,
      startS: secondsAtBeatIndex(span.from),
      endS: secondsAtBeatIndex(span.to),
      params: p.params,
      overridden: claims.some((c) => c.fx === p.fx && overlaps(c.span, span)),
    });
  }

  return [...auto, ...mine].sort((a, b) => a.startS - b.startS);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/clips.ts lib/clips.test.ts
git commit -m "feat: draw the arranger's clips and mark what overrides them"
```

---

## Task 7: `lib/snap.ts` — musical snapping

**Files:**
- Create: `limelight-ui/lib/snap.ts`
- Create: `limelight-ui/lib/snap.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/snap.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSnap } from "./snap.ts";
import type { SnapContext } from "./snap.ts";

const CTX: SnapContext = {
  bpb: 4,
  totalBeats: 200,
  playheadBeat: 20,
  sections: [{ beat: 32, label: "chorus" }],
  moments: [{ beat: 33, label: "the riff" }],
};

test("snapping off returns nothing at all", () => {
  assert.equal(resolveSnap(CTX, 32.2, 2, "off"), null);
});

test("nothing within the radius returns null", () => {
  assert.equal(resolveSnap({ ...CTX, playheadBeat: null }, 50.5, 0.1, "bar"), null);
});

test("a bar line is found at bar strength", () => {
  // beat 40 is bar 11's downbeat; 40.6 is 0.6 away, inside a radius of 1.
  const t = resolveSnap({ ...CTX, playheadBeat: null, sections: [], moments: [] },
                        40.6, 1, "bar");
  assert.equal(t?.kind, "bar");
  assert.equal(t?.beat, 40);
  assert.equal(t?.label, "bar 11");
});

test("bar strength never snaps to a plain beat", () => {
  const t = resolveSnap({ ...CTX, playheadBeat: null, sections: [], moments: [] },
                        41.1, 0.5, "bar");
  assert.equal(t, null);
});

test("beat strength snaps to the nearest beat", () => {
  const t = resolveSnap({ ...CTX, playheadBeat: null, sections: [], moments: [] },
                        41.1, 0.5, "beat");
  assert.equal(t?.kind, "beat");
  assert.equal(t?.beat, 41);
});

test("priority beats proximity: a section wins over a nearer moment", () => {
  // raw 32.9 is 0.9 from the section at 32 and 0.1 from the moment at 33.
  const t = resolveSnap(CTX, 32.9, 2, "beat");
  assert.equal(t?.kind, "section");
  assert.equal(t?.beat, 32);
});

test("the playhead outranks everything", () => {
  const ctx = { ...CTX, playheadBeat: 32.5 };
  const t = resolveSnap(ctx, 32.6, 2, "beat");
  assert.equal(t?.kind, "playhead");
});

test("among equals, the nearest wins", () => {
  const ctx = { ...CTX, playheadBeat: null, moments: [], sections: [
    { beat: 32, label: "chorus" }, { beat: 36, label: "verse" },
  ] };
  assert.equal(resolveSnap(ctx, 35, 4, "bar")?.label, "verse");
});

test("a bar line beyond the end of the song is not offered", () => {
  const ctx = { ...CTX, totalBeats: 40, playheadBeat: null, sections: [], moments: [] };
  assert.equal(resolveSnap(ctx, 43, 2, "bar"), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module` for `./snap.ts`.

- [ ] **Step 3: Write the implementation**

Create `lib/snap.ts`:

```ts
/* Snapping here is musical, not temporal. A creator reaches for the drop, the
   chorus, or the bar line — never for 34.86 seconds. */

export type SnapKind = "playhead" | "section" | "moment" | "bar" | "beat";
export type SnapStrength = "bar" | "beat" | "off";

export interface SnapTarget {
  kind: SnapKind;
  beat: number;
  label: string;
}

export interface SnapContext {
  bpb: number;
  totalBeats: number;
  playheadBeat: number | null;
  sections: { beat: number; label: string }[];
  moments: { beat: number; label: string }[];
}

/* Lower is stronger. A section boundary beats a nearer moment, because landing
   on the chorus is almost always what was meant. */
const PRIORITY: Record<SnapKind, number> = {
  playhead: 0, section: 1, moment: 2, bar: 3, beat: 4,
};

export function resolveSnap(
  ctx: SnapContext,
  rawBeat: number,
  radius: number,
  strength: SnapStrength,
): SnapTarget | null {
  if (strength === "off") return null;

  const near = (b: number) => Math.abs(b - rawBeat) <= radius;
  const inSong = (b: number) => b >= 0 && b <= ctx.totalBeats;
  const out: SnapTarget[] = [];

  if (ctx.playheadBeat !== null && near(ctx.playheadBeat)) {
    out.push({ kind: "playhead", beat: ctx.playheadBeat, label: "playhead" });
  }
  for (const s of ctx.sections) {
    if (near(s.beat)) out.push({ kind: "section", beat: s.beat, label: s.label });
  }
  for (const m of ctx.moments) {
    if (near(m.beat)) out.push({ kind: "moment", beat: m.beat, label: m.label });
  }

  const bar = Math.round(rawBeat / ctx.bpb) * ctx.bpb;
  if (near(bar) && inSong(bar)) {
    out.push({ kind: "bar", beat: bar, label: `bar ${bar / ctx.bpb + 1}` });
  }

  if (strength === "beat") {
    const beat = Math.round(rawBeat);
    if (near(beat) && inSong(beat)) {
      out.push({ kind: "beat", beat, label: `beat ${(beat % ctx.bpb) + 1}` });
    }
  }

  if (!out.length) return null;
  out.sort(
    (a, b) =>
      PRIORITY[a.kind] - PRIORITY[b.kind] ||
      Math.abs(a.beat - rawBeat) - Math.abs(b.beat - rawBeat),
  );
  return out[0];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: `fail 0` across all four test files.

- [ ] **Step 5: Verify the whole project still compiles**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add lib/snap.ts lib/snap.test.ts
git commit -m "feat: musical snap resolution by priority then proximity"
```

---

## Task 8: Backend B1 — effects can start on any beat

From here, work in the **backend** repo:
`/home/muhammedmuzammil/Desktop/Projects/limelight-global/limelight`

**Files:**
- Modify: `portal/server.py` (`validate_edits` ~L870, `describe_edits` ~L884)
- Modify: `portal/effects.js` (the edit loop, ~L90)
- Create: `portal/edits.test.py`

- [ ] **Step 1: Write the failing test**

Create `portal/edits.test.py`:

```python
#!/usr/bin/env python3
"""What survives validate_edits, and where describe_edits says it landed.

Runs in-process against server.py; no socket is opened and no bake is started."""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import server  # noqa: E402

PASS = FAIL = 0


def ok(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  ok   %s" % name)
    else:
        FAIL += 1
        print("  FAIL %s  %s" % (name, detail))


def one(**kw):
    """A single validated edit, or None when it was dropped."""
    out = server.validate_edits([kw])
    return out[0] if out else None


print("validate_edits")
ok("a known effect survives", one(type="impact", bar=17, beats=1) is not None)
ok("an unknown effect is dropped", one(type="nonesuch", bar=1, beats=1) is None)
ok("beat defaults to 1", one(type="impact", bar=17, beats=1)["beat"] == 1)
ok("beat is carried through", one(type="impact", bar=17, beat=3, beats=1)["beat"] == 3)
ok("beat below 1 is clamped up", one(type="impact", bar=17, beat=0, beats=1)["beat"] == 1)
ok("beat above 16 is clamped down", one(type="impact", bar=17, beat=99, beats=1)["beat"] == 16)
ok("beats is clamped to at least 1", one(type="impact", bar=1, beats=0)["beats"] == 1)
ok("beats is clamped to at most 256", one(type="impact", bar=1, beats=9999)["beats"] == 256)

print("describe_edits")
# 120 bpm, 4/4, first beat at 0 -> one beat is 0.5s, one bar is 2s.
seconds_at = lambda bar, beat=1: (bar - 1) * 2.0 + (beat - 1) * 0.5
rows = server.describe_edits(
    [{"type": "impact", "bar": 3, "beat": 1, "beats": 2},
     {"type": "impact", "bar": 3, "beat": 3, "beats": 2}],
    40, seconds_at, 4, 10_000)
ok("bar 3 beat 1 lands at 4.0s", rows[0]["from_s"] == 4.0, rows[0])
ok("two beats last 1.0s", rows[0]["to_s"] == 5.0, rows[0])
ok("bar 3 beat 3 lands at 5.0s", rows[1]["from_s"] == 5.0, rows[1])
ok("frames follow from seconds", rows[0]["from_frame"] == 160, rows[0])

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
```

- [ ] **Step 2: Run to verify it fails**

Run: `python3 portal/edits.test.py`
Expected: FAIL on `beat defaults to 1` (KeyError or None), and on the `describe_edits` beat-3 row, which currently ignores `beat` and reports 4.0s.

- [ ] **Step 3: Write the implementation**

In `portal/server.py`, in `validate_edits`, replace the `out.append(...)` call with:

```python
        out.append({"type": e["type"], "bar": int(e["bar"]),
                    "beat": max(1, min(16, int(e.get("beat") or 1))),
                    "beats": max(1, min(256, int(round(float(e.get("beats", spec["beats"]))))))})
```

In `portal/server.py`, in `describe_edits`, replace:

```python
        bar, beats = a["bar"], a["beats"]
        t0 = seconds_at(bar, 1)
```

with:

```python
        bar, beats = a["bar"], a["beats"]
        beat = a.get("beat", 1)
        t0 = seconds_at(bar, beat)
```

and add `"beat": beat,` to the dict it appends, directly after `"bar": bar,`.

In `portal/effects.js`, inside the `for (const e of edits)` loop, replace:

```js
  const startBeat = (Math.round(e.bar) - shift - 1) * bpb;
```

with:

```js
  /* a placement may begin on any beat of its bar, not only the downbeat */
  const beat = Math.max(1, Math.min(bpb, Math.round(+e.beat || 1)));
  const startBeat = (Math.round(e.bar) - shift - 1) * bpb + (beat - 1);
```

and in the same loop's `applied.push({...})`, add `beat,` directly after `bar: Math.round(e.bar),`.

- [ ] **Step 4: Run to verify it passes**

Run: `python3 portal/edits.test.py`
Expected: `12 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
# edits.test.py is new; make it known to git so the scoped commit can name it
git add -N portal/edits.test.py
git commit -m "feat: placements may start on any beat, not only a bar line" \
  -- portal/server.py portal/effects.js portal/edits.test.py
```

---

## Task 9: Backend B2 — clips carry their own dials

`save_custom` already filters parameters against `DIALS` and `CHOICES` and clamps
numerics. Extract that so an edit can reuse it, rather than writing it twice.

**Files:**
- Modify: `portal/server.py` (`save_custom` ~L819, `validate_edits`)
- Modify: `portal/effects.js`
- Modify: `portal/edits.test.py`

- [ ] **Step 1: Write the failing test**

Append to `portal/edits.test.py`, before the final `print`/`sys.exit`:

```python
print("dial_filter")
ok("an allowed choice is kept",
   server.dial_filter("white_blast", {"coverage": "outer"}) == {"coverage": "outer"})
ok("a choice outside the list is dropped",
   server.dial_filter("white_blast", {"coverage": "sideways"}) == {})
ok("a dial the renderer does not read is dropped",
   server.dial_filter("blackout", {"coverage": "outer"}) == {})
ok("a numeric dial is clamped to 0..1",
   server.dial_filter("white_blast", {"strength": 5}) == {"strength": 1.0})
ok("a non-numeric value for a numeric dial is dropped",
   server.dial_filter("white_blast", {"strength": "loud"}) == {})
ok("an unknown effect type allows nothing",
   server.dial_filter("laser_sweep", {"strength": 1}) == {})

print("validate_edits params")
ok("params survive validation",
   one(type="stab", bar=1, beats=1, params={"coverage": "outer"})["params"]
   == {"coverage": "outer"})
ok("a dial the effect's renderer type cannot read leaves no params behind",
   "params" not in one(type="cut", bar=1, beats=1, params={"coverage": "outer"}))
ok("an edit with no params carries none",
   "params" not in one(type="stab", bar=1, beats=1))
```

- [ ] **Step 2: Run to verify it fails**

Run: `python3 portal/edits.test.py`
Expected: FAIL — `module 'server' has no attribute 'dial_filter'`.

- [ ] **Step 3: Write the implementation**

In `portal/server.py`, add this function directly above `def save_custom(body):`:

```python
def dial_filter(fx, params):
    """Only dials the renderer actually reads, only values it can use. One copy,
    shared by a saved custom effect and by a single placement's own dials."""
    allowed = DIALS.get(fx, [])
    out = {}
    for k, v in (params or {}).items():
        if k not in allowed:
            continue
        if k in CHOICES:
            if v in CHOICES[k]:
                out[k] = v
        else:
            try:
                out[k] = max(0.0, min(1.0, float(v)))
            except (TypeError, ValueError):
                pass
    return out
```

In `save_custom`, replace the hand-rolled loop:

```python
    allowed = DIALS.get(base["fx"], [])
    params = dict(base.get("params") or {})
    for k, v in (body.get("params") or {}).items():
        if k not in allowed:
            continue
        if k in CHOICES:
            if v in CHOICES[k]:
                params[k] = v
        else:
            try:
                params[k] = max(0.0, min(1.0, float(v)))
            except (TypeError, ValueError):
                pass
```

with:

```python
    params = dict(base.get("params") or {})
    params.update(dial_filter(base["fx"], body.get("params")))
```

In `validate_edits`, replace the statement Task 8 left in place:

```python
        out.append({"type": e["type"], "bar": int(e["bar"]),
                    "beat": max(1, min(16, int(e.get("beat") or 1))),
                    "beats": max(1, min(256, int(round(float(e.get("beats", spec["beats"]))))))})
```

with a form that can attach optional fields:

```python
        row = {"type": e["type"], "bar": int(e["bar"]),
               "beat": max(1, min(16, int(e.get("beat") or 1))),
               "beats": max(1, min(256, int(round(float(e.get("beats", spec["beats"]))))))}
        dials = dial_filter(spec["fx"], e.get("params"))
        if dials:
            row["params"] = dials
        out.append(row)
```

In `portal/effects.js`, replace:

```js
  const params = { ...spec.params };
```

with:

```js
  /* the tile's dials are its identity; an edit may re-dial its own copy */
  const params = { ...spec.params, ...(e.params || {}) };
```

- [ ] **Step 4: Run to verify it passes**

Run: `python3 portal/edits.test.py`
Expected: `21 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: a placement may carry its own dials" \
  -- portal/server.py portal/effects.js portal/edits.test.py
```

---

## Task 10: Backend B3 — suppressing the arranger

**Files:**
- Modify: `portal/server.py` (`validate_edits`)
- Modify: `portal/effects.js`
- Modify: `portal/edits.test.py`

- [ ] **Step 1: Write the failing test**

Append to `portal/edits.test.py`, before the final `print`/`sys.exit`:

```python
print("validate_edits off")
ok("off survives as a boolean", one(type="stab", bar=1, beats=1, off=True)["off"] is True)
ok("off absent stays absent", "off" not in one(type="stab", bar=1, beats=1))
ok("off false is treated as absent", "off" not in one(type="stab", bar=1, beats=1, off=False))
```

- [ ] **Step 2: Run to verify it fails**

Run: `python3 portal/edits.test.py`
Expected: FAIL on `off survives as a boolean` — `validate_edits` drops the field.

- [ ] **Step 3: Write the implementation**

In `portal/server.py`, in `validate_edits`, directly after the `if dials:` block
and before `out.append(row)`, add:

```python
        if e.get("off"):
            row["off"] = True
```

In `portal/effects.js`, in the edit loop, the filter that clears overlapping
assignments already runs before the push. Replace the two statements Task 8 left
in place:

```js
  p.assignments.push(a);
  applied.push({ type: e.type, bar: Math.round(e.bar), beat, beats,
                 from_beat: a0, to_beat: a1, hue: params.hue === undefined ? null : params.hue });
```

with:

```js
  /* `off` clears the arranger's punctuation of this type across the span and
     puts nothing in its place -- the filter above has already done the clearing */
  if (!e.off) p.assignments.push(a);
  applied.push({ type: e.type, bar: Math.round(e.bar), beat, beats,
                 off: e.off ? true : undefined,
                 from_beat: a0, to_beat: a1, hue: params.hue === undefined ? null : params.hue });
```

- [ ] **Step 4: Run to verify it passes**

Run: `python3 portal/edits.test.py`
Expected: `24 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: an edit may suppress the arranger rather than replace it" \
  -- portal/server.py portal/effects.js portal/edits.test.py
```

---

## Task 11: Backend B4 — expose the arranger's plan

**The riskiest change in this plan.** The arranger numbers bars in the renderer's
corrected space; the page numbers them the way `protocol/session.js` does.
`effects.js` crosses that bridge with `shift`, and the conversion out is
`pageBar = planBar + shift`.

For the song `levels`, `shift` is **0**, so a test using it would pass even if the
conversion were missing entirely. The test below therefore constructs a plan and a
`shift` directly, so a non-zero `shift` is actually exercised.

`planFor` goes in its own module rather than inside `effects.js`. `effects.js` is
a CLI script that runs on load — requiring it from a test would execute its
argument parsing and hit the usage guard. A separate module keeps the script
untouched and gives the function one clear responsibility.

**Files:**
- Create: `portal/plan.js`
- Create: `portal/plan.test.js`
- Modify: `portal/effects.js`
- Modify: `portal/server.py` (`_bake`)

- [ ] **Step 1: Write the failing test**

Create `portal/plan.test.js`:

```js
#!/usr/bin/env node
"use strict";
/* The plan the page draws ghost clips from. The only thing that can go quietly
   wrong here is bar numbering: the arranger counts bars in the renderer's
   corrected space, the page counts them session.js's way, and the two coincide
   whenever shift is 0 -- which it is for most songs. So exercise shift != 0. */
const assert = require("node:assert/strict");
const { planFor } = require("./plan.js");

let pass = 0, fail = 0;
const ok = (name, fn) => {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); }
};

const bpb = 4;
const assignments = [
  { from: { bar: 3, beat: 1 }, to: { bar: 3, beat: 3 }, type: "white_blast",
    layer: "fx", params: { strength: 1 }, context: "drop" },
  { from: { bar: 5, beat: 1 }, to: { bar: 6, beat: 1 }, type: "accent_strobe",
    layer: "accent", params: {}, context: "build" },
  { from: { bar: 1, beat: 1 }, to: { bar: 5, beat: 1 }, type: "modulate",
    layer: "modulate", params: { gain: 1.1, motion: 0.15, doing: "expanding" } },
  { from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, layer: "par",
    seq_id: "hold_indigo" },
  { from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, layer: "head",
    seq_id: "head_roam_dusk" },
];
const sections = [{ from: { bar: 1 } }, { from: { bar: 9 } }];

ok("punctuation is carried, modulate and base looks are not", () => {
  const plan = planFor({ assignments }, [], bpb, 0);
  assert.equal(plan.punctuation.length, 2);
  assert.deepEqual(plan.punctuation.map((x) => x.fx), ["white_blast", "accent_strobe"]);
});

ok("with shift 0 the plan's bars are the page's bars", () => {
  const plan = planFor({ assignments }, [], bpb, 0);
  assert.equal(plan.punctuation[0].bar, 3);
});

ok("with shift 1 every bar moves by one -- the bridge", () => {
  const plan = planFor({ assignments }, [], bpb, 1);
  assert.equal(plan.punctuation[0].bar, 4);
  assert.equal(plan.punctuation[1].bar, 6);
});

ok("a negative shift moves bars the other way", () => {
  const plan = planFor({ assignments }, [], bpb, -2);
  assert.equal(plan.punctuation[0].bar, 1);
});

ok("length is measured in beats, and the beat within the bar is kept", () => {
  const plan = planFor({ assignments }, [], bpb, 0);
  assert.equal(plan.punctuation[0].beats, 2);
  assert.equal(plan.punctuation[0].beat, 1);
  assert.equal(plan.punctuation[1].beats, 4);
});

ok("ids are stable and unique", () => {
  const a = planFor({ assignments }, [], bpb, 0).punctuation.map((x) => x.id);
  const b = planFor({ assignments }, [], bpb, 0).punctuation.map((x) => x.id);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length);
});

ok("dynamics comes from the modulate layer, in page bars", () => {
  const plan = planFor({ assignments }, [], bpb, 1);
  assert.equal(plan.dynamics.length, 1);
  assert.equal(plan.dynamics[0].bar, 2);
  assert.equal(plan.dynamics[0].beats, 16);
  assert.equal(plan.dynamics[0].gain, 1.1);
  assert.equal(plan.dynamics[0].doing, "expanding");
});

ok("each section reports the base look covering its first beat", () => {
  const plan = planFor({ assignments }, sections, bpb, 0);
  assert.equal(plan.looks.length, 2);
  assert.deepEqual(plan.looks[0], { section: 0, par: "hold_indigo", head: "head_roam_dusk" });
  assert.deepEqual(plan.looks[1], { section: 1, par: null, head: null });
});

console.log("\n%d passed, %d failed", pass, fail);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node portal/plan.test.js`
Expected: FAIL — `Cannot find module './plan.js'`.

- [ ] **Step 3: Write the implementation**

Create `portal/plan.js`:

```js
"use strict";
/* What the arranger wrote, in the page's own bar numbering, so the editor can
   draw it as ghost clips and show which of it a person has taken over.
   `shift` is bake.js's bar correction: page bar = plan bar + shift. */
const PUNCTUATION_LAYERS = new Set(["fx", "accent", "whiten"]);

function planFor(p, sections, bpb, shift) {
  const at = q => (q.bar - 1) * bpb + ((q.beat || 1) - 1);
  const assignments = p.assignments || [];

  const punctuation = [];
  assignments.forEach((a, i) => {
    if (!PUNCTUATION_LAYERS.has(a.layer) || !a.type) return;
    punctuation.push({
      id: "p" + i,
      fx: a.type,
      bar: a.from.bar + shift,
      beat: a.from.beat || 1,
      beats: at(a.to) - at(a.from),
      params: a.params || {},
      context: a.context || null,
    });
  });

  const dynamics = assignments
    .filter(a => a.layer === "modulate")
    .map(a => ({
      bar: a.from.bar + shift,
      beats: at(a.to) - at(a.from),
      gain: (a.params && a.params.gain) !== undefined ? a.params.gain : 1,
      motion: (a.params && a.params.motion) !== undefined ? a.params.motion : 0,
      doing: (a.params && a.params.doing) || null,
    }));

  const covering = (layer, beat) => {
    const a = assignments.find(x => x.layer === layer && at(x.from) <= beat && beat < at(x.to));
    return a && a.seq_id ? a.seq_id : null;
  };
  const looks = (sections || []).map((sec, i) => {
    const beat = at({ bar: sec.from.bar, beat: 1 });
    return { section: i, par: covering("par", beat), head: covering("head", beat) };
  });

  return { punctuation, dynamics, looks };
}

module.exports = { planFor };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node portal/plan.test.js`
Expected: `8 passed, 0 failed`.

- [ ] **Step 5: Wire it into the baker**

In `portal/effects.js`, add near the other requires at the top:

```js
const { planFor } = require("./plan.js");
```

Then capture the plan **before** the edit loop mutates `p.assignments`. Directly
above the line `for (const e of edits) {`, add:

```js
/* snapshot first: the loop below removes the arranger's punctuation wherever a
   placement replaces it, and the page needs to see what was there */
const arrangerPlan = planFor(p, score.sections, bpb, shift);
```

Finally, add `plan: arrangerPlan,` to the object passed to
`fs.writeFileSync(lightsOut, JSON.stringify({ ... }))`, directly after
`appetite_natural: natural,`.

- [ ] **Step 6: Verify the baker still runs as a program**

Run from the backend repo root:

```bash
# effects.js does JSON.parse on the edits file, so /dev/null (empty string)
# throws. Use a real empty array.
echo '[]' > /tmp/ll-no-edits.json
node portal/effects.js hub/files/score/levels.score 1 /tmp/ll-no-edits.json \
  --lights /tmp/ll-plan-check.json \
  --layout readers/lights/club16-2head.layout.json
```

Expected: a line like `baked 9494 frames on club16-2head (18 fixtures, 138ch, seed 1, 0 placed)`.

Then confirm the plan is present and non-empty:

```bash
python3 -c "
import json; d=json.load(open('/tmp/ll-plan-check.json'))
p=d['plan']
print('punctuation', len(p['punctuation']), 'dynamics', len(p['dynamics']), 'looks', len(p['looks']))
print(p['punctuation'][0])
"
```

Expected: roughly `punctuation 41 dynamics 39 looks 11`, and a first row carrying
`id`, `fx`, `bar`, `beat`, `beats`, `params`, `context`.

- [ ] **Step 7: Pass the plan through the API**

In `portal/server.py`, in `_bake`, inside the `"show": { … }` dict, add directly
after the `"fixtures": show.get("fixtures") or [],` line:

```python
                "plan": show.get("plan") or {"punctuation": [], "dynamics": [], "looks": []},
```

- [ ] **Step 8: Verify end to end against the running server**

Restart the portal server, then run:

```bash
python3 -c "
import json,urllib.request,time
def get(u):
    with urllib.request.urlopen(u, timeout=30) as r: return json.load(r)
def post(u,b):
    req=urllib.request.Request(u, data=json.dumps(b).encode(),
                               headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r: return json.load(r)
job = post('http://localhost:8800/api/show',
           {'song':'levels','seed':1,
            'edits':[{'type':'impact','bar':17,'beat':3,'beats':1}],
            'layout':'club16-2head.layout.json'})['job']
for _ in range(120):
    d = get('http://localhost:8800/api/show?job=' + job)
    if d.get('state') != 'baking': break
    time.sleep(0.5)
assert d['state'] == 'ready', d.get('error')
plan = d['show']['plan']
print('punctuation', len(plan['punctuation']))
print('applied', d['applied'])
"
```

Expected: a non-zero punctuation count, and an `applied` row showing
`'beat': 3` with `from_s` one beat later than bar 17's downbeat (35.328 rather
than 34.859).

- [ ] **Step 9: Commit**

```bash
git add -N portal/plan.js portal/plan.test.js
git commit -m "feat: expose the arranger's plan so the editor can draw it" \
  -- portal/plan.js portal/plan.test.js portal/effects.js portal/server.py
```

---

## Task 12: Backward compatibility check

Every new field is optional. Prove that the nine saved shows still bake.

**Files:** none modified.

- [ ] **Step 1: Bake every saved show's edits through the new path**

Run from the backend repo root:

```bash
python3 -c "
import glob, json, sys, os
sys.path.insert(0, 'portal')
import server
bad = []
for f in sorted(glob.glob('portal/shows/*.show.json')):
    doc = json.load(open(f))
    before = doc.get('edits') or []
    after = server.validate_edits(before)
    if len(after) != len(before):
        bad.append((os.path.basename(f), len(before), len(after)))
    for e in after:
        assert e['beat'] == 1, (f, e)
        assert 'params' not in e, (f, e)
        assert 'off' not in e, (f, e)
print('%d show files checked' % len(glob.glob('portal/shows/*.show.json')))
print('dropped edits:', bad or 'none')
"
```

Expected: all files checked; `dropped edits: none`. Every old three-field edit
gains `beat: 1` and nothing else.

- [ ] **Step 2: Run every test in both repos**

Backend:

```bash
python3 portal/edits.test.py && node portal/plan.test.js
```

Expected: both report `0 failed`.

Frontend (from `limelight-ui`):

```bash
npm test && npx tsc --noEmit && npx next build
```

Expected: `fail 0`, no type errors, build succeeds.

- [ ] **Step 3: Commit**

Nothing to commit if both steps pass. If a saved show lost an edit, that is a
real regression in `validate_edits` — fix it before continuing, then commit the
fix.

---

## Self-review

**Spec coverage.** §6.1 B1→Task 8, B2→Task 9, B3→Task 10, B4→Task 11. §6.2 needs
no work by definition. §6.3 types→Task 2, `buildClips`→Tasks 4–6, `snap`→Task 7,
`families`→Task 3. §9's pure units→Tasks 1, 3–7; backend units→Tasks 8–11; the
integration check→Task 11 Step 7. §6.4's store and hook files are **not** in this
plan — they hold React state and belong with the UI in plan 4, which is why only
`lib/` appears here.

**Deliberately deferred.** `lib/clips.ts` does not yet expose a "can this clip be
dropped here" predicate; it belongs with the drag gesture in plan 4, where the
`claims` array it needs is already computed.

**Type consistency.** `Family` is defined once in `lib/types.ts` and imported
everywhere. `BeatSpan` is declared in `clips.ts` before `buildClips` uses it.
`SnapContext` is exported from `snap.ts` and imported by its test as a type.
`Clip.tile`/`Clip.fx` are used consistently in Tasks 5 and 6 and match the spec as
corrected. `dial_filter(fx, params)` has one signature, used by both `save_custom`
and `validate_edits`. `planFor(p, sections, bpb, shift)` has one signature, used by
the test and by `effects.js`.
