# Design System Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the light/dark role reskin with one dark-first token system where colour carries meaning, and build the primitives the new shell needs — verified by a gallery you look at, plus `tsc` and `next build`.

**Architecture:** A four-tier surface ladder and a meaning-bound palette in `app/globals.css`, density as a real token rather than a role hack, family hues and phase tints exposed through a pure, tested `lib/tokens.ts`, and ten primitives in a fresh `components/primitives/` directory. A dev-only `/gallery` route renders every component in every state at both densities.

**Tech Stack:** Next.js 16 (Turbopack), Tailwind v4 (`@theme` in CSS, no config file), React 19, TypeScript 5, `node --test` for pure logic. **No new dependencies.**

---

## Important: this plan makes no git commits

The user handles all git operations manually. **Do not run `git commit`, `git add`, `git stash`, `git reset`, `git checkout`, `git restore`, `git merge`, `git rebase`, or `git pull` at any point.** Read-only `git status` / `git diff` are fine. Leave your work in the working tree.

The repo is also **mid-merge** (`.git/MERGE_HEAD` present) with ~133 staged paths. None of that is yours. Never run a bare `git add .`.

---

## Repository layout (changed since Plan 1)

Everything now lives in **one repo**: `/home/muhammedmuzammil/Desktop/Projects/limelight-global/limelight`

- UI: `limelight-ui/` (a subdirectory — run `npm` commands from there)
- Backend: `portal/`, `readers/`, `hub/`

All paths below are relative to `limelight-ui/` unless they start with `portal/`.

`limelight-ui/.gitignore` works as a nested ignore, so `node_modules` and `.next` are already excluded from the outer repo. Leave it alone.

---

## State this plan builds on

Plan 1 is complete: `lib/families.ts`, `lib/clips.ts`, `lib/snap.ts`, extended `lib/types.ts`, and the backend contract. **42 frontend tests pass; `npx tsc --noEmit` is clean.** Do not break either.

Verified environment facts — do not re-derive:
- Tailwind **v4.3.3**, configured entirely through `@theme` inside `app/globals.css`. There is no `tailwind.config.*` and you must not create one.
- `node --test "lib/**/*.test.ts"` runs `.ts` tests directly. Value imports between `.ts` files need the `.ts` extension; `import type` does not.
- A `MODULE_TYPELESS_PACKAGE_JSON` warning when testing is expected and harmless. Never "fix" it by adding `"type": "module"` to `package.json`.
- **16 files import from `components/ui`.** Those legacy components and the legacy screens under `app/(portal)/` must keep compiling. This plan does not touch them.

---

## Why new primitives live in `components/primitives/`

The legacy `components/ui/` set is imported by 16 files across screens that **Plan 3 deletes and replaces**. Migrating them now would be work thrown away within one plan, and rebuilding `Button` in place would break all 16 at once.

So the new design system lands in `components/primitives/`, the legacy set stays untouched and compiling, and Plan 3 deletes `components/ui/` together with the legacy screens. Two component directories is a deliberate, temporary state with a named end.

---

## File structure

| File | Responsibility |
|---|---|
| `app/globals.css` *(rewrite)* | Surface ladder, meaning-bound palette, family hues, phase tints, type scale, density modes, timeline metrics, motion |
| `app/layout.tsx` *(modify)* | Drop Newsreader; one sans plus a mono for numerics |
| `lib/tokens.ts` *(create)* | Family hue and phase tint lookups — the only place a component learns a colour name |
| `lib/tokens.test.ts` *(create)* | Proves those mappings are total and distinct |
| `components/primitives/Button.tsx` | `Button`, `IconButton` |
| `components/primitives/Input.tsx` | `Input`, `Field` |
| `components/primitives/Panel.tsx` | `Panel`, `EmptyState` |
| `components/primitives/Status.tsx` | `Badge`, `StatusDot` |
| `components/primitives/Menu.tsx` | `Menu` |
| `components/primitives/Dialog.tsx` | `Dialog` |
| `components/primitives/index.ts` | Barrel export |
| `app/gallery/page.tsx` *(create)* | Dev-only gallery: every component, every state, both densities |

**Deferred to Plan 4**, when the editor actually uses them: `NumberInput`, `Select`, `Toggle`, `Segmented`, `Slider`, `Tooltip`, `Sheet`, `Toast`. Building them now would be speculative.

---

## Task 1: The token foundation

Replaces the light-creator/dark-venue reskin with one dark system. The load-bearing idea: **colour means something**. Today `--accent` does six unrelated jobs (active section, clip fill, armed tile, focus ring, active zoom step, hover background), which is why nothing reads as significant.

**Files:**
- Rewrite: `app/globals.css`

- [ ] **Step 1: Replace the token and base layers**

Replace the entire contents of `app/globals.css` with:

```css
@import "tailwindcss";

/* ── one dark system ─────────────────────────────────────────────────────────
   Hierarchy comes from elevation and hairlines, not drawn boxes. Colour is
   reserved for meaning: lane identity, song structure, and rig state. Density
   is a token, not a second skin. */

@theme {
  --color-bg-sunken: var(--bg-sunken);
  --color-bg: var(--bg);
  --color-bg-raised: var(--bg-raised);
  --color-bg-overlay: var(--bg-overlay);

  --color-ink: var(--ink);
  --color-ink-dim: var(--ink-dim);
  --color-ink-dimmer: var(--ink-dimmer);

  --color-line: var(--line);
  --color-line-strong: var(--line-strong);

  --color-ok: var(--ok);
  --color-warn: var(--warn);
  --color-danger: var(--danger);
  --color-focus: var(--focus);

  --font-body: var(--ff-body);
  --font-mono: var(--ff-mono);

  --text-2xs: 11px;
  --text-xs: 12px;
  --text-sm: 13px;
  --text-md: 15px;
  --text-lg: 18px;
  --text-xl: 22px;
  --text-2xl: 28px;

  --spacing-s1: 4px;
  --spacing-s2: 8px;
  --spacing-s3: 12px;
  --spacing-s4: 16px;
  --spacing-s5: 22px;
  --spacing-s6: 26px;
  --spacing-s7: 34px;
  --spacing-s8: 44px;
}

:root {
  /* surfaces: a four-step ladder, darkest well to lightest overlay */
  --bg-sunken: #0a0b0e;
  --bg: #101216;
  --bg-raised: #171a20;
  --bg-overlay: #1e2229;

  --ink: #e6eaf2;
  --ink-dim: rgba(230, 234, 242, 0.66);
  --ink-dimmer: rgba(230, 234, 242, 0.42);

  --line: rgba(230, 234, 242, 0.10);
  --line-strong: rgba(230, 234, 242, 0.22);

  /* state — rig and limits only, never selection or focus */
  --ok: #4fbf87;
  --warn: #e0b54a;
  --danger: #ff5a45;

  /* the one high-contrast neutral: playhead, selection, focus. Never a hue,
     because it has to win against every family colour underneath it. */
  --focus: #ffffff;
  --playhead: #ffffff;
  --select: #ffffff;

  /* lane identity, tuned onto a LIGHTNESS ladder rather than by hue alone.
     Seven hues cannot all stay distinct under deuteranopia — it collapses the
     red/green axis, so some pair always merges. Spacing them in luminance means
     the lanes still read as distinguishable bands when hue collapses. Hue stays
     reinforcement only; every clip and lane header also carries its name. */
  --fam-hits: #f6cf8d;
  --fam-darkness: #7e6de5;
  --fam-strobe: #3ec7db;
  --fam-lift: #a5d462;
  --fam-breath: #6194dd;
  --fam-wash: #e589ba;
  --fam-dynamics: #5f6670;

  /* song structure. Deliberately low chroma: sections are background, clips
     are foreground, and the two must never compete. */
  --phase-intro: rgba(111, 158, 224, 0.13);
  --phase-drop: rgba(240, 178, 74, 0.15);
  --phase-silence: rgba(143, 154, 168, 0.10);
  --phase-break: rgba(139, 124, 232, 0.12);
  --phase-verse: rgba(70, 201, 220, 0.10);
  --phase-build: rgba(224, 112, 171, 0.12);
  --phase-final-drop: rgba(240, 178, 74, 0.22);
  --phase-outro: rgba(143, 154, 168, 0.13);
  --phase-unknown: rgba(230, 234, 242, 0.05);

  /* the stage preview's own ground — near-black, so emitted light reads true */
  --stage: #07090f;

  --ff-body: var(--font-inter), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --ff-mono: var(--font-mono-face), ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;

  /* motion. Nothing the pointer is dragging may be eased. */
  --dur-state: 120ms;
  --dur-panel: 180ms;
  --ease: cubic-bezier(0.2, 0, 0, 1);

  /* timeline metrics, so ruler, bands, lanes and clips stay aligned */
  --ruler-h: 22px;
  --section-h: 30px;
  --energy-h: 28px;
  --moments-h: 18px;
  --lane-gap: 2px;
  --clip-radius: 3px;
  --handle-w: 8px;
  --snap-threshold: 8px;
}

/* ── density: the same system at arm's length ────────────────────────────────
   This replaces the old role reskin, where creator/venue silently swapped base
   size and hit target. Density is now a property, not an identity. */
:root,
[data-density="studio"] {
  --base-size: 13px;
  --hit: 28px;
  --lane-h: 28px;
}

[data-density="booth"] {
  --base-size: 15px;
  --hit: 44px;
  --lane-h: 36px;
}

/* ── base ────────────────────────────────────────────────────────────────── */
* { box-sizing: border-box; }
html, body { height: 100%; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--ff-body);
  font-size: var(--base-size);
  line-height: 1.5;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
}

/* every number is tabular: digits that change width while counting are
   genuinely disorienting in a timeline */
.mono, .tabular, input[type="number"] {
  font-family: var(--ff-mono);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
}

::-webkit-scrollbar { width: 9px; height: 9px; }
::-webkit-scrollbar-thumb { background: var(--line-strong); border-radius: 9px; }
::-webkit-scrollbar-track { background: transparent; }

button, input, select, textarea { font-family: inherit; color: inherit; font-size: inherit; }
input::placeholder { color: var(--ink-dimmer); }

:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
  border-radius: 3px;
}

/* ── the one micro-label ─────────────────────────────────────────────────────
   The old design applied this treatment to the brand, nav, role toggle, panel
   headers, section labels and footer at once. It now has exactly one job. */
.label {
  font-size: var(--text-2xs);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-dim);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 2: Verify it compiles and the app still builds**

From `limelight-ui/`:

Run: `npx next build`
Expected: `✓ Compiled successfully`, TypeScript finishes, static pages generate.

The legacy screens will look wrong — they reference removed tokens like `--color-panel` and `--color-accent`. **That is expected and fine.** Plan 3 deletes those screens. The build must still pass; visual regressions on legacy pages are not your problem.

Run: `npm test`
Expected: `pass 42`, `fail 0` (unchanged — this task adds no tests).

> **Do not commit.** Leave the change in the working tree.

---

## Task 2: `lib/tokens.ts` — the only place a component learns a colour

A component must never hardcode `#f0b24a`. It asks for the hue of a family, and this module answers with a CSS variable reference. That keeps one source of truth and makes the mapping testable.

**Files:**
- Create: `lib/tokens.test.ts`
- Create: `lib/tokens.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/tokens.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { FAMILY_VAR, PHASE_VAR, familyHue, phaseTint } from "./tokens.ts";
import { FAMILY_ORDER } from "./families.ts";

test("every lane family has a hue variable", () => {
  for (const f of FAMILY_ORDER) {
    assert.ok(FAMILY_VAR[f], `no hue variable for ${f}`);
  }
});

test("no two families share a hue variable", () => {
  const vars = FAMILY_ORDER.map((f) => FAMILY_VAR[f]);
  assert.equal(new Set(vars).size, vars.length);
});

test("familyHue returns a css var reference, not a raw colour", () => {
  assert.equal(familyHue("hits"), "var(--fam-hits)");
  assert.ok(!familyHue("wash").startsWith("#"));
});

/* The phase contexts the arranger actually emits, observed on real scores. */
const REAL_PHASES = [
  "intro", "drop", "silence", "break", "verse", "build", "final_drop", "outro",
];

test("every phase the arranger emits has a tint", () => {
  for (const p of REAL_PHASES) {
    assert.ok(PHASE_VAR[p], `no tint for phase ${p}`);
  }
});

test("an unknown or absent phase falls back rather than breaking", () => {
  assert.equal(phaseTint("nonesuch"), "var(--phase-unknown)");
  assert.equal(phaseTint(null), "var(--phase-unknown)");
  assert.equal(phaseTint(undefined), "var(--phase-unknown)");
});

test("a known phase resolves to its own tint", () => {
  assert.equal(phaseTint("final_drop"), "var(--phase-final-drop)");
});
```

- [ ] **Step 2: Run to verify it fails**

From `limelight-ui/`: `npm test`
Expected: FAIL — `Cannot find module` for `./tokens.ts`.

- [ ] **Step 3: Write the implementation**

Create `lib/tokens.ts`:

```ts
import type { Family } from "./types";

/* A component never hardcodes a colour. It names what a thing IS — a lane
   family, a song phase — and gets back the variable that carries the hue. */

export const FAMILY_VAR: Record<Family, string> = {
  hits: "--fam-hits",
  darkness: "--fam-darkness",
  strobe: "--fam-strobe",
  lift: "--fam-lift",
  breath: "--fam-breath",
  wash: "--fam-wash",
  dynamics: "--fam-dynamics",
};

export function familyHue(family: Family): string {
  return `var(${FAMILY_VAR[family]})`;
}

/* Section bands tint from the score's own phase context, at low chroma, so
   structure reads as background while clips stay foreground. */
export const PHASE_VAR: Record<string, string> = {
  intro: "--phase-intro",
  drop: "--phase-drop",
  silence: "--phase-silence",
  break: "--phase-break",
  verse: "--phase-verse",
  build: "--phase-build",
  final_drop: "--phase-final-drop",
  outro: "--phase-outro",
};

/** A score may name a phase we have no tint for; that is not an error. */
export function phaseTint(phase: string | null | undefined): string {
  const v = phase ? PHASE_VAR[phase] : undefined;
  return `var(${v ?? "--phase-unknown"})`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: `fail 0`, 48 tests (42 pre-existing + 6 new).

Run: `npx tsc --noEmit`
Expected: no output.

> **Do not commit.**

---

## Task 3: Fonts

Newsreader is the most distinctive thing about the current look and also the reason the creator side reads as an editorial layout rather than an instrument. It goes. One sans, plus a real mono for numerics.

**Files:**
- Modify: `app/layout.tsx`

- [ ] **Step 1: Replace the font setup**

Replace the whole contents of `app/layout.tsx` with:

```tsx
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

/* Every number in this product is read against other numbers — bar·beat,
   timecode, frame counts — so they are monospaced and tabular throughout. */
const mono = JetBrains_Mono({
  variable: "--font-mono-face",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Limelight",
  description: "Design lighting shows for music, on a timeline.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-density="studio"
      className={`${inter.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Verify the build**

Run: `npx next build`
Expected: `✓ Compiled successfully`. Next downloads JetBrains Mono at build time; if the network is unavailable the build fails with a font-fetch error — report that as BLOCKED rather than switching fonts on your own.

Run: `npm test` → `fail 0`. Run: `npx tsc --noEmit` → no output.

> **Do not commit.**

---

## Task 4: The gallery route

This is how the design system gets verified. Not assertions — you look at it.

**Files:**
- Create: `app/gallery/page.tsx`

- [ ] **Step 1: Create the gallery shell**

Create `app/gallery/page.tsx`:

```tsx
"use client";

import { useState } from "react";

/* Dev-only. The design system's real test is looking at it: every primitive,
   every state, both densities, on the surfaces it will actually sit on. */

type Density = "studio" | "booth";

export function Swatch({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex items-center gap-[var(--spacing-s2)]">
      <span
        className="w-8 h-8 rounded border border-solid border-line flex-none"
        style={{ background: value }}
      />
      <span className="mono text-[length:var(--text-xs)] text-ink-dim">{name}</span>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="py-[var(--spacing-s6)] border-b border-solid border-line">
      <h2 className="text-[length:var(--text-lg)] font-medium mb-[var(--spacing-s4)]">{title}</h2>
      <div className="flex flex-wrap items-start gap-[var(--spacing-s5)]">{children}</div>
    </section>
  );
}

export default function GalleryPage() {
  const [density, setDensity] = useState<Density>("studio");

  return (
    <div
      data-density={density}
      className="h-screen overflow-y-auto bg-bg text-ink px-[var(--spacing-s7)] py-[var(--spacing-s6)]"
    >
      <header className="flex items-baseline justify-between gap-[var(--spacing-s4)] pb-[var(--spacing-s5)]">
        <div>
          <h1 className="text-[length:var(--text-2xl)] font-medium tracking-[-0.02em]">
            Design system
          </h1>
          <p className="text-[length:var(--text-sm)] text-ink-dim mt-1">
            Every primitive, every state. Switch density to check both ergonomics.
          </p>
        </div>
        <div className="flex gap-[var(--spacing-s2)]">
          {(["studio", "booth"] as Density[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDensity(d)}
              className={`h-[var(--hit)] px-[var(--spacing-s3)] rounded border border-solid cursor-pointer text-[length:var(--text-sm)] transition-colors duration-[var(--dur-state)] ${
                density === d
                  ? "border-line-strong bg-bg-raised text-ink"
                  : "border-line text-ink-dim hover:text-ink"
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </header>

      <Section title="Surfaces">
        <Swatch name="--bg-sunken" value="var(--bg-sunken)" />
        <Swatch name="--bg" value="var(--bg)" />
        <Swatch name="--bg-raised" value="var(--bg-raised)" />
        <Swatch name="--bg-overlay" value="var(--bg-overlay)" />
        <Swatch name="--stage" value="var(--stage)" />
      </Section>

      <Section title="Lane families">
        <Swatch name="hits" value="var(--fam-hits)" />
        <Swatch name="darkness" value="var(--fam-darkness)" />
        <Swatch name="strobe" value="var(--fam-strobe)" />
        <Swatch name="lift" value="var(--fam-lift)" />
        <Swatch name="breath" value="var(--fam-breath)" />
        <Swatch name="wash" value="var(--fam-wash)" />
        <Swatch name="dynamics" value="var(--fam-dynamics)" />
      </Section>

      <Section title="Song phases">
        <Swatch name="intro" value="var(--phase-intro)" />
        <Swatch name="drop" value="var(--phase-drop)" />
        <Swatch name="silence" value="var(--phase-silence)" />
        <Swatch name="break" value="var(--phase-break)" />
        <Swatch name="verse" value="var(--phase-verse)" />
        <Swatch name="build" value="var(--phase-build)" />
        <Swatch name="final_drop" value="var(--phase-final-drop)" />
        <Swatch name="outro" value="var(--phase-outro)" />
      </Section>

      <Section title="State">
        <Swatch name="ok" value="var(--ok)" />
        <Swatch name="warn" value="var(--warn)" />
        <Swatch name="danger" value="var(--danger)" />
        <Swatch name="focus / playhead" value="var(--focus)" />
      </Section>

      <Section title="Type">
        <div className="flex flex-col gap-[var(--spacing-s2)]">
          <span className="text-[length:var(--text-2xl)]">Display 28</span>
          <span className="text-[length:var(--text-xl)]">Title 22</span>
          <span className="text-[length:var(--text-lg)]">Heading 18</span>
          <span className="text-[length:var(--text-md)]">Emphasis 15</span>
          <span className="text-[length:var(--text-sm)]">Body 13</span>
          <span className="text-[length:var(--text-xs)] text-ink-dim">Meta 12</span>
          <span className="label">Micro label</span>
          <span className="mono">bar 33 · beat 2 · 0:34.86 · 9494 frames</span>
        </div>
      </Section>
    </div>
  );
}
```

- [ ] **Step 2: Verify it renders**

Run: `npx next build`
Expected: `✓ Compiled successfully`, and `/gallery` appears in the printed route list.

Run: `npx tsc --noEmit` → no output.

Then look at it: `npm run dev` and open `http://localhost:3000/gallery`. Confirm the surfaces form a visible ladder, the seven family hues are distinguishable from each other, the phase tints are clearly *quieter* than the family hues, and switching density visibly changes control height.

> **Do not commit.** Report what you saw, including anything that looked wrong.

---

## Task 5: `Button` and `IconButton`

The legacy `Button` has five variants doing unrelated jobs (`default`, `big`, `link`, `panic`, `icon`). The replacement has four honest intents plus a separate icon component.

**Files:**
- Create: `components/primitives/Button.tsx`
- Modify: `app/gallery/page.tsx` (add a section)

- [ ] **Step 1: Write the component**

Create `components/primitives/Button.tsx`:

```tsx
"use client";

import { type ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  wide?: boolean;
}

const base =
  "inline-flex items-center justify-center gap-[var(--spacing-s2)] h-[var(--hit)] " +
  "px-[var(--spacing-s3)] rounded-[5px] border border-solid cursor-pointer " +
  "text-[length:var(--text-sm)] whitespace-nowrap " +
  "transition-colors duration-[var(--dur-state)] " +
  "disabled:cursor-default disabled:opacity-40";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-bg border-ink hover:opacity-90",
  secondary: "bg-bg-raised text-ink border-line-strong hover:border-ink-dim",
  ghost: "bg-transparent text-ink-dim border-transparent hover:text-ink hover:bg-bg-raised",
  danger: "bg-transparent text-danger border-danger hover:bg-danger hover:text-bg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "secondary", wide, className = "", ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={`${base} ${variants[variant]} ${wide ? "w-full" : ""} ${className}`}
      {...props}
    />
  ),
);
Button.displayName = "Button";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: an icon alone tells a screen reader nothing. */
  label: string;
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, active, className = "", children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`inline-flex items-center justify-center w-[var(--hit)] h-[var(--hit)] rounded-[5px] border border-solid cursor-pointer transition-colors duration-[var(--dur-state)] disabled:cursor-default disabled:opacity-40 ${
        active
          ? "bg-bg-raised text-ink border-line-strong"
          : "bg-transparent text-ink-dim border-transparent hover:text-ink hover:bg-bg-raised"
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  ),
);
IconButton.displayName = "IconButton";
```

- [ ] **Step 2: Add it to the gallery**

In `app/gallery/page.tsx`, add this import at the top:

```tsx
import { Button, IconButton } from "@/components/primitives/Button";
```

and add this `<Section>` directly after the `"Type"` section:

```tsx
      <Section title="Button">
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="primary" disabled>Disabled</Button>
        <IconButton label="Play">▶</IconButton>
        <IconButton label="Snap" active>⌗</IconButton>
        <IconButton label="Delete" disabled>×</IconButton>
      </Section>
```

- [ ] **Step 3: Verify**

Run: `npx next build` → compiles. `npx tsc --noEmit` → no output. `npm test` → `fail 0`.

Look at `/gallery`: confirm the four variants are visually distinct, that `primary` is the clear default action, that disabled reads as disabled, and that in `booth` density every control is noticeably taller.

> **Do not commit.**

---

## Task 6: `Input` and `Field`

**Files:**
- Create: `components/primitives/Input.tsx`
- Modify: `app/gallery/page.tsx`

- [ ] **Step 1: Write the components**

Create `components/primitives/Input.tsx`:

```tsx
"use client";

import { type InputHTMLAttributes, forwardRef, useId } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  wide?: boolean;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ wide, invalid, className = "", ...props }, ref) => (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={`h-[var(--hit)] px-[var(--spacing-s2)] rounded-[5px] bg-bg-sunken border border-solid outline-none text-[length:var(--text-sm)] text-ink transition-colors duration-[var(--dur-state)] disabled:opacity-40 ${
        invalid ? "border-danger" : "border-line-strong focus:border-ink-dim"
      } ${wide ? "w-full" : ""} ${className}`}
      {...props}
    />
  ),
);
Input.displayName = "Input";

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: (id: string) => React.ReactNode;
}

/** Pairs a label with whatever control it describes, wiring up the id so the
 *  label is clickable and the hint is announced. */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-[6px]">
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children(id)}
      {error ? (
        <span className="text-[length:var(--text-xs)] text-danger">{error}</span>
      ) : hint ? (
        <span className="text-[length:var(--text-xs)] text-ink-dimmer">{hint}</span>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Add it to the gallery**

Add the import:

```tsx
import { Input, Field } from "@/components/primitives/Input";
```

and a section after `"Button"`:

```tsx
      <Section title="Input">
        <Field label="Show name">
          {(id) => <Input id={id} placeholder="name this show" />}
        </Field>
        <Field label="Seed" hint="changes the whole arrangement">
          {(id) => <Input id={id} defaultValue="1" className="mono w-[80px]" />}
        </Field>
        <Field label="Author" error="that name is taken">
          {(id) => <Input id={id} defaultValue="muzammil" invalid />}
        </Field>
        <Field label="Disabled">
          {(id) => <Input id={id} placeholder="unavailable" disabled />}
        </Field>
      </Section>
```

- [ ] **Step 3: Verify**

`npx next build`, `npx tsc --noEmit`, `npm test` — all clean. Look at `/gallery`: clicking a label should focus its input; the invalid one should read as an error without relying on colour alone (it has `aria-invalid` and the message).

> **Do not commit.**

---

## Task 7: `Panel`, `EmptyState`, `Badge`, `StatusDot`

**Files:**
- Create: `components/primitives/Panel.tsx`
- Create: `components/primitives/Status.tsx`
- Modify: `app/gallery/page.tsx`

- [ ] **Step 1: Write `Panel.tsx`**

```tsx
"use client";

interface PanelProps {
  title?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** A raised region with an optional header. Hierarchy from elevation and a
 *  hairline, never from a drawn box. */
export function Panel({ title, actions, children, className = "" }: PanelProps) {
  return (
    <section
      className={`flex flex-col min-h-0 bg-bg-raised border border-solid border-line rounded-[7px] overflow-hidden ${className}`}
    >
      {(title || actions) && (
        <header className="flex-none flex items-center justify-between gap-[var(--spacing-s3)] px-[var(--spacing-s4)] py-[var(--spacing-s3)] border-b border-solid border-line">
          {title && <span className="label">{title}</span>}
          {actions}
        </header>
      )}
      <div className="flex-1 min-h-0 p-[var(--spacing-s4)]">{children}</div>
    </section>
  );
}

interface EmptyStateProps {
  title: string;
  /** Say what to do next, not that a count is zero. */
  body: string;
  action?: React.ReactNode;
}

export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-[var(--spacing-s2)] py-[var(--spacing-s7)] px-[var(--spacing-s5)]">
      <p className="text-[length:var(--text-md)] text-ink">{title}</p>
      <p className="text-[length:var(--text-sm)] text-ink-dim max-w-[38ch]">{body}</p>
      {action && <div className="mt-[var(--spacing-s2)]">{action}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Write `Status.tsx`**

```tsx
"use client";

type Tone = "neutral" | "ok" | "warn" | "danger";

const toneText: Record<Tone, string> = {
  neutral: "text-ink-dim border-line",
  ok: "text-ok border-ok",
  warn: "text-warn border-warn",
  danger: "text-danger border-danger",
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-block px-[9px] py-[3px] rounded-full border border-solid text-[length:var(--text-xs)] whitespace-nowrap ${toneText[tone]}`}
    >
      {children}
    </span>
  );
}

const toneDot: Record<Tone, string> = {
  neutral: "bg-ink-dimmer",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
};

/** State is carried by the label as well as the colour — a dot alone is not a
 *  status, and colour alone is not an accessible signal. */
export function StatusDot({
  tone = "neutral",
  children,
  title,
}: {
  tone?: Tone;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-[var(--spacing-s2)] text-[length:var(--text-xs)] text-ink-dim whitespace-nowrap"
      title={title}
    >
      <span className={`w-[7px] h-[7px] rounded-full flex-none ${toneDot[tone]}`} />
      {children}
    </span>
  );
}
```

- [ ] **Step 3: Add both to the gallery**

Add imports:

```tsx
import { Panel, EmptyState } from "@/components/primitives/Panel";
import { Badge, StatusDot } from "@/components/primitives/Status";
```

and a section:

```tsx
      <Section title="Panel, status">
        <Panel title="Rig" className="w-[280px]" actions={<Badge tone="ok">sending</Badge>}>
          <div className="flex flex-col gap-[var(--spacing-s2)]">
            <StatusDot tone="ok">40 fps to Art-Net 10.0.0.9</StatusDot>
            <StatusDot tone="warn">strobe capped at 120</StatusDot>
            <StatusDot tone="danger">no output — socket closed</StatusDot>
            <StatusDot>standby</StatusDot>
          </div>
        </Panel>
        <Panel title="Shows" className="w-[320px]">
          <EmptyState
            title="No saved shows yet"
            body="Open a song from the library and place your first effect — saving keeps the venue it was designed for."
            action={<Button variant="primary">Browse songs</Button>}
          />
        </Panel>
        <div className="flex gap-[var(--spacing-s2)]">
          <Badge>neutral</Badge>
          <Badge tone="ok">ok</Badge>
          <Badge tone="warn">warn</Badge>
          <Badge tone="danger">danger</Badge>
        </div>
      </Section>
```

- [ ] **Step 4: Verify**

`npx next build`, `npx tsc --noEmit`, `npm test` — all clean. Look at `/gallery`: the panel should sit visibly above the page ground, and the empty state should read as guidance rather than a zero count.

> **Do not commit.**

---

## Task 8: `Menu`

Needed by the surface switcher and every contextual action in Plan 3 and beyond. There is no menu primitive today.

**Files:**
- Create: `components/primitives/Menu.tsx`
- Modify: `app/gallery/page.tsx`

- [ ] **Step 1: Write the component**

Create `components/primitives/Menu.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

export interface MenuItem {
  id: string;
  label: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
}

interface MenuProps {
  trigger: React.ReactNode;
  items: MenuItem[];
  onPick: (id: string) => void;
  align?: "left" | "right";
}

export function Menu({ trigger, items, onPick, align = "left" }: MenuProps) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  /* Close on an outside pointer or on Escape. Both matter: a menu you cannot
     dismiss without choosing something is a trap. */
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div ref={boxRef} className="relative inline-block">
      <span onClick={() => setOpen((v) => !v)}>{trigger}</span>
      {open && (
        <div
          role="menu"
          className={`absolute top-[calc(100%+4px)] z-50 min-w-[180px] py-[var(--spacing-s1)] bg-bg-overlay border border-solid border-line-strong rounded-[7px] shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                onPick(it.id);
              }}
              className={`flex w-full items-baseline justify-between gap-[var(--spacing-s4)] text-left px-[var(--spacing-s3)] py-[var(--spacing-s2)] bg-transparent border-0 cursor-pointer text-[length:var(--text-sm)] transition-colors duration-[var(--dur-state)] disabled:opacity-40 disabled:cursor-default ${
                it.danger ? "text-danger hover:bg-danger/15" : "text-ink hover:bg-bg-raised"
              }`}
            >
              <span>{it.label}</span>
              {it.hint && <span className="mono text-[length:var(--text-xs)] text-ink-dimmer">{it.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add it to the gallery**

Add the import:

```tsx
import { Menu } from "@/components/primitives/Menu";
```

and a section:

```tsx
      <Section title="Menu">
        <Menu
          trigger={<Button variant="secondary">Clip actions ▾</Button>}
          items={[
            { id: "dup", label: "Duplicate", hint: "⌘D" },
            { id: "repeat", label: "Repeat on every chorus" },
            { id: "dis", label: "Unavailable here", disabled: true },
            { id: "del", label: "Delete", hint: "⌫", danger: true },
          ]}
          onPick={(id) => console.log("picked", id)}
        />
      </Section>
```

- [ ] **Step 3: Verify**

`npx next build`, `npx tsc --noEmit`, `npm test` — all clean. Look at `/gallery`: open the menu, then confirm it closes on Escape **and** on a click outside, that the disabled item cannot be picked, and that the danger item reads as destructive.

> **Do not commit.**

---

## Task 9: `Dialog`

**Files:**
- Create: `components/primitives/Dialog.tsx`
- Modify: `app/gallery/page.tsx`

- [ ] **Step 1: Write the component**

Create `components/primitives/Dialog.tsx`:

```tsx
"use client";

import { useEffect } from "react";

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function Dialog({ open, title, onClose, children, footer }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh] px-[var(--spacing-s5)] bg-[rgba(4,5,8,0.62)]"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-[min(680px,100%)] max-h-[78vh] flex flex-col bg-bg-overlay border border-solid border-line-strong rounded-[9px] overflow-hidden"
      >
        <header className="flex-none flex items-center justify-between gap-[var(--spacing-s4)] px-[var(--spacing-s5)] py-[var(--spacing-s4)] border-b border-solid border-line">
          <h2 className="text-[length:var(--text-lg)] font-medium">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="w-[var(--hit)] h-[var(--hit)] rounded-[5px] bg-transparent border-0 cursor-pointer text-ink-dim hover:text-ink transition-colors duration-[var(--dur-state)]"
          >
            ×
          </button>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto px-[var(--spacing-s5)] py-[var(--spacing-s4)]">
          {children}
        </div>
        {footer && (
          <footer className="flex-none flex justify-end gap-[var(--spacing-s2)] px-[var(--spacing-s5)] py-[var(--spacing-s4)] border-t border-solid border-line">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add it to the gallery**

Add the import and a `useState` for it (the gallery already imports `useState`):

```tsx
import { Dialog } from "@/components/primitives/Dialog";
```

Inside `GalleryPage`, next to the existing density state, add:

```tsx
  const [dialogOpen, setDialogOpen] = useState(false);
```

and add a section:

```tsx
      <Section title="Dialog">
        <Button variant="secondary" onClick={() => setDialogOpen(true)}>
          Open dialog
        </Button>
        <Dialog
          open={dialogOpen}
          title="Designing for"
          onClose={() => setDialogOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => setDialogOpen(false)}>Use this rig</Button>
            </>
          }
        >
          <p className="text-[length:var(--text-sm)] text-ink-dim">
            Pick the venue this show is designed for. The rig it declares is what the
            show is rendered against.
          </p>
        </Dialog>
      </Section>
```

- [ ] **Step 3: Verify**

`npx next build`, `npx tsc --noEmit`, `npm test` — all clean. Look at `/gallery`: confirm the dialog closes on Escape and on a backdrop click, but **not** when clicking inside it.

> **Do not commit.**

---

## Task 10: Barrel export and final pass

**Files:**
- Create: `components/primitives/index.ts`

- [ ] **Step 1: Write the barrel**

Create `components/primitives/index.ts`:

```ts
export { Button, IconButton } from "./Button";
export { Input, Field } from "./Input";
export { Panel, EmptyState } from "./Panel";
export { Badge, StatusDot } from "./Status";
export { Menu, type MenuItem } from "./Menu";
export { Dialog } from "./Dialog";
```

- [ ] **Step 2: Full verification**

From `limelight-ui/`, run all three:

```bash
npm test && npx tsc --noEmit && npx next build
```

Expected: `pass 48 / fail 0`; no tsc output; `✓ Compiled successfully` with `/gallery` in the route list.

- [ ] **Step 3: Look at the finished gallery**

`npm run dev`, open `http://localhost:3000/gallery`, and check each of these deliberately:

1. The four surfaces form a visible ladder against each other.
2. All seven family hues are distinguishable side by side — and still distinguishable if you squint (lightness varies, not just hue).
3. Phase tints are clearly quieter than family hues. Sections must read as background.
4. No component uses a family hue for a non-lane purpose, and no state colour (ok/warn/danger) appears anywhere except status.
5. Switching to `booth` density grows every control; nothing overlaps or clips.
6. Tab through the page: the focus ring is visible on every interactive element, on every surface tier.
7. Every number renders monospaced and tabular.

> **Do not commit.** Report anything that looked wrong, with what you saw.

---

## Self-review

**Spec coverage.** §7.1 surfaces → Task 1. §7.2 colour-as-meaning → Tasks 1–2. §7.3 type and dropping Newsreader → Tasks 1, 3. §7.4 density → Task 1. §7.5 timeline metrics → Task 1 (defined now, consumed in Plan 4). §7.6 motion → Task 1, with `prefers-reduced-motion`. §7.7 components → Tasks 5–10, minus the eight deferred to Plan 4. §7.8 accessibility → focus ring in Task 1, `aria-label` on `IconButton`, `Field` label wiring, `aria-modal` on `Dialog`, verified in Task 10 Step 3.

**Deliberately deferred.** `NumberInput`, `Select`, `Toggle`, `Segmented`, `Slider`, `Tooltip`, `Sheet`, `Toast` — all land in Plan 4 where the editor consumes them. Building them here would be speculative.

**Known temporary state.** Legacy `components/ui/` and the legacy screens under `app/(portal)/` still reference removed tokens and will look wrong after Task 1. They still compile, which is the bar. Plan 3 deletes them.

**Type consistency.** `Family` comes from `lib/types.ts` throughout; `FAMILY_VAR` is keyed by it and checked against `FAMILY_ORDER` from `lib/families.ts`. `Tone` is defined once in `Status.tsx` and used by both `Badge` and `StatusDot`. `MenuItem` is exported from `Menu.tsx` and re-exported by the barrel. Every component reads sizing from `--hit`, so density applies uniformly.
