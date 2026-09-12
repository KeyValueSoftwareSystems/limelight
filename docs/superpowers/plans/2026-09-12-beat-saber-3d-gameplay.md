# Beat Saber 3D Gameplay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the DOM-block prototype in `beat-saber/` with a Three.js 3D playfield where colored, directional note blocks fly down a lane on the real Limelight beat feed, sliced by a mouse (two-button = two sabers), with a contract-compliant clock and musical-position hit judging.

**Architecture:** The gameplay reads song position from `AnchoredClock` (measures the audio, never counts), feeds it to the protocol `Session`, asks `session.next(LEAD_MS)` each frame for upcoming beats, turns each beat into a note via a pure deterministic mapper, renders notes as Three.js meshes, and judges swings against musical position via a pure judge module. Input is a pluggable `SaberSource` (mouse now, webcam later) so the gameplay never changes when the input source does.

**Tech Stack:** Vanilla JS (ES5-compatible IIFE modules, matching existing `beat-saber/js/*`), Three.js r128 (vendored UMD global `THREE`), `protocol/session.js` + `protocol/clock.js` (browser globals `LimelightSession` / `LimelightClock`), Node `assert` for pure-module unit tests, Playwright (via the harness browser tools) for browser verification. Served by `serve.py` on port 8770.

**Spec:** `docs/superpowers/specs/2026-09-12-beat-saber-3d-gameplay-design.md`

## Global Constraints

- **Clock contract (`protocol/clock.md`):** the clock MUST measure the audio, never calculate. Use `LimelightClock.AnchoredClock(audio)`; drive transport through `clock.play/pause/seek`; pass `songTime: () => clock.position()` to the Session. Never read `audio.currentTime` in gameplay. Never add a constant to fix audio sync — the only legitimate calibration is display+input latency, applied to hit judging only.
- **Judge against musical position**, never against a drawn mesh's coordinates.
- **First `next()` after play/seek is a backlog** — spawn each note at its true `in_ms` distance, or drop notes below the hittable threshold; never give a backlog note a full approach.
- **Module style:** match existing `beat-saber/js/*.js` — `"use strict"` IIFE assigning to a `window.*` global; no bundler, no ES modules. Pure modules ALSO export via `module.exports` so Node can unit-test them.
- **Served origin:** the game only works when opened via `serve.py` at `http://127.0.0.1:8770/beat-saber/index.html` (absolute `/protocol/...` paths). Vendored assets live under `beat-saber/vendor/`.
- **Three.js version:** pin **r128** exactly (UMD build exposes global `THREE`).
- **Determinism:** the mapper must produce identical notes for identical `(bar,beat,difficulty)` across runs.
- **Difficulty density:** `Easy` = downbeats only; `Normal`/`Hard` = every beat; `Expert` = every beat + a mirrored second note on downbeats. Quarter-note grid only (no subdivisions).

---

## Task 0: Prerequisite — bring the branch current and prove the clock

**Files:**
- Modify: working tree of local `ground-zero` (fast-forward only)
- No app files created

**Interfaces:**
- Consumes: nothing
- Produces: `protocol/clock.js` present in the working tree and served at `/protocol/clock.js`; a known-good `AnchoredClock`.

- [ ] **Step 1: Confirm local is behind and clean to fast-forward**

Run:
```bash
cd /home/dheerajnalapat/keycode/limelight/limelight
git fetch origin ground-zero
git rev-list --left-right --count ground-zero...origin/ground-zero
git status --porcelain=v1 | grep -v '^?? ' || echo "no tracked changes"
```
Expected: left count `0` (0 local commits ahead), some right count (behind). `beat-saber/` and `docs/` show as untracked (`??`) — they will not be touched by a fast-forward.

- [ ] **Step 2: Fast-forward local ground-zero to origin**

Run:
```bash
git merge --ff-only origin/ground-zero
```
Expected: fast-forward succeeds. If it refuses (local has commits), STOP and report — do not force.

- [ ] **Step 3: Verify the clock files exist**

Run:
```bash
ls protocol/clock.js protocol/clock.md protocol/clock.test.js
```
Expected: all three listed.

- [ ] **Step 4: Run the clock conformance test**

Run:
```bash
node protocol/clock.test.js
```
Expected: `AnchoredClock` PASSes all checks; the two broken clocks (`CountingClock`, `RawAudioClock`) FAIL at least one each. If all three pass, the harness is broken — STOP and report.

- [ ] **Step 5: Verify it is served (serve.py already running on 8770)**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8770/protocol/clock.js
```
Expected: `200`. (If not, start it: `HOST=127.0.0.1 PORT=8770 python3 serve.py &`.)

- [ ] **Step 6: No commit** — this task only advances the branch pointer; nothing new to commit.

---

## Task 1: Vendor Three.js and load it

**Files:**
- Create: `beat-saber/vendor/three.min.js`
- Modify: `beat-saber/index.html`

**Interfaces:**
- Consumes: nothing
- Produces: global `THREE` available to later scripts; script load order `three.min.js` → `/protocol/session.js` → `/protocol/clock.js` → game modules.

- [ ] **Step 1: Vendor the pinned Three.js build**

Run:
```bash
cd /home/dheerajnalapat/keycode/limelight/limelight
mkdir -p beat-saber/vendor
curl -fL -o beat-saber/vendor/three.min.js \
  https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js
```

- [ ] **Step 2: Verify the download is the real library**

Run:
```bash
grep -c "REVISION" beat-saber/vendor/three.min.js
wc -c beat-saber/vendor/three.min.js
```
Expected: `REVISION` count ≥ 1; size > 400000 bytes (not an error page).

- [ ] **Step 3: Add the script tags (before the existing game scripts)**

In `beat-saber/index.html`, replace the current script block:
```html
  <script src="/protocol/session.js"></script>
  <script src="js/limelight.js"></script>
  <script src="js/game.js"></script>
  <script src="js/ui.js"></script>
```
with:
```html
  <!-- rendering + protocol clients (session & clock served by serve.py) -->
  <script src="vendor/three.min.js"></script>
  <script src="/protocol/session.js"></script>
  <script src="/protocol/clock.js"></script>
  <script src="js/limelight.js"></script>
  <script src="js/mapper.js"></script>
  <script src="js/judge.js"></script>
  <script src="js/scene3d.js"></script>
  <script src="js/input/saber-source.js"></script>
  <script src="js/input/mouse-source.js"></script>
  <script src="js/game.js"></script>
  <script src="js/ui.js"></script>
```

- [ ] **Step 4: Verify Three loads in the browser**

Using the harness browser tools: navigate to `http://127.0.0.1:8770/beat-saber/index.html`, then evaluate:
```js
() => ({ three: typeof THREE, rev: (window.THREE && THREE.REVISION) || null,
         clock: typeof window.LimelightClock, session: typeof window.LimelightSession })
```
Expected: `{ three: "object", rev: "128", clock: "object", session: "object" }`. (The other game scripts 404 until created — that is fine for this step; only these globals matter.)

- [ ] **Step 5: Commit**

```bash
git add beat-saber/vendor/three.min.js beat-saber/index.html
git commit -m "feat(beat-saber): vendor Three.js r128 and load protocol clock"
```

---

## Task 2: Data layer — anchored clock + session through the clock

**Files:**
- Modify: `beat-saber/js/limelight.js`

**Interfaces:**
- Consumes: `window.LimelightClock.AnchoredClock`, `window.LimelightSession.Session`.
- Produces:
  - `Limelight.makeClock(audioEl) -> clock` (an `AnchoredClock`).
  - `Limelight.makeSession(score, positionFn) -> session` — **signature change**: second arg is now a `() => number` position function (seconds), not the audio element.

- [ ] **Step 1: Update `makeSession` and add `makeClock`**

In `beat-saber/js/limelight.js`, replace the existing `makeSession`:
```js
  function makeSession(score, audioEl) {
    if (!window.LimelightSession || !window.LimelightSession.Session) {
      throw new Error("protocol/session.js not loaded");
    }
    return window.LimelightSession.Session(score, {
      songTime: () => audioEl.currentTime,
    });
  }
```
with:
```js
  function makeClock(audioEl) {
    if (!window.LimelightClock || !window.LimelightClock.AnchoredClock) {
      throw new Error("protocol/clock.js not loaded");
    }
    return window.LimelightClock.AnchoredClock(audioEl);
  }

  // positionFn is () => songSeconds, normally clock.position bound to a clock.
  function makeSession(score, positionFn) {
    if (!window.LimelightSession || !window.LimelightSession.Session) {
      throw new Error("protocol/session.js not loaded");
    }
    return window.LimelightSession.Session(score, { songTime: positionFn });
  }
```

- [ ] **Step 2: Export `makeClock`**

Change the export line at the bottom of the IIFE:
```js
  window.Limelight = { BASE, fetchLibrary, loadScore, makeSession };
```
to:
```js
  window.Limelight = { BASE, fetchLibrary, loadScore, makeClock, makeSession };
```

- [ ] **Step 3: Verify in the browser**

Navigate to the game page, evaluate:
```js
async () => {
  const score = await Limelight.loadScore('frieren');
  const audio = new Audio();
  const clock = Limelight.makeClock(audio);
  const s = Limelight.makeSession(score, () => clock.position());
  return { clockPos: clock.position(), nowBar: s.now().position.bar,
           hasNext: Array.isArray(s.next(1200)) };
}
```
Expected: `clockPos` is `0` (paused, currentTime 0); `nowBar` is a number; `hasNext` true.

- [ ] **Step 4: Commit**

```bash
git add beat-saber/js/limelight.js
git commit -m "feat(beat-saber): add AnchoredClock, session reads the clock"
```

---

## Task 3: Beat-grid mapper (pure, unit-tested)

**Files:**
- Create: `beat-saber/js/mapper.js`
- Test: `beat-saber/js/mapper.test.js`

**Interfaces:**
- Consumes: nothing (pure). Caller passes a `secondsAt(bar,beat)` function (from the session).
- Produces:
  - `Mapper.LANES === 4`, `Mapper.DIRECTIONS` (8 strings).
  - `Mapper.mapBeat(beat, ctx) -> note | null` where
    `beat = { bar:number, beat:number, accent:boolean }`,
    `ctx = { difficulty:'Easy'|'Normal'|'Hard'|'Expert', secondsAt:(bar,beat)=>number }`,
    `note = { key:number, hitSec:number, lane:0..3, color:'red'|'blue', direction:string }`.
  - `Mapper.mapExtra(beat, ctx) -> note | null` — the mirrored second note for Expert downbeats (null otherwise).

- [ ] **Step 1: Write the failing test**

Create `beat-saber/js/mapper.test.js`:
```js
"use strict";
const assert = require("assert");
const { Mapper } = require("./mapper.js");
const out = [];
const ok = (n, c, d) => out.push([!!c, n, d || ""]);

const secondsAt = (bar, beat) => bar * 2 + (beat - 1) * 0.5; // fake grid

// determinism
{
  const b = { bar: 5, beat: 3, accent: false };
  const a1 = Mapper.mapBeat(b, { difficulty: "Normal", secondsAt });
  const a2 = Mapper.mapBeat(b, { difficulty: "Normal", secondsAt });
  ok("same beat maps identically", JSON.stringify(a1) === JSON.stringify(a2), JSON.stringify(a1));
  ok("lane is 0..3", a1.lane >= 0 && a1.lane < 4, "lane " + a1.lane);
  ok("color is red or blue", a1.color === "red" || a1.color === "blue", a1.color);
  ok("direction is known", Mapper.DIRECTIONS.includes(a1.direction), a1.direction);
  ok("key matches hitSec ms", a1.key === Math.round(a1.hitSec * 1000), a1.key + "");
}
// Easy keeps only downbeats
{
  const down = { bar: 5, beat: 1, accent: true };
  const off = { bar: 5, beat: 3, accent: false };
  ok("Easy keeps downbeat", Mapper.mapBeat(down, { difficulty: "Easy", secondsAt }) !== null);
  ok("Easy drops offbeat", Mapper.mapBeat(off, { difficulty: "Easy", secondsAt }) === null);
}
// Normal keeps everything
{
  const off = { bar: 5, beat: 3, accent: false };
  ok("Normal keeps offbeat", Mapper.mapBeat(off, { difficulty: "Normal", secondsAt }) !== null);
}
// Expert mirrored note on downbeats only
{
  const down = { bar: 5, beat: 1, accent: true };
  const off = { bar: 5, beat: 2, accent: false };
  const extra = Mapper.mapExtra(down, { difficulty: "Expert", secondsAt });
  ok("Expert adds a second note on the downbeat", extra !== null && extra.key !== null);
  ok("no extra on offbeats", Mapper.mapExtra(off, { difficulty: "Expert", secondsAt }) === null);
  ok("no extra below Expert", Mapper.mapExtra(down, { difficulty: "Normal", secondsAt }) === null);
}

let failed = 0;
for (const [pass, name, detail] of out) { if (!pass) failed++; console.log(pass ? "pass" : "FAIL", name, detail); }
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node beat-saber/js/mapper.test.js`
Expected: FAIL — `Cannot find module './mapper.js'`.

- [ ] **Step 3: Implement the mapper**

Create `beat-saber/js/mapper.js`:
```js
/* Beat-grid mapper: a beat becomes a note, deterministically.
   Pure and DOM-free so Node can test it. Quarter-note grid only. */
"use strict";
(function () {
  const LANES = 4;
  const DIRECTIONS = ["up", "down", "left", "right",
                      "up-left", "up-right", "down-left", "down-right"];

  // A stable 32-bit hash of a beat's musical position.
  function hash(bar, beat) {
    let h = ((bar * 4 + beat) >>> 0) * 2654435761;
    return (h >>> 0);
  }

  function keeps(difficulty, accent) {
    if (difficulty === "Easy") return accent;   // downbeats only
    return true;                                 // Normal/Hard/Expert: every beat
  }

  function noteFrom(beat, ctx, salt) {
    const h = hash(beat.bar, beat.beat + salt);
    const hitSec = ctx.secondsAt(beat.bar, beat.beat);
    return {
      key: Math.round(hitSec * 1000) + salt,     // salt keeps a mirrored pair distinct
      hitSec: hitSec,
      lane: h % LANES,
      // downbeats lean blue (left hand lead), others alternate by hash
      color: beat.accent ? "blue" : (h & 1 ? "red" : "blue"),
      // downbeats are a clean down-cut; others vary
      direction: beat.accent ? "down" : DIRECTIONS[h % DIRECTIONS.length],
    };
  }

  function mapBeat(beat, ctx) {
    if (!keeps(ctx.difficulty, beat.accent)) return null;
    return noteFrom(beat, ctx, 0);
  }

  // Expert: a mirrored second note on downbeats, opposite lane + color.
  function mapExtra(beat, ctx) {
    if (ctx.difficulty !== "Expert" || !beat.accent) return null;
    const n = noteFrom(beat, ctx, 1);
    n.lane = (LANES - 1) - n.lane;
    n.color = n.color === "blue" ? "red" : "blue";
    return n;
  }

  const M = { LANES, DIRECTIONS, mapBeat, mapExtra };
  if (typeof module !== "undefined" && module.exports) module.exports = { Mapper: M };
  if (typeof window !== "undefined") window.Mapper = M;
})();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node beat-saber/js/mapper.test.js`
Expected: `all passed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add beat-saber/js/mapper.js beat-saber/js/mapper.test.js
git commit -m "feat(beat-saber): deterministic beat-grid mapper with tests"
```

---

## Task 4: Hit judge (pure, unit-tested)

**Files:**
- Create: `beat-saber/js/judge.js`
- Test: `beat-saber/js/judge.test.js`

**Interfaces:**
- Consumes: a `note` (from Mapper), a `swing`, current song seconds.
- Produces:
  - `Judge.judge(note, swing, nowSec, opts) -> result` where
    `swing = { color:'red'|'blue', vel:{x:number,y:number} }` (screen-space vel: +y is down),
    `opts = { window_ms?:number=180, latency_ms?:number=0, angle_tol_deg?:number=45 }`,
    `result = { hit:boolean, grade?:'perfect'|'good'|'ok', reason?:'timing'|'color'|'direction', dt_ms:number }`.
  - `Judge.DIR_VEC` — map of direction string → unit `[x,y]`.

- [ ] **Step 1: Write the failing test**

Create `beat-saber/js/judge.test.js`:
```js
"use strict";
const assert = require("assert");
const { Judge } = require("./judge.js");
const out = [];
const ok = (n, c, d) => out.push([!!c, n, d || ""]);

const note = { key: 1000, hitSec: 10.0, lane: 1, color: "blue", direction: "down" };
const down = { color: "blue", vel: { x: 0, y: 1 } };   // swinging downward

// on time, right color, right direction
{
  const r = Judge.judge(note, down, 10.0, {});
  ok("on-time down-swing hits", r.hit === true, JSON.stringify(r));
  ok("dead-on is perfect", r.grade === "perfect", r.grade);
}
// too early
{
  const r = Judge.judge(note, down, 9.7, {}); // 300ms early > 180 window
  ok("far-early swing misses on timing", r.hit === false && r.reason === "timing", JSON.stringify(r));
}
// wrong color
{
  const red = { color: "red", vel: { x: 0, y: 1 } };
  const r = Judge.judge(note, red, 10.0, {});
  ok("wrong color misses", r.hit === false && r.reason === "color", JSON.stringify(r));
}
// wrong direction (swinging up at a down note)
{
  const up = { color: "blue", vel: { x: 0, y: -1 } };
  const r = Judge.judge(note, up, 10.0, {});
  ok("wrong direction misses", r.hit === false && r.reason === "direction", JSON.stringify(r));
}
// latency offset shifts the judged time
{
  const r = Judge.judge(note, down, 9.9, { latency_ms: 100 }); // 9.9 + .1 = 10.0
  ok("latency offset is applied to judging", r.hit === true, JSON.stringify(r));
}

let failed = 0;
for (const [pass, name, detail] of out) { if (!pass) failed++; console.log(pass ? "pass" : "FAIL", name, detail); }
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node beat-saber/js/judge.test.js`
Expected: FAIL — `Cannot find module './judge.js'`.

- [ ] **Step 3: Implement the judge**

Create `beat-saber/js/judge.js`:
```js
/* Hit judging, against musical position (never against a drawn mesh).
   dt is (where the song is) - (where the note belongs), in ms. Pure. */
"use strict";
(function () {
  const S = Math.SQRT1_2;
  const DIR_VEC = {
    "up": [0, -1], "down": [0, 1], "left": [-1, 0], "right": [1, 0],
    "up-left": [-S, -S], "up-right": [S, -S],
    "down-left": [-S, S], "down-right": [S, S],
  };

  function judge(note, swing, nowSec, opts) {
    opts = opts || {};
    const window_ms = opts.window_ms == null ? 180 : opts.window_ms;
    const latency_ms = opts.latency_ms || 0;
    const tol = Math.cos((opts.angle_tol_deg == null ? 45 : opts.angle_tol_deg) * Math.PI / 180);

    const dt_ms = (nowSec + latency_ms / 1000 - note.hitSec) * 1000;
    if (Math.abs(dt_ms) > window_ms) return { hit: false, reason: "timing", dt_ms: dt_ms };
    if (swing.color !== note.color) return { hit: false, reason: "color", dt_ms: dt_ms };

    const v = DIR_VEC[note.direction] || [0, 1];
    const sp = Math.hypot(swing.vel.x, swing.vel.y) || 1;
    const sx = swing.vel.x / sp, sy = swing.vel.y / sp;
    const dot = v[0] * sx + v[1] * sy;
    if (dot < tol) return { hit: false, reason: "direction", dt_ms: dt_ms };

    const a = Math.abs(dt_ms);
    const grade = a < 60 ? "perfect" : a < 120 ? "good" : "ok";
    return { hit: true, grade: grade, dt_ms: dt_ms };
  }

  const J = { judge, DIR_VEC };
  if (typeof module !== "undefined" && module.exports) module.exports = { Judge: J };
  if (typeof window !== "undefined") window.Judge = J;
})();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node beat-saber/js/judge.test.js`
Expected: `all passed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add beat-saber/js/judge.js beat-saber/js/judge.test.js
git commit -m "feat(beat-saber): musical-position hit judge with tests"
```

---

## Task 5: Three.js scene (render only)

**Files:**
- Create: `beat-saber/js/scene3d.js`
- Modify: `beat-saber/css/style.css` (canvas fills playfield)

**Interfaces:**
- Consumes: global `THREE`; note descriptors from Mapper.
- Produces `window.Scene3D` with:
  - `init(mountEl) -> void` — build scene, append `<canvas>` to `mountEl`, start no loop of its own.
  - `resize() -> void`.
  - `spawnBlock(note) -> void` — mesh keyed by `note.key`, placed at far Z.
  - `update(progressOf) -> void` — `progressOf(key) => number` (0 far … 1 strike … >1 past); moves/culls meshes.
  - `sliceBlock(key) -> void`, `missBlock(key) -> void` — remove with a brief animation.
  - `setSabers(sabers) -> void` — `sabers = [{color, tip:{x,y}, active:boolean}]`, x/y normalized 0..1 over the playfield.
  - `clear() -> void` — remove all meshes.
  - `dispose() -> void` — stop, remove canvas, free geometry.
  - `LANE_X` (array of 4 world-x positions) exported for consistency with the mapper.

- [ ] **Step 1: Implement the scene**

Create `beat-saber/js/scene3d.js`:
```js
/* Three.js view for the playfield. Knows nothing about audio, scoring, or the
   protocol — it is handed notes and a progress function and draws them. */
"use strict";
(function () {
  const FAR_Z = -60;        // where blocks spawn
  const STRIKE_Z = 0;       // the hit line, nearest the camera
  const LANE_X = [-3, -1, 1, 3];
  const BLOCK_Y = 0;

  const COLORS = { red: 0xff2d55, blue: 0x2ec5ff };
  let renderer, scene, camera, mount;
  let blocks = new Map();   // key -> { mesh, note }
  let saberMeshes = [];

  function init(mountEl) {
    mount = mountEl;
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x05060c, 30, 65);

    const w = mount.clientWidth || 800, h = mount.clientHeight || 600;
    camera = new THREE.PerspectiveCamera(70, w / h, 0.1, 200);
    camera.position.set(0, 2.4, 9);
    camera.lookAt(0, 0, FAR_Z / 2);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.domElement.className = "scene3d-canvas";
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0x8899ff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 0.8);
    key.position.set(0, 8, 10); scene.add(key);

    // neon lane floor
    const grid = new THREE.GridHelper(120, 60, 0x2ec5ff, 0x1b2740);
    grid.position.z = FAR_Z / 2; grid.position.y = -2;
    scene.add(grid);

    // strike line
    const lineGeo = new THREE.PlaneGeometry(9, 0.12);
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
    const line = new THREE.Mesh(lineGeo, lineMat);
    line.position.set(0, BLOCK_Y - 1.2, STRIKE_Z); line.rotation.x = -Math.PI / 2.2;
    scene.add(line);
  }

  // an arrow texture drawn once per direction, cached
  const arrowCache = {};
  function arrowTexture(direction) {
    if (arrowCache[direction]) return arrowCache[direction];
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d");
    g.fillStyle = "rgba(255,255,255,0.95)";
    g.translate(32, 32);
    const ang = { "up": Math.PI, "down": 0, "left": Math.PI / 2, "right": -Math.PI / 2,
      "up-left": Math.PI * 0.75, "up-right": -Math.PI * 0.75,
      "down-left": Math.PI * 0.25, "down-right": -Math.PI * 0.25 }[direction] || 0;
    g.rotate(ang);
    g.beginPath(); g.moveTo(0, 16); g.lineTo(-13, -6); g.lineTo(13, -6); g.closePath(); g.fill();
    const tex = new THREE.CanvasTexture(c); arrowCache[direction] = tex; return tex;
  }

  function spawnBlock(note) {
    if (blocks.has(note.key)) return;
    const geo = new THREE.BoxGeometry(1.4, 1.4, 1.4);
    const mat = new THREE.MeshStandardMaterial({
      color: COLORS[note.color], emissive: COLORS[note.color],
      emissiveIntensity: 0.35, metalness: 0.3, roughness: 0.4 });
    const mesh = new THREE.Mesh(geo, mat);
    // arrow on the face toward the camera (+z)
    const arrowMat = new THREE.MeshBasicMaterial({ map: arrowTexture(note.direction), transparent: true });
    const arrow = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0), arrowMat);
    arrow.position.z = 0.72; mesh.add(arrow);
    mesh.position.set(LANE_X[note.lane], BLOCK_Y, FAR_Z);
    scene.add(mesh);
    blocks.set(note.key, { mesh: mesh, note: note });
  }

  function update(progressOf) {
    blocks.forEach((b, key) => {
      const p = progressOf(key);
      if (p == null) return;
      b.mesh.position.z = FAR_Z + (STRIKE_Z - FAR_Z) * Math.min(p, 1.25);
      b.mesh.rotation.z += 0.01;
    });
    render();
  }

  function removeWith(key, scaleTo, fade) {
    const b = blocks.get(key); if (!b) return;
    blocks.delete(key);
    const start = performance.now();
    (function anim() {
      const t = Math.min(1, (performance.now() - start) / 180);
      b.mesh.scale.setScalar(1 + (scaleTo - 1) * t);
      b.mesh.material.opacity = 1 - t; b.mesh.material.transparent = true;
      render();
      if (t < 1) requestAnimationFrame(anim);
      else { scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); }
    })();
  }
  function sliceBlock(key) { removeWith(key, 1.8, true); }
  function missBlock(key) { removeWith(key, 0.6, true); }

  function setSabers(sabers) {
    while (saberMeshes.length < sabers.length) {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 3, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff }));
      m.rotation.x = Math.PI / 2; scene.add(m); saberMeshes.push(m);
    }
    saberMeshes.forEach((m, i) => {
      const s = sabers[i];
      m.visible = !!s;
      if (!s) return;
      m.material.color.setHex(COLORS[s.color] || 0xffffff);
      m.position.set((s.tip.x - 0.5) * 9, (0.5 - s.tip.y) * 5, STRIKE_Z + 1.2);
      m.material.opacity = s.active ? 1 : 0.4; m.material.transparent = true;
    });
  }

  function render() { if (renderer) renderer.render(scene, camera); }
  function resize() {
    if (!renderer || !mount) return;
    const w = mount.clientWidth, h = mount.clientHeight;
    camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); render();
  }
  function clear() { blocks.forEach((b) => { scene.remove(b.mesh); }); blocks.clear(); }
  function dispose() {
    clear();
    if (renderer) { renderer.dispose(); if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement); }
    renderer = scene = camera = null; saberMeshes = [];
  }

  window.Scene3D = { init, resize, spawnBlock, update, sliceBlock, missBlock,
                     setSabers, clear, dispose, LANE_X: LANE_X };
})();
```

- [ ] **Step 2: Style the canvas to fill the playfield**

In `beat-saber/css/style.css`, add:
```css
.scene3d-canvas { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 2; }
.playfield.is-playing .playfield__placeholder { display: none; }
```

- [ ] **Step 3: Browser smoke test**

Navigate to the game page, evaluate:
```js
() => {
  const pf = document.querySelector('.playfield');
  Scene3D.init(pf);
  Scene3D.spawnBlock({ key: 1, hitSec: 5, lane: 1, color: 'blue', direction: 'down' });
  Scene3D.update(() => 0.5);
  const c = pf.querySelector('canvas.scene3d-canvas');
  return { hasCanvas: !!c, w: c && c.width > 0, h: c && c.height > 0 };
}
```
Expected: `{ hasCanvas: true, w: true, h: true }`, no console errors.

- [ ] **Step 4: Commit**

```bash
git add beat-saber/js/scene3d.js beat-saber/css/style.css
git commit -m "feat(beat-saber): Three.js scene, blocks, arrows, sabers"
```

---

## Task 6: Input layer — SaberSource interface + mouse provider (right-button fix)

**Files:**
- Create: `beat-saber/js/input/saber-source.js`
- Create: `beat-saber/js/input/mouse-source.js`

**Interfaces:**
- Consumes: the playfield element.
- Produces:
  - `window.SaberSources` registry: `register(name, factory)`, `create(name, mountEl) -> source`, `has(name)`.
  - A source object: `{ async start(), stop(), read() -> [Saber] }` where
    `Saber = { hand:'left'|'right', color:'red'|'blue', tip:{x,y}, vel:{x,y}, active:boolean }`
    with `tip` normalized 0..1 over the playfield and `vel` in normalized units/frame.
  - `MouseSource` registered under name `'mouse'`: left button → blue (`hand:'left'`), right button → red (`hand:'right'`). **Suppresses the context menu** on the mount so the right button is usable.

- [ ] **Step 1: Implement the registry + interface doc**

Create `beat-saber/js/input/saber-source.js`:
```js
/* The pluggable input contract. A SaberSource yields 0..2 sabers per frame,
   each a tip position and a swing velocity, so the gameplay never changes when
   the input source does (mouse now, webcam later). */
"use strict";
(function () {
  const factories = {};
  function register(name, factory) { factories[name] = factory; }
  function has(name) { return !!factories[name]; }
  function create(name, mountEl) {
    const f = factories[name] || factories["mouse"];
    return f(mountEl);
  }
  window.SaberSources = { register, has, create };
})();
```

- [ ] **Step 2: Implement the mouse provider with the right-button fix**

Create `beat-saber/js/input/mouse-source.js`:
```js
/* Mouse input: two buttons, two sabers.
     left button  -> blue saber  (hand: left)
     right button -> red saber   (hand: right)
   The right mouse button normally opens the browser context menu, which would
   swallow the red-saber swing. We preventDefault the contextmenu on the mount
   for the life of the source, and restore it on stop(). */
"use strict";
(function () {
  function MouseSource(mount) {
    let bx = 0.5, by = 0.5;          // current pointer, normalized
    let px = 0.5, py = 0.5;          // previous, for velocity
    let leftDown = false, rightDown = false;

    const onMove = (e) => {
      const r = mount.getBoundingClientRect();
      bx = (e.clientX - r.left) / r.width;
      by = (e.clientY - r.top) / r.height;
    };
    const onDown = (e) => {
      if (e.button === 0) leftDown = true;
      if (e.button === 2) { rightDown = true; e.preventDefault(); }
    };
    const onUp = (e) => {
      if (e.button === 0) leftDown = false;
      if (e.button === 2) rightDown = false;
    };
    const onContext = (e) => e.preventDefault();   // <-- the fix

    function start() {
      mount.addEventListener("pointermove", onMove);
      mount.addEventListener("pointerdown", onDown);
      window.addEventListener("pointerup", onUp);
      mount.addEventListener("contextmenu", onContext);
      return Promise.resolve();
    }
    function stop() {
      mount.removeEventListener("pointermove", onMove);
      mount.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      mount.removeEventListener("contextmenu", onContext);
    }
    function read() {
      const vx = bx - px, vy = by - py;
      px = bx; py = by;
      const vel = { x: vx, y: vy };
      const sabers = [];
      // both sabers track the cursor; a button makes one "active" (swinging)
      sabers.push({ hand: "left", color: "blue", tip: { x: bx, y: by },
                    vel: leftDown ? vel : { x: 0, y: 0 }, active: leftDown });
      sabers.push({ hand: "right", color: "red", tip: { x: bx, y: by },
                    vel: rightDown ? vel : { x: 0, y: 0 }, active: rightDown });
      return sabers;
    }
    return { start, stop, read };
  }

  if (window.SaberSources) window.SaberSources.register("mouse", MouseSource);
})();
```

- [ ] **Step 3: Browser test — context menu suppressed, buttons produce swings**

Navigate to the game page, evaluate:
```js
async () => {
  const pf = document.querySelector('.playfield');
  const src = SaberSources.create('mouse', pf);
  await src.start();
  // right-click must be prevented
  const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  const notPrevented = pf.dispatchEvent(ev); // false if preventDefault ran
  // simulate a right-button-held downward swing
  pf.dispatchEvent(new PointerEvent('pointerdown', { button: 2, bubbles: true }));
  const r = pf.getBoundingClientRect();
  pf.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + r.width/2, clientY: r.top + r.height*0.4, bubbles: true }));
  src.read(); // prime previous
  pf.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + r.width/2, clientY: r.top + r.height*0.8, bubbles: true }));
  const sabers = src.read();
  src.stop();
  const red = sabers.find(s => s.color === 'red');
  return { contextMenuSuppressed: notPrevented === false,
           redActive: red.active, redSwingsDown: red.vel.y > 0 };
}
```
Expected: `{ contextMenuSuppressed: true, redActive: true, redSwingsDown: true }`.

- [ ] **Step 4: Commit**

```bash
git add beat-saber/js/input/saber-source.js beat-saber/js/input/mouse-source.js
git commit -m "feat(beat-saber): pluggable saber input; mouse two-button, right-click fixed"
```

---

## Task 7: Game orchestrator (rewrite `game.js`)

**Files:**
- Modify (rewrite): `beat-saber/js/game.js`

**Interfaces:**
- Consumes: `Limelight.makeClock/makeSession/loadScore`, `Mapper.mapBeat/mapExtra`, `Judge.judge`, `Scene3D.*`, `SaberSources.create`.
- Produces `window.Game`:
  - `async start(songEntry, opts)` where `opts = { difficulty, inputName?='mouse', latency_ms?=0, onEnd?:fn }`.
  - `stop()`, `getStats() -> { score, accuracy, maxCombo, rank }`.

- [ ] **Step 1: Rewrite `game.js`**

Replace the entire contents of `beat-saber/js/game.js` with:
```js
/* Orchestrator: clock -> session -> mapper -> scene, judged against musical
   position. Contract: measure the audio via AnchoredClock, drive transport
   through the clock, spawn from next()'s window (backlog-aware), judge on
   session position — never on the drawn mesh. */
"use strict";
(function () {
  const LEAD_MS = 1600;             // travel time spawn -> strike
  const LEAD_S = LEAD_MS / 1000;
  const HITTABLE_MIN_MS = 140;      // backlog notes closer than this are dropped
  const MISS_AT = 1.12;             // progress past which an un-hit note is a miss

  let audio, clock, session, input, raf = 0, running = false;
  let notes = new Map();            // key -> note (live)
  let spawned = new Set();
  let hud = {}, playfield, stats, difficulty, latency_ms, onEnd;

  function $(id) { return document.getElementById(id); }

  async function start(songEntry, opts) {
    stop();
    opts = opts || {};
    difficulty = opts.difficulty || "Normal";
    latency_ms = opts.latency_ms || 0;
    onEnd = opts.onEnd || null;

    playfield = document.querySelector(".playfield");
    hud = { combo: $("hud-combo"), score: $("hud-score"), acc: $("hud-acc"),
            rank: $("hud-rank"), health: $("hud-health") };

    const score = songEntry.score || await window.Limelight.loadScore(songEntry.slug);

    audio = new Audio();
    audio.preload = "auto";
    audio.src = window.Limelight.BASE + songEntry.audio;
    clock = window.Limelight.makeClock(audio);
    session = window.Limelight.makeSession(score, () => clock.position());

    window.Scene3D.init(playfield);
    window.Scene3D.clear();
    input = window.SaberSources.create(opts.inputName || "mouse", playfield);
    await input.start();

    stats = { hits: 0, misses: 0, score: 0, combo: 0, maxCombo: 0, energy: 55 };
    notes = new Map(); spawned = new Set();
    playfield.classList.add("is-playing");
    renderHud();

    audio.addEventListener("ended", finish, { once: true });
    clock.play(0);                  // transport through the clock
    running = true;
    raf = requestAnimationFrame(loop);
    return { ok: true };
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf), (raf = 0);
    if (clock) { try { clock.pause(); } catch (e) {} }
    if (input) { try { input.stop(); } catch (e) {} input = null; }
    if (window.Scene3D) window.Scene3D.dispose();
    if (playfield) playfield.classList.remove("is-playing");
    audio = clock = session = null; notes = new Map(); spawned = new Set();
  }

  function progressOf(key) {
    const n = notes.get(key); if (!n) return null;
    return 1 - (n.hitSec - clock.position()) / LEAD_S;
  }

  function loop() {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    const nowSec = clock.position();

    // spawn from the window; backlog-aware
    const ctx = { difficulty: difficulty, secondsAt: (b, be) => session.secondsAt(b, be) };
    for (const b of session.next(LEAD_MS)) {
      if (b.layer) continue;
      const primary = window.Mapper.mapBeat({ bar: b.bar, beat: b.beat, accent: b.accent }, ctx);
      const extra = window.Mapper.mapExtra({ bar: b.bar, beat: b.beat, accent: b.accent }, ctx);
      for (const note of [primary, extra]) {
        if (!note || spawned.has(note.key)) continue;
        const in_ms = (note.hitSec - nowSec) * 1000;
        spawned.add(note.key);
        if (in_ms < HITTABLE_MIN_MS) continue;   // backlog too close to hit fairly: drop
        notes.set(note.key, note);
        window.Scene3D.spawnBlock(note);
      }
    }

    // advance + miss
    notes.forEach((n, key) => {
      if (progressOf(key) >= MISS_AT) miss(key);
    });
    window.Scene3D.update(progressOf);

    // input + hit
    const sabers = input.read();
    window.Scene3D.setSabers(sabers);
    judgeSwings(sabers, nowSec);

    renderHud();
    if (stats.energy <= 0) finish();
  }

  function judgeSwings(sabers, nowSec) {
    for (const s of sabers) {
      if (!s.active) continue;
      const speed = Math.hypot(s.vel.x, s.vel.y);
      if (speed < 0.012) continue;               // not a real swing this frame
      notes.forEach((note, key) => {
        const p = progressOf(key);
        if (p < 0.6) return;                      // only judge near the strike line
        const r = window.Judge.judge(note, s, nowSec, { latency_ms: latency_ms });
        if (r.hit) hit(key);
      });
    }
  }

  function hit(key) {
    if (!notes.has(key)) return;
    notes.delete(key);
    window.Scene3D.sliceBlock(key);
    stats.hits++; stats.combo++; stats.maxCombo = Math.max(stats.maxCombo, stats.combo);
    const mult = 1 + Math.min(stats.combo, 40) / 10;
    stats.score += Math.round(100 * mult);
    stats.energy = Math.min(100, stats.energy + 2);
  }
  function miss(key) {
    if (!notes.has(key)) return;
    notes.delete(key);
    window.Scene3D.missBlock(key);
    stats.misses++; stats.combo = 0; stats.energy = Math.max(0, stats.energy - 12);
  }

  function accuracy() {
    const t = stats.hits + stats.misses;
    return t ? (stats.hits / t) * 100 : 100;
  }
  function rankFor(a) { return a >= 95 ? "S" : a >= 90 ? "A" : a >= 80 ? "B" : "C"; }

  function renderHud() {
    if (hud.combo) hud.combo.textContent = stats.combo;
    if (hud.score) hud.score.textContent = stats.score.toLocaleString();
    const a = accuracy();
    if (hud.acc) hud.acc.textContent = a.toFixed(1) + "%";
    if (hud.rank) hud.rank.textContent = rankFor(a);
    if (hud.health) hud.health.style.width = stats.energy + "%";
  }

  function getStats() {
    const a = accuracy();
    return { score: stats ? stats.score : 0, accuracy: a,
             maxCombo: stats ? stats.maxCombo : 0, rank: rankFor(a) };
  }
  function finish() {
    if (!running) return;
    const result = getStats();
    stop();
    if (onEnd) onEnd(result);
  }

  window.Game = { start, stop, getStats };
})();
```

- [ ] **Step 2: Browser integration test — beats spawn, swings score, no reset**

Navigate to the game page, evaluate (drives one clean run for ~14s):
```js
async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const lib = await Limelight.fetchLibrary();
  const song = lib.find(s => s.slug === 'frieren');
  let ended = null;
  await Game.start(song, { difficulty: 'Normal', inputName: 'mouse', onEnd: (r) => ended = r });
  await wait(500);
  const pf = document.querySelector('.playfield');
  const r = pf.getBoundingClientRect();
  // hold right button (red) AND left (blue), sweep down repeatedly to swing both
  pf.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
  pf.dispatchEvent(new PointerEvent('pointerdown', { button: 2, bubbles: true }));
  let last = 0, resets = 0;
  const start = performance.now();
  while (performance.now() - start < 13000) {
    const cx = r.left + r.width/2;
    pf.dispatchEvent(new PointerEvent('pointermove', { clientX: cx, clientY: r.top + r.height*0.35, bubbles: true }));
    pf.dispatchEvent(new PointerEvent('pointermove', { clientX: cx, clientY: r.top + r.height*0.9, bubbles: true }));
    const n = parseInt((document.getElementById('hud-score').textContent||'0').replace(/,/g,'')) || 0;
    if (n < last) resets++; last = n;
    await new Promise(r => requestAnimationFrame(r));
  }
  return { finalScore: document.getElementById('hud-score').textContent,
           combo: document.getElementById('hud-combo').textContent,
           acc: document.getElementById('hud-acc').textContent,
           scoreResets: resets, ended };
}
```
Expected: `finalScore` > 0, `scoreResets` === 0, and the run either still going or `ended` populated with a rank. (Color+direction enforcement means not every sweep scores — a rising score with zero resets is the pass condition.)

- [ ] **Step 3: Commit**

```bash
git add beat-saber/js/game.js
git commit -m "feat(beat-saber): 3D game loop on anchored clock, musical-position judging"
```

---

## Task 8: Wire the UI + calibration, full playthrough

**Files:**
- Modify: `beat-saber/js/ui.js`
- Modify: `beat-saber/index.html` (settings: latency slider)

**Interfaces:**
- Consumes: `Game.start/stop/getStats`.
- Produces: Start passes `{ difficulty, inputName:'mouse', latency_ms }`; the End/Retry/Menu lifecycle drives `Game` as before.

- [ ] **Step 1: Add a latency calibration slider to Settings**

In `beat-saber/index.html`, inside the settings `.settings` block, add:
```html
          <label class="setting">
            <span class="setting__label">Input Latency (ms)</span>
            <input type="range" min="0" max="200" value="0" step="5" class="slider" id="set-latency" />
          </label>
```

- [ ] **Step 2: Read latency and pass it into the game**

In `beat-saber/js/ui.js`, change `startGame` to read the slider:
```js
async function startGame() {
  const song = songs[selected];
  if (!song || song.playable === false || !window.Game) return;
  const latEl = document.getElementById("set-latency");
  const latency_ms = latEl ? Number(latEl.value) : 0;
  showScreen("game");
  try {
    await window.Game.start(song, { difficulty, inputName: "mouse", latency_ms, onEnd: showResults });
  } catch (err) {
    console.error("could not start:", err);
    showResults(null);
  }
}
```

- [ ] **Step 3: Update the how-to copy for two-button sabers**

In `beat-saber/index.html`, in the how-to screen, replace the first row's text:
```html
          <p>Move your <strong>mouse</strong> to swing the two sabers &mdash; one <span class="txt-red">red</span>, one <span class="txt-blue">blue</span>.</p>
```
with:
```html
          <p><strong>Left mouse button</strong> swings the <span class="txt-blue">blue</span> saber, <strong>right button</strong> the <span class="txt-red">red</span>. Move the mouse to aim; swing in the arrow's direction.</p>
```

- [ ] **Step 4: Full-flow browser test**

Navigate to `http://127.0.0.1:8770/beat-saber/index.html`, then drive via clicks/evaluate:
1. click Play, select Normal, click Start → assert `screen-game` active and a `canvas.scene3d-canvas` exists.
2. play ~10s swinging both buttons (as Task 7 test), then click `#btn-end`.
3. assert `screen-results` active and `#res-score` matches `Game.getStats().score`.

Evaluate for the final assertion:
```js
() => ({ screen: document.querySelector('.screen.is-active')?.id,
         resScore: document.getElementById('res-score').textContent,
         live: Game.getStats() })
```
Expected: `screen === 'screen-results'`; `resScore` equals `live.score.toLocaleString()` at end.

- [ ] **Step 5: Commit**

```bash
git add beat-saber/js/ui.js beat-saber/index.html
git commit -m "feat(beat-saber): wire 3D game to UI, latency calibration, how-to copy"
```

---

## Task 9: Webcam SaberSource (Phase 2, MediaPipe)

**Files:**
- Create: `beat-saber/js/input/webcam-source.js`
- Modify: `beat-saber/index.html` (load MediaPipe; input toggle in settings)
- Modify: `beat-saber/js/ui.js` (choose input from settings, fallback to mouse)

**Interfaces:**
- Consumes: MediaPipe Tasks Vision `HandLandmarker` (from CDN); the playfield mount.
- Produces: `WebcamSource` registered as `'webcam'`, same `{start, stop, read}` contract as the mouse source; left hand → blue, right hand → red.

- [ ] **Step 1: Load MediaPipe (CDN) in index.html**

Add before the game scripts in `beat-saber/index.html`:
```html
  <script src="js/input/webcam-source.js" defer></script>
```
(The webcam source imports the Tasks Vision module dynamically at `start()` so the page does not pay for it unless webcam is chosen — see Step 2.)

- [ ] **Step 2: Implement the webcam source**

Create `beat-saber/js/input/webcam-source.js`:
```js
/* Webcam hand-tracking saber input via MediaPipe HandLandmarker.
     left hand  -> blue saber
     right hand -> red saber
   Same contract as the mouse source; the gameplay does not change. Falls back
   is handled by the caller (ui.js): if start() rejects, it uses 'mouse'. */
"use strict";
(function () {
  const VISION_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
  const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

  function WebcamSource(mount) {
    let video, landmarker, stream, prev = {}, latest = [];
    let rafId = 0;

    async function start() {
      const vision = await import(VISION_URL + "/vision_bundle.mjs");
      const fileset = await vision.FilesetResolver.forVisionTasks(VISION_URL + "/wasm");
      landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL },
        numHands: 2, runningMode: "VIDEO",
      });
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      video = document.createElement("video");
      video.autoplay = true; video.playsInline = true; video.srcObject = stream;
      await video.play();
      const track = () => {
        rafId = requestAnimationFrame(track);
        if (!landmarker || video.readyState < 2) return;
        const res = landmarker.detectForVideo(video, performance.now());
        latest = interpret(res);
      };
      track();
    }

    function interpret(res) {
      const sabers = [];
      const hands = (res && res.handedness) || [];
      for (let i = 0; i < hands.length; i++) {
        const label = hands[i][0].categoryName;                 // 'Left' | 'Right'
        const lm = res.landmarks[i][8];                         // index fingertip
        // camera is mirrored: user's right hand appears on the left of frame
        const hand = label === "Left" ? "right" : "left";
        const color = hand === "left" ? "blue" : "red";
        const tip = { x: 1 - lm.x, y: lm.y };                   // un-mirror x
        const p = prev[hand] || tip;
        const vel = { x: tip.x - p.x, y: tip.y - p.y };
        prev[hand] = tip;
        const active = Math.hypot(vel.x, vel.y) > 0.01;
        sabers.push({ hand, color, tip, vel, active });
      }
      return sabers;
    }

    function stop() {
      if (rafId) cancelAnimationFrame(rafId);
      if (landmarker && landmarker.close) landmarker.close();
      if (stream) stream.getTracks().forEach((t) => t.stop());
      landmarker = stream = video = null; latest = []; prev = {};
    }
    function read() { return latest; }
    return { start, stop, read };
  }

  if (window.SaberSources) window.SaberSources.register("webcam", WebcamSource);
})();
```

- [ ] **Step 3: Add the input toggle + fallback in the UI**

In `beat-saber/index.html` settings, add:
```html
          <label class="setting setting--toggle">
            <span class="setting__label">Webcam Sabers (experimental)</span>
            <input type="checkbox" class="toggle" id="set-webcam" />
          </label>
```
In `beat-saber/js/ui.js` `startGame`, choose the source with a fallback:
```js
  const useWebcam = document.getElementById("set-webcam") && document.getElementById("set-webcam").checked;
  let inputName = useWebcam && window.SaberSources.has("webcam") ? "webcam" : "mouse";
  showScreen("game");
  try {
    await window.Game.start(song, { difficulty, inputName, latency_ms, onEnd: showResults });
  } catch (err) {
    if (inputName === "webcam") {                    // tracking failed: fall back
      console.warn("webcam unavailable, falling back to mouse:", err);
      await window.Game.start(song, { difficulty, inputName: "mouse", latency_ms, onEnd: showResults });
    } else { console.error("could not start:", err); showResults(null); }
  }
```
(Replace the existing `try { await window.Game.start(...) }` block with this.)

- [ ] **Step 4: Manual verification (camera required)**

This step is verified by a human with a webcam, since headless has no camera:
1. Enable "Webcam Sabers" in Settings, grant camera permission.
2. Start Frieren; confirm two sabers appear and track your hands (left=blue, right=red).
3. Confirm swinging a hand through a matching-color block in the arrow direction scores.
4. Deny permission on a second run; confirm it falls back to mouse and is still playable.

Note in the commit body that Step 4 is manual (no automated camera in CI).

- [ ] **Step 5: Commit**

```bash
git add beat-saber/js/input/webcam-source.js beat-saber/index.html beat-saber/js/ui.js
git commit -m "feat(beat-saber): experimental webcam hand-tracking sabers with mouse fallback"
```

---

## Self-Review

**Spec coverage:**
- Three.js vendored + renders in playfield → Task 1, Task 5. ✓
- AnchoredClock, transport through clock, session reads clock → Task 2, Task 7. ✓
- Backlog-aware spawning at true `in_ms` → Task 7 (`HITTABLE_MIN_MS`, `in_ms` check). ✓
- Beat-grid mapper, deterministic, density by difficulty, quarter-note only → Task 3. ✓
- Cut-direction enforced + color match + musical-position judging → Task 4, Task 7. ✓
- Pluggable input; mouse first (two-button, **right-click fixed**), webcam second → Task 6, Task 9. ✓
- Right mouse button / context-menu fix → Task 6 (`onContext` preventDefault, tested in Step 3). ✓
- Calibration = display/input latency only, not audio → Task 8 (slider), applied in Judge (Task 4/7). ✓
- Note blocks only (no bombs/walls) → nothing spawns them. ✓
- Prerequisite branch fast-forward + clock conformance → Task 0. ✓
- Testing: clock conformance (Task 0), pure unit tests (Task 3, 4), browser integration (Task 5, 6, 7, 8). ✓

**Placeholder scan:** No TBD/TODO; all code blocks are complete; browser test steps include exact evaluate code and expected output.

**Type consistency:** `note` shape `{key,hitSec,lane,color,direction}` is identical across Mapper (Task 3), Scene3D (Task 5), Judge (Task 4), Game (Task 7). `Saber` shape `{hand,color,tip,vel,active}` is identical across saber-source (Task 6), mouse-source (Task 6), Scene3D.setSabers (Task 5), Game/Judge (Task 4/7). `makeSession(score, positionFn)` new signature (Task 2) is used consistently in Game (Task 7). `Scene3D` method names (`init/spawnBlock/update/sliceBlock/missBlock/setSabers/clear/dispose`) match between Task 5 definition and Task 7 calls.

## Notes for the executor

- `serve.py` must be running on 8770; the game only works when opened at `/beat-saber/index.html` there (absolute `/protocol/` paths).
- Browser verification uses the harness Playwright tools (navigate + evaluate), the same way the current prototype was verified. Save no screenshots into the repo root; clean up `.playwright-mcp/` if created.
- `beat-saber/` is untracked today; the first `git add` of a new file begins tracking it. That is intended.
