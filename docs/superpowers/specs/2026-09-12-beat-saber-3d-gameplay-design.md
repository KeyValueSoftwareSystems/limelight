# Beat Saber — 3D gameplay design

**Date:** 2026-09-12
**Status:** design approved (decisions below), plan to follow via writing-plans

## What we are building

Replace the DOM-block prototype in `beat-saber/` with a **Three.js 3D
playfield**: colored, directional note blocks fly down a neon lane toward a
strike line, driven entirely by the Limelight protocol. The menus, HUD, song
select and results screens (already built) stay as they are — the 3D canvas
renders *inside* the existing `.playfield` box and the HUD is a DOM overlay on
top of it.

This is the gameplay layer promised after the UI + data-layer work. The song
data already flows: `serve.py` serves `/library.json`, the `.score`, and the
audio; `protocol/session.js` answers musical position. This design changes
*how the beats become gameplay* and *how the clock is read*.

## Decisions (locked)

| Question | Decision |
|---|---|
| Renderer | Three.js, vendored + pinned (served by serve.py) |
| Clock | `AnchoredClock` from `protocol/clock.js` (contract-compliant) |
| Cut direction | Enforced — each block has an arrow; swing direction must match |
| Note mapping | Beat-grid mapper — deterministic lane/direction/color per beat |
| Elements | Note blocks only (no bombs/walls yet — YAGNI) |
| Input | Pluggable `SaberSource`: Mouse provider first, Webcam (MediaPipe) second |

## The clock contract (why today's code is wrong, and the fix)

Per `protocol/clock.md`, a clock must **measure** where the audio is, never
**calculate** where it ought to be. Today's `beat-saber/js/game.js` breaks the
contract three ways:

1. It reads `audio.currentTime` directly each frame → the audio element only
   updates a few times a second, so the value is a **staircase** and notes
   would judder in 3D.
2. It calls `audio.play()` directly instead of driving playback **through** a
   clock.
3. It judges hits by **DOM rectangle overlap** — i.e. against where the object
   was drawn, not against musical position.

The fix, applied during the rewrite:

```js
const clock = window.LimelightClock.AnchoredClock(audio);
const session = window.LimelightSession.Session(score, {
  songTime: () => clock.position(),
});
clock.play(0);            // transport goes THROUGH the clock
// clock.pause(); clock.seek(t);
```

`AnchoredClock` reads the audio and carries the position forward with a wall
clock between updates, re-anchoring on every real reading — accurate *and*
smooth. We do **not** add any number to fix audio sync; the only legitimate
calibration is display + input latency (see Calibration below).

**Prerequisite (step 0):** `protocol/clock.js` lives on `origin/ground-zero`,
which local `ground-zero` is 6 commits behind. `serve.py` serves
`/protocol/clock.js` from the working tree, so local must be fast-forwarded to
origin first. This is a clean fast-forward (0 local commits ahead) and
`beat-saber/` is untracked, so nothing in the game is touched. A conformance
check (`node protocol/clock.test.js`) must show the two intentionally-broken
clocks fail and `AnchoredClock` passes before building on it.

## Architecture

Small, independently-testable units, each with one job. New/changed files under
`beat-saber/`:

```
beat-saber/
├── vendor/three.min.js        # pinned Three.js (new)
├── js/
│   ├── limelight.js           # data layer (exists; add makeClock())
│   ├── clock via /protocol/clock.js  (loaded in index.html)
│   ├── mapper.js              # beat -> note descriptor (new)
│   ├── input/
│   │   ├── saber-source.js    # the SaberSource interface + registry (new)
│   │   ├── mouse-source.js    # Phase 1 provider (new)
│   │   └── webcam-source.js   # Phase 2 provider, MediaPipe (new)
│   ├── scene3d.js             # Three.js scene, lane, block meshes, sabers (new)
│   ├── game.js                # orchestrator: clock+session+mapper+scene+input+scoring (rewrite)
│   └── ui.js                  # menus/lifecycle (exists; minor wiring)
└── index.html                 # add three.js + clock.js script tags (change)
```

### Component responsibilities

**`limelight.js` (data layer, extend)**
- Keeps `fetchLibrary`, `loadScore`, `makeSession`.
- Add `makeClock(audioEl)` → `window.LimelightClock.AnchoredClock(audioEl)`,
  and change `makeSession` to accept a `positionFn` so the session reads the
  clock, not `audio.currentTime`.
- What it depends on: `/protocol/session.js`, `/protocol/clock.js`.

**`mapper.js` (beat-grid mapper)**
- Input: a beat descriptor from `session.next()` (`{bar, beat, accent}`) plus
  the difficulty.
- Output: a **note descriptor** `{ key, hitSec, lane, color, direction }` or
  `null` to skip (density filter).
- Deterministic: lane/color/direction derived from `(bar,beat)` so a replay of
  the same song is identical. `key = round(hitSec*1000)`.
- Density: `Easy` = accent (downbeat) beats only; `Normal`/`Hard` = every beat;
  `Expert` may place a mirrored pair (two lanes) on accents.
- **Constraint:** `session.next()` yields whole beats only — no eighth-note
  subdivisions — so all timing sits on the quarter-note grid. Documented, not
  worked around, in this first version.
- Pure and unit-testable with no DOM.

**`scene3d.js` (rendering only)**
- Owns the Three.js `Scene`, `PerspectiveCamera`, renderer sized to
  `.playfield`, the neon lane/grid, lighting, and the strike line at Z≈0.
- `spawnBlock(note)` → creates a mesh (colored cube + arrow decal for the cut
  direction) at the far Z, stores it keyed by `note.key`.
- `update(nowSec)` → positions each live mesh along Z by its remaining time.
- `sliceBlock(key, dir)` / `missBlock(key)` → slice/fade animations.
- `setSabers(sabers)` → draws/updates saber meshes (trail + tip) from the
  input layer.
- Knows nothing about audio, scoring, or the protocol — pure view.

**`input/saber-source.js` (the pluggable interface)**
- Defines the contract every provider implements:
  ```
  SaberSource {
    async start()          // acquire mouse listeners / camera
    stop()
    read() -> [Saber]      // 0..2 sabers THIS frame
  }
  Saber { hand: 'left'|'right', color: 'red'|'blue',
          tip: {x,y,z},        // normalized playfield coords
          vel: {x,y,z} }       // swing velocity (dir + speed) this frame
  ```
- A registry so `game.js` can pick a provider by name (`'mouse'` | `'webcam'`)
  from Settings, defaulting to mouse.

**`input/mouse-source.js` (Phase 1)**
- Two sabers via the two mouse buttons — **color is enforced from day one**:
  - **Left button held → blue saber** (follows the cursor).
  - **Right button held → red saber**.
  - Cursor movement while a button is held sets that saber's `vel` (swing
    speed + direction) for the cut-direction check; releasing retracts it.
- **Browser constraint — right-click context menu.** The right mouse button
  normally opens the browser context menu ("settings"), which would swallow the
  red-saber input. Suppress it on the playfield during a run:
  ```js
  playfield.addEventListener('contextmenu', (e) => e.preventDefault());
  ```
  Scoped to the playfield (or added on `game.start`, removed on `stop`) so
  right-click behaves normally in the menus. `mousedown`/`mouseup` read
  `e.button` (0 = left/blue, 2 = right/red).
- **Optional polish (later):** Pointer Lock API to hide the OS cursor and use
  relative motion, for a more immersive swing feel. Not required for v1.

**`input/webcam-source.js` (Phase 2)**
- MediaPipe **HandLandmarker** (Tasks Vision) loaded from CDN; model + wasm
  fetched from CDN (allowed — served by serve.py, not a sandboxed artifact).
- Left hand → red saber, right hand → blue saber. Tip = index-finger landmark;
  `vel` from landmark motion across frames.
- Requests camera permission on Settings opt-in; falls back to mouse if denied
  or if the model fails to load.

**`game.js` (orchestrator, rewrite)**
- Owns the run loop. On `start(songEntry, {difficulty, inputName, onEnd})`:
  1. load score + audio, build `AnchoredClock` + `Session`;
  2. `scene3d.init(playfieldEl)`; `input = registry.get(inputName)`; `input.start()`;
  3. `clock.play(0)`.
- Each frame:
  1. `nowSec = clock.position()`; `now = session.now()`;
  2. spawn: for each beat in `session.next(LEAD_MS)`, run `mapper`, and if the
     note is new **and** `in_ms >= HITTABLE_MIN` (backlog handling), spawn it;
  3. `scene3d.update(nowSec)`; `scene3d.setSabers(input.read())`;
  4. **hit detection** (below);
  5. mark misses for notes past the window; update HUD; end on energy 0 or
     song end (`clock` reports position ≥ length, or audio `ended`).

**Scoring / hit detection (contract-compliant)**
- A **swing** is a saber whose `vel` speed exceeds a threshold this frame.
- On a swing, for each live note near the strike line, judge against **musical
  position**: `Δbeats = |noteBeatIndex − now.position beatIndex|`, converted to
  ms via the grid; a hit requires:
  1. `Δ` within the timing window (grade Perfect/Good/OK by `|Δ|`),
  2. color match — the swinging saber's color must equal the note's color
     (blue = left button, red = right button; both hands under webcam),
  3. cut-direction match (swing `vel` direction vs the note's arrow).
- Never compares against the mesh's drawn Z. Score/combo/accuracy/energy update
  as today; results screen unchanged.

**Calibration**
- One Settings slider: **display+input latency** (ms), applied as an offset to
  hit-timing judgement only. Never applied to audio sync (the clock forbids it).

## Data flow (one frame)

```
audio ──(measured)──> AnchoredClock.position() ──> Session
                                                     │
Session.next(LEAD) ──> mapper ──> note{lane,color,dir,hitSec} ──> scene3d.spawn
Session.now()  ─────────────────────────────────────────────┐
input.read() ──> [Saber{tip,vel}] ──> scene3d.setSabers      │
                         │                                    │
                    swing? ──> hit judge (Δ musical position, color, dir) ──> score/HUD
clock.position() ──> scene3d.update (move meshes)
```

## Testing strategy

- **Clock:** `node protocol/clock.test.js` must pass `AnchoredClock` and fail
  the two broken clocks before we depend on it.
- **Mapper:** pure unit tests — determinism (same beat → same note), density
  per difficulty, `key` stability.
- **Gameplay (browser, Playwright as in this session):** drive a scripted run
  and assert: notes spawn on real beats; a synthetic swing at the correct
  musical time + direction registers a hit; a wrong-direction swing does not;
  no score resets over a continuous run (no double-loop); song end → results.
- **Judder check:** sample `clock.position()` per frame against a coarse fake
  audio and assert steps ≈ one frame (mirrors clock conformance test 4).

## Phasing (to be expanded by writing-plans)

- **Phase 0** — fast-forward local `ground-zero`; verify `protocol/clock.js`
  served; run clock conformance.
- **Phase 1** — Three.js scene + clock/session rewrite + beat-grid mapper +
  **mouse** input + directional hit judging. Playable end-to-end with Frieren.
- **Phase 2** — MediaPipe **webcam** SaberSource, two-hand red/blue, color
  enforcement, camera opt-in + fallback.
- **Later (out of scope now)** — bombs, walls, eighth-note subdivisions,
  energy/section-aware mapping.

## Risks

- **Webcam latency/variance** — mitigated by the pluggable layer (mouse always
  works) and the latency calibration slider.
- **Three.js size** — vendored + pinned; one file, served locally.
- **Quarter-note-only grid** — accepted for v1; richer subdivision needs
  protocol support or client interpolation, deferred.
