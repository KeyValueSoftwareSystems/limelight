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
    window.Scene3D.resize();
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
      if (!s.active) continue;                   // that saber's button must be held
      // The mouse is a sharp point: only blocks the pointer is actually over can
      // be touched. Raycast through the cursor and cut what it lands on.
      const keys = window.Scene3D.pickBlocks(s.tip.x, s.tip.y);
      for (const key of keys) {
        const note = notes.get(key);
        if (!note) continue;
        if (progressOf(key) < 0.5) continue;     // must be near the strike line to reach
        const r = window.Judge.judge(note, s, nowSec,
          { latency_ms: latency_ms, require_direction: false, require_color: false });
        if (r.hit) hit(key);
      }
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
