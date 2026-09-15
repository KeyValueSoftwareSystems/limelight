# Limelight — Studio redesign and timeline editor

**Date:** 2026-09-15
**Status:** approved design, ready for implementation planning

---

## 1. What this is

A rebuild of the Limelight portal UI around two things: a clear split between the
two jobs the product serves, and a timeline editor that lets a music creator
shape a lighting show visually instead of by placing values.

The product bakes a lighting show from a song. An arranger reads the score and
writes a complete show; the creator then edits it. Today that editing happens
through a 38-pixel strip and a modal "arm an effect, then click" gesture. This
document replaces that with a track-based timeline, and rebuilds the surrounding
application so it reads as an instrument rather than an admin dashboard.

The product's core value is that the machine writes a good show from the music.
Every decision here protects that: the creator overrides the arranger one
decision at a time, and everything untouched keeps regenerating.

---

## 2. What is wrong today

Findings from reading the frontend and the Python backend it talks to, and from
baking a real show (`levels`, 124 bars) against the running server.

**Hierarchy has collapsed.** Nearly all chrome is `--text-xs` — 10px — uppercase
at 0.18em tracking: the brand, nav tabs, role toggle, panel headers, section
labels, footer. When everything is a small-caps label, nothing is a heading. The
only real typographic weight, a 31px serif, is spent on the song title.

**Two nav strips that mean different things, styled identically.**
`Library / Venues / Marketplace` changes the page. `Creator / Venue` changes the
application — light to dark, 13px to 15px body text, 28px to 44px hit targets, a
different nav set, a different right rail. Both sit in the same bar at the same
size with the same underline-on-active. This is the largest single source of
confusion.

**The timeline is one 38px strip doing three jobs.** Section bands, effect
placements and the playhead all draw into the same band, so clips cover the
section names beneath them. Every effect is the same accent colour whatever it
does. Past four or five edits it is an unreadable smear.

**The engine has a layering model; the UI shows none of it.** `frame.js` resolves
one effect *per renderer type per beat* by priority. Two `white_blast` effects
placed over each other means one silently disappears. The UI permits it, warns
nothing, and the lights quietly disagree with the screen.

**Placement is modal and nearly invisible.** Clicking an effect pill "arms" it;
the only feedback is a line of text in the right rail and a changed cursor. No
drag from the palette, no drop preview, no ghost. There is **no undo anywhere in
the application**.

**The music is invisible.** The API already returns 124 downbeats, a 199-value
per-bar energy curve, and 12 labelled musical moments — `entrance/drums` at bar
9, `hook/the riff` at bar 25, `release/tension` at bar 33, `pause/everything but
bass` at bar 51. None of it is drawn. That data is exactly the "waveform" a
lighting timeline needs.

**The centre column is eight stacked strips.** Target line, song header, canvas,
status message, transport, beat readout, zoom ribbon, timeline. The preview — the
thing being judged — gets whatever is left.

**Creators cannot reopen their own work.** `TABS.creator` is
Library/Venues/Marketplace and `/shows` is venue-only, so a creator can save a
show and then has no route back to it.

**Errors are swallowed.** Nearly every API call ends in `.catch(() => {})`. With
the backend down the app renders empty with no explanation.

**Other:** venue selection lives in three places with three affordances;
"Design" on the Venues page jumps sideways to `/library` with no breadcrumb; save
is a bare text field and a link with no dirty state; zoom is four fixed steps;
`Conversation.tsx` and `useMidi.ts` are written but mounted nowhere; and
`stage/page.tsx` is a 343-line component doing bake orchestration, playback,
keyboard, saving, venue picking and layout at once.

---

## 3. Decisions

| Decision | Choice |
|---|---|
| Backend | Changes to `limelight/portal/` are in scope |
| Surfaces | Two — **Studio** (create) and **Booth** (run), separately routed |
| Layouts | `club16-2head` (16 par + 2 head) and `arc4-head` (4 par + 1 head) |
| Feedback loop | Optimistic local timeline, debounced background bake |
| Visual | Dark-first, one design system across both surfaces |
| Track model | Lanes are effect families, derived from the renderer's types |
| Auto show | Arranger output appears as ghost clips; editing one materialises it |

### Why lanes are families, not free tracks

The 13 palette tiles map onto only 7 renderer types. That type *is* a natural
lane: two clips of the same family can never overlap because `frame.js` cannot
honour it, and different families always compose correctly. The UI's rule becomes
the engine's rule, so the picture and the lights cannot disagree.

Free tracks (the literal CapCut model) would require reworking how `frame.js`
resolves priority so track order drives it — engine surgery that would also
change how already-saved shows render. The expandability it appears to buy is
paid for twice.

Control comes instead from materialising the auto show and from a real inspector
over the dials the API already exposes.

---

## 4. Information architecture

```
/                         → last-used surface (default Studio)

STUDIO  (create a show at a desk)
  /studio                 Songs      — pick what to light
  /studio/edit/[song]     Editor     — the timeline editor
  /studio/shows           My shows   — everything you have saved
  /studio/market          Market     — list and browse
  /studio/venues          Venues     — secondary; reached from the target picker

BOOTH  (run a show in a dark room)
  /booth                  Tonight    — shows ready to run
  /booth/run/[showId]     Run        — live console
  /booth/rig              Rig        — output, limits, diagnostics
  /booth/market           Market     — acquire shows
```

**Venues stops being a nav peer.** The chain is: a venue owns one or more named
layouts; each layout points at a rig file; the rig file is the fixture list the
show bakes against. So a venue is the *target of the show being edited*, not a
destination. It lives in the editor header as `Designing for — KeyCode Stage ·
Main stage` and opens a picker. Browsing the catalogue remains possible at
`/studio/venues`, reached from that picker.

**Creators get `My shows`**, closing the dead end above.

**The surface switcher is not a tab.** It sits in the top-left identity zone,
reads as a mode, and is a route change, so the back button and bookmarks work.
The tab strip contains only destinations within the current surface.

**Top bar zones**, consistent across surfaces:

```
┌──────────────────────────────────────────────────────────────────────┐
│ [◆ Studio ▾]  Songs  Shows  Market        [context actions]  [status] │
└──────────────────────────────────────────────────────────────────────┘
     surface          destinations              save state      rig
```

In Booth the status zone carries the live rig pill and arm control; in Studio it
carries save state and the bake indicator. The current `Footer` is removed — its
facts (frame count, fps, channels) move into the editor status line.

**Every screen states its purpose** in one plain line under the title, and every
empty state teaches rather than reporting a count of zero.

---

## 5. The timeline editor

### 5.1 Layout

Three regions above, timeline below, split by a draggable divider whose position
persists.

```
┌───────────────────────────────────────────────────────────────────────┐
│ ‹ Songs   Levels · 128 bpm · 124 bars    Designing for KeyCode ▾  Saved│
├────────────┬─────────────────────────────────────┬────────────────────┤
│  PALETTE   │          STAGE PREVIEW              │     INSPECTOR      │
├────────────┴─────────────────────────────────────┴────────────────────┤
│ ▶  0:34 / 3:57   bar 17·1        ⌕ ──●────  fit   snap: bar ▾         │
├═══════════════════════════════════════ ↕ drag to resize ══════════════┤
│ bars     1      5      9     13     17     21     25     29     33    │
│ SECTIONS │ intro       │ drop                    │ breakdown │ drop   │
│ ENERGY   ▁▂▃▅▇▇▅▃▂▁▂▃▅▇█▇▅▃▂▁▂▃▅▇█▇▅▃▂▁▂▃▅▇█▇▅▃▂▁▂▃▅▇█▇▅▃▂▁▂▃▅▇     │
│ MOMENTS         ◆ drums              ◆ the riff        ◆ tension      │
│ Hits     │      ░░      ▓▓▓▓       ░░        ▓▓                       │
│ Darkness │                    ░                                       │
│ ⊕ effects here                                                        │
│ Dynamics  ╱‾‾╲__╱‾‾‾‾‾╲____╱‾‾‾‾‾‾╲___                                │
└───────────────────────────────────────────────────────────────────────┘
                              ░ = auto (ghost)    ▓ = yours (solid)
```

### 5.2 The three bands

**The music** — read-only, and the waveform equivalent. A video editor shows the
video; this shows the shape of the song.

- **Ruler** — bars, beats fading in with zoom, time secondary
- **Sections** — the score's structure as bands, each showing its name and base
  look (`hold_indigo`, `hit_green`). Click selects, double-click zooms to it
- **Energy** — the per-bar curve as a filled area
- **Moments** — labelled pins sized by weight; the strongest "put something here"
  hints the system has, and snap targets

**Effect lanes** — six possible clip lanes, created on demand. Dynamics (§ below)
is a seventh lane but holds a curve rather than clips, which is why `Family` has
seven members while only six lanes accept a drop.

| Lane | Renderer type | Palette tiles |
|---|---|---|
| Hits | `white_blast` | Impact, Flash, Stab, Cross, Swell |
| Darkness | `blackout` | Blackout, Cut |
| Strobe | `accent_strobe` | Fill flicker |
| Lift | `hook` | Hook lift |
| Breath | `pause` | Hush |
| Wash | `whiten` | Riser |

A new show opens with one empty drop zone, not six empty rows. Each lane header
carries its name, clip count and a bypass toggle.

**Dynamics** — the arranger's ~39 `modulate`/`ramp` assignments as one bendable
envelope rather than 39 rectangles reading `gain: 1.01`. The Exit dip tile drops
onto this lane as a shaped dip in the curve.

### 5.3 What the arranger emits

Measured on `levels`: **114 assignments** before the creator touches anything.
They are not one kind of thing, and each needs its own representation.

| Arranger output | Count | Representation |
|---|---|---|
| `fx` + `accent` — blasts, blackouts, hooks, pauses, strobes | 35 | Editable clips in family lanes |
| `par` / `head` — `hold_indigo`, `head_roam_dusk`, `hit_green` | 34 | A property on each section band |
| `modulate` / `ramp` — `{gain, motion}` per 4 bars | 39 | The Dynamics envelope |
| `whiten` | 6 | Clips in the Wash lane |

### 5.4 Clip states

- **Auto** — outlined, ~40% fill. The arranger wrote it
- **Yours** — solid, family hue
- **Overridden** — an auto clip replaced by one of yours: struck through and
  dimmed. Surfaces the replace-semantics already in `effects.js`, currently
  invisible
- **Selected** — handles out, inspector bound
- **Stale** — a bake is in flight; a progress hairline on affected clips. The
  stage never blanks

Same-family overlap is **prevented at drop time** with a bump, not created and
then flagged, because the engine cannot honour it.

### 5.5 Interactions

**Add** — drag a palette tile onto the timeline. A ghost follows the cursor with
a live `bar 17 · beat 1` readout; the target lane highlights; the snap guide
labels what it is locking to. Double-clicking a tile places it at the playhead.
With a section selected, a tile can fill that section.

**Move** — horizontal drag with snapping. Vertical drag is locked and the cursor
says so rather than silently doing nothing.

**Trim** — either edge, minimum one beat, readout in beats and bars.

**Select** — click; shift-click extends; drag on empty timeline box-selects.
Scrubbing moves to the ruler only, which frees the drag gesture.

**Contextual toolbar** — floats above the selection: Duplicate, Delete, and
**Repeat on every section like this one** (place a Stab on the first chorus, get
one on all four). Right-click gives the same menu.

**Delete** — a clip of yours vanishes; an auto clip records a suppression so it
stays gone.

**Undo/redo** across everything, ⌘Z / ⇧⌘Z.

### 5.6 Snapping

Musical, not temporal. Within `--snap-threshold`, in priority order:

```
playhead → section boundary → moment → bar → beat
```

A labelled guide shows the target (`chorus`, `◆ the riff`, `bar 33`). Hold Alt to
suspend. Default strength **bar**, matching where effects sound right and what
the backend does today.

### 5.7 Navigation

Continuous cursor-anchored zoom on ⌘-scroll, replacing the four fixed steps.
Plain scroll pans. `F` fits the song, `⇧F` the selection, `Z` the current
section. An overview strip shows sections and clips in miniature — drag to pan,
drag its edges to zoom. Follow-playhead is on by default, disengages when you pan
manually, re-engages on play.

### 5.8 Inspector

- **Nothing selected** → the show: song, venue target, seed, "how much", save
  state, `12 effects · 4 yours`
- **Clip selected** → name, position, length, and the dials. For a Hit:
  coverage (all/inner/outer/ends/left/right/odd/even), tone (white/key), shape
  (snap/swell/travel), spread, strength. `/api/effects` already returns these
  `dials` and `choices`; the UI ignores them entirely today. Turning a dial on an
  auto clip materialises it
- **Section selected** → bars, phase, base look, contained clips
- **Multi-select** → count and bulk actions

### 5.9 Keyboard

```
Space      play/pause          ⌘Z ⇧⌘Z   undo/redo
← →        nudge one beat      ⌘D       duplicate
⇧← ⇧→      nudge one bar       ⌫        delete
⌘← ⌘→      prev/next section   [ ]      trim start/end to playhead
F ⇧F       fit song/selection  Alt      suspend snapping
1–6        arm palette family  Esc      clear selection
```

### 5.10 Rejected from CapCut

- **No ripple edit.** Time belongs to the song; deleting a clip never moves its
  neighbours. This is the largest divergence and must read as intentional
- **No split/razor.** Half a Swell is not a thing
- **No transitions, no speed ramps, no keyframes.** The engine has no per-clip
  automation; the Dynamics curve is the only envelope that exists
- **No free track creation.** Lanes are families

---

## 6. Data model and backend changes

### 6.1 Backend — four additive changes

**B1 · Effects can start on any beat.** `effects.js` currently computes
`startBeat = (bar - shift - 1) * bpb`, so a clip can only begin on a bar line.

- `server.py` `validate_edits` (~L870) carries a new `beat`, clamped 1–16
- `effects.js` becomes `(bar - shift - 1) * bpb + (beat - 1)`
- `server.py` `describe_edits` (~L884) uses `seconds_at(bar, beat)`

**B2 · Clips carry their own dials.** `save_custom` (~L819–837) already filters
against `DIALS[fx]`, validates against `CHOICES` and clamps numerics to 0–1.
Extract that as `dial_filter(fx, params)` and call it from both `save_custom` and
`validate_edits`. In `effects.js`,
`const params = {...spec.params, ...(e.params || {})}` before the
`tone === "key"` hue resolution.

**B3 · Deleting an auto clip.** `Edit` gains `off: true`, meaning *clear the
arranger's assignments of this effect's renderer type across this span and place
nothing*. The span is the edit's own `{bar, beat, beats}`, and `type` still names
a palette tile — the tile's `fx` is what gets cleared. `effects.js` already
filters overlapping same-type assignments out of `p.assignments` before pushing;
for `off` it filters and does not push.

**B4 · Expose the arranger's plan.** Snapshot the punctuation assignments before
the edit loop, tag them, mark which the loop removed, and emit alongside the
frames:

```json
"plan": {
  "punctuation": [
    {"id":"p17","fx":"white_blast","bar":25,"beat":1,"beats":2,
     "params":{},"context":"drop","overridden":false}
  ],
  "dynamics": [{"bar":9,"beats":16,"gain":1.102,"motion":0.15,"doing":"expanding"}],
  "looks":    [{"section":1,"par":"hit_green","head":"head_roam_dusk"}]
}
```

`server.py` `_bake` passes it into the `show` payload.

> **The one trap.** The plan numbers bars in the renderer's corrected space; the
> page numbers them the `session.js` way. `effects.js` crosses that bridge with
> `shift`. Convert on the way out (`uiBar = planBar + shift`) so the frontend
> never has to know `shift` exists. This is the highest-risk change here and
> needs a test.

**Backward compatible.** All four fields are optional. The nine existing files in
`portal/shows/` load unchanged. `edits_token` is a sha1 of the sort-keyed JSON,
so new fields invalidate the bake cache correctly with nothing to change.

### 6.2 No backend work needed

**Lane bypass** is client-side: drop that family's clips from the request and the
arranger's own contribution reappears — exactly what "show me this without my
Hits" should mean.

**Save state and ⌘S** — `api.shows.save` already accepts an `id` for update.

Note that `catalog(LIMITS)` filters out effects a venue forbids, so the palette
is venue-dependent. Switching target can change what is available, and the editor
must say so rather than let tiles silently vanish.

### 6.3 Frontend model

`Edit[]` is the only truth. A `Clip` is derived and never persisted.

```ts
type Family = "hits" | "darkness" | "strobe" | "lift" | "breath" | "wash" | "dynamics";

interface Edit {                        // wire format — 3 new optional fields
  type: string;
  bar: number;
  beat?: number;                        // NEW, default 1
  beats: number;
  params?: Record<string, unknown>;     // NEW
  off?: true;                           // NEW — suppress the arranger here
}

interface Clip {                        // what the timeline draws
  key: string;
  source: "auto" | "mine";
  editIndex: number | null;             // index into edits[] when mine
  planId: string | null;                // arranger assignment when auto
  family: Family;
  tile: string | null;                  // palette tile id — null for arranger clips
  fx: string;                           // renderer effect type — always known
  name: string;
  bar: number; beat: number; beats: number;
  startS: number; endS: number;         // resolved through the grid clock
  params: Record<string, unknown>;
  overridden: boolean;
}
```

`tile` and `fx` are deliberately separate. A clip you placed knows its palette
tile (`stab`) *and* its renderer type (`white_blast`); one the arranger wrote only
ever has the renderer type, because it was never a tile. Collapsing both into one
`type` field would make its meaning depend on `source`.

One selector builds `Clip[]` from `(plan, edits, catalogue, grid)`. Undo/redo is
a stack of `Edit[]` snapshots. A drag mutates a local draft at 60fps and commits
to `Edit[]` on release, which triggers the debounced bake.

### 6.4 Code structure

```
store/session.ts     surface, author, venues, layouts, effect catalogue
store/editor.ts      song, show, frames, edits + history, selection, view, snap
store/booth.ts       rig, trims, limits, live state

hooks/useBake.ts     debounce, token-cancel, keep previous frames, {status, progress}
hooks/useTimeline.ts px↔time↔bar·beat mapping, zoom, snap resolution
hooks/useClipDrag.ts move/trim gesture state machine

lib/clips.ts         plan + edits → Clip[]   (pure)
lib/snap.ts          snap target resolution  (pure)
lib/families.ts      renderer type ↔ family ↔ palette tiles
```

`lib/clips.ts` and `lib/snap.ts` being pure matters: they hold the logic most
likely to be subtly wrong — bar/beat arithmetic, override resolution, snap
priority — and can be tested without a browser.

---

## 7. Design system

### 7.1 Surfaces

Hierarchy from elevation and hairlines, not drawn boxes:

```
--bg-sunken     timeline well, canvas surround
--bg            app ground
--bg-raised     panels, palette, inspector
--bg-overlay    menus, sheets, floating clip toolbar
```

The stage canvas stays near-black (`#07090f`), now with dark chrome around it so
the eye stays adapted and the preview reads truthfully.

### 7.2 Colour carries meaning, and nothing else

Today `--accent` does six unrelated jobs: active section, clip fill, armed tile,
focus ring, active zoom step, hover background.

- **Family hues** — one per lane, used identically on clips, palette tiles and
  lane headers. Hits amber, Darkness violet, Strobe cyan, Lift lime, Breath
  steel-blue, Wash rose, Dynamics neutral. Measured during implementation:
  **seven hues cannot all stay distinct under deuteranopia**, which collapses the
  red/green axis, so some pair always merges whatever palette is chosen. The
  hues are therefore tuned onto a *luminance ladder* (smallest gap 0.079, a 5.6x
  improvement over hue-led values) so lanes still read as distinguishable bands
  when hue collapses. Every family also clears 3.0 contrast on `--bg-raised`.
  Hue remains reinforcement only; every clip and lane header carries its name
- **Sections** — tinted from the score's `phase` context at low chroma. Sections
  are background, clips are foreground
- **Playhead** — one high-contrast neutral, never a hue
- **State** — ok / warn / danger reserved for rig and limits only
- **Selection** — a bright neutral outline and handles, so it reads on any hue

### 7.3 Type

```
--text-2xs  11px   micro-labels, uppercase 0.12em, used sparingly
--text-xs   12px   secondary, meta
--text-sm   13px   body
--text-md   15px   emphasis, lane names
--text-lg   18px   panel and section headings
--text-xl   22px   screen titles
--text-2xl  28px   the one display moment
```

The 10px uppercase treatment is demoted to one job: micro-labels on data.
**Newsreader is dropped** — a serif display face reads editorial, not tool. One
sans family, plus mono for all numerics, **always tabular**.

### 7.4 Density replaces the role reskin

```
[data-density="studio"]   13px base, 28px controls, 24px lanes
[data-density="booth"]    15px base, 44px controls, larger faders
```

Same colours, type ramp and components. Booth is the same system at arm's length,
not a second product.

### 7.5 Timeline metrics

```
--ruler-h 22   --section-h 30   --energy-h 28   --moments-h 18
--lane-h 28 (studio) / 36 (booth)    --lane-gap 2
--clip-radius 3    --handle-w 8    --snap-threshold 8
```

`--handle-w: 8px` is a floor — the current 7px trim grips are below comfortable
pointer accuracy.

### 7.6 Motion

120ms on state changes, 180ms ease-out on panels and menus. **Zero transition on
anything the pointer is dragging** — a clip following the cursor must be exact.
The playhead moves on `requestAnimationFrame`, never a CSS transition.
`prefers-reduced-motion` suppresses panel motion; dragging is unaffected because
it is not decoration.

### 7.7 Components

`Button` currently has five variants doing unrelated jobs. Rebuilt set:
`Button` (primary/secondary/ghost/danger + icon), `IconButton`, `Input`,
`NumberInput`, `Select`, `Slider`, `Toggle`, `Segmented`, `Badge`, `StatusDot`,
`Panel`, `Field`, `EmptyState`, `Tooltip`, `Menu`, `Dialog`, `Sheet`, `Toast`.

`Tooltip` and `Menu` do not exist today and are load-bearing — the clip toolbar,
right-click menus and dial explanations all depend on them. `NumberInput` needs
drag-to-scrub, since typing into bar and beat fields is the fallback the visual
editing replaces.

### 7.8 Accessibility

Focus rings on a neutral, visible against all four surface tiers. Timeline clips
take keyboard focus and respond to arrow-key nudging, so the editor is operable
without a pointer. AA contrast for text; each family hue verified against
`--bg-raised`.

---

## 8. States, errors and edge cases

Currently almost every API call ends `.catch(() => {})`, so failures render as
emptiness. Each of these gets an explicit, explaining state.

| Condition | Source | Treatment |
|---|---|---|
| Backend unreachable | fetch throws | Full-surface message naming the address it tried; retry |
| Bake failed | `status.error` | Inline on the timeline, keep previous frames playing, show the server's message |
| Bake timed out | poll exhausted | Same, with retry; do not silently stop |
| No local score | `"no local score for X"` | Say it on the song card *before* opening, not after |
| Song has no audio | `song.audio === null` | Editable, but transport disabled with the reason |
| Venue locked | `locked_because` | Shown on the venue, target not selectable, reason quoted |
| Layout is a placeholder | `rig_placeholder` | Persistent marker in the editor header — `venues.json` is emphatic that this must never be mistaken for a real rig |
| Effect withheld | `EffectsResponse.withheld[].why` | Tile shown disabled with the reason, not omitted |
| Frames clamped by limits | `limits.frames_clamped` | Notice in the inspector naming the ceiling that bit |
| Same-family overlap | drop-time check | Refuse with a bump; no clip created |
| Unsaved changes on leave | dirty flag | Confirm before navigating away |
| Empty: no songs / shows / clips / listings | — | Teaching empty states, not a zero count |
| Loading: song list, bake, frames | — | Skeletons for lists; hairline for bakes; never a blanked stage |

---

## 9. Testing

`package.json` has no test runner today. The sibling backend uses Node's built-in
runner (`readers/lights/*.test.js`), so match that idiom — `node --test`, no new
dependencies.

**Pure units** (the highest-value tests, because this is where subtle wrongness
lives):

- `lib/clips.ts` — plan + edits → `Clip[]`; override resolution; materialisation;
  suppression
- `lib/snap.ts` — snap priority order, threshold behaviour, Alt suspension
- `lib/grid.ts` — bar/beat ↔ seconds across tempo changes
- `lib/families.ts` — renderer type ↔ family ↔ tile mapping is total

**Backend:**

- `validate_edits` accepts and clamps `beat`, `params`, `off`; rejects unknown
  dials; still accepts old three-field edits
- `effects.js` `startBeat` arithmetic at beat 1 and mid-bar
- **Plan emission bar numbering** — `uiBar = planBar + shift` round-trips for a
  score with `first_bar` set and one without. This is the riskiest change in the
  spec

**Integration:** one bake round-trip against a running server asserting `plan`
shape and that an edit at `{bar, beat}` lands at the expected `from_s`.

**Manual:** drag, trim and snap feel; these cannot be unit tested and need a
checklist pass before sign-off.

---

## 10. Scope

**In:** both surfaces and all screens listed in §4; the timeline editor in full;
the four backend changes; the design system and component set; the states in §8;
the tests in §9.

**Out, deliberately:**

- Layout creation and customisation — future phase, as agreed
- Natural-language editing (`Conversation.tsx` stays unmounted)
- MIDI control (`useMidi.ts` stays unmounted)
- Payments and licensing in Market — it remains a surface
- Editing the arranger's base looks (`par`/`head` per section) beyond displaying
  them
- Free tracks, ripple editing, split, transitions, keyframes

---

## 11. Implementation order

This spec is large — two surfaces, nine screens, a full editor, four backend
changes and a design system. It should be built in stages that each leave the app
working, rather than as one landing.

1. **Foundations** — design tokens, density modes, the component set. Nothing
   user-visible changes shape yet, but everything after depends on it.
2. **Backend** — B1–B4 with their tests, behind no UI. Verifiable against the
   running server independently, and the riskiest item (plan bar numbering) gets
   settled before anything is built on it.
3. **Shell and IA** — routes, surface switcher, top bar, Songs / My shows /
   Market / Venues, empty and error states from §8.
4. **Timeline read-only** — ruler, sections, energy, moments, lanes, auto clips
   drawn from the plan, zoom, pan, playhead, transport. No editing yet. This is
   the point at which the design either reads or does not, and it is worth
   stopping to look.
5. **Editing** — drag from palette, move, trim, select, snap, undo/redo,
   contextual actions, materialisation and suppression.
6. **Inspector** — dials, section properties, show properties.
7. **Booth** — the run console and rig screens at booth density.

Stages 1–4 are the ones worth reviewing closely; 5–7 follow the patterns they
establish.

---

## 12. Open questions for a later phase

- Should base looks (`hold_indigo`, `hit_green`) become swappable per section?
  The data supports it; the palette does not yet expose looks as a concept
- Should the Dynamics envelope be directly drawable, or only shaped by dropping
  Exit dip clips? Starting with the latter
- Multi-universe rigs — every layout today is `geometry: "line"` on one universe,
  and `club16-2head.layout.json` notes that depth needs a grouping extension
  before a multi-truss rig can be described honestly
