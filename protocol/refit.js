#!/usr/bin/env node
"use strict";
/* refit.js — make the grid RULE reproduce the recording.
   ===========================================================================
   SPEC.md is right that a score carries a rule and never a list of beat times:
   a list is wrong the moment anyone moves the tempo. But a rule is only worth
   having if it reproduces the music, and on Raga of Revenge the fitted rule
   misses the tracked beats by 526 ms on average and 1304 ms at worst -- over
   two beats by the end of the song. Everything downstream then inherits that:
   the editor draws its bar lines in the wrong place, the beat counter on the
   playing screen reads 4 where a musician counts 1, and any cue anchored in
   bars lands somewhere the band is not.

   Two faults, both repairable without adding a single second to the format:

     PHASE  first_beat_s is the first DETECTED beat, which on this song is not a
            downbeat -- the first flagged one is two beats later. SPEC says the
            number is "its first downbeat", so beat 0 is moved there and the two
            beats before it become the pickup, counting backwards into bar 0.

     FIT    one constant-tempo segment cannot describe a span whose tempo moves.
            The format already allows as many segments as the music needs, so
            segments are added until the rule lands on every tracked beat within
            the tolerance.

   The output is still a rule. Nothing downstream has to change to read it. */
const fs = require("fs");

const TOL = +(process.env.TOL || 0.012);          /* seconds a beat may be out */

function refit(score) {
  const B = score.beats.filter(b => typeof b.t === "number");
  const T = B.map(b => b.t);
  const bpb = score.grid.beats_per_bar || 4;
  const d0 = B.findIndex(b => b.downbeat);
  if (d0 < 0) throw new Error("no flagged downbeat: nothing to phase to");

  /* The beats BEFORE the first downbeat are a pickup, and a pickup in bar 0 is
     a trap: every derivation clamps a bar to at least 1, so those beats collapse
     onto bar 1 beat 1 and the song comes back with one more downbeat than it has
     bars. Rather than teach five consumers about negative bars, the pickup is
     lifted out of the beat table and kept beside it -- nothing measured is lost,
     and bar 1 beat 1 is the first beat of the first bar with no special case. */
  const pickup = B.slice(0, d0).map(b => ({ t: b.t }));

  /* greedy: extend a constant-tempo segment while every beat in it lands
     within TOL, then start another one where it stops fitting. */
  const segs = [];
  let i = 0;
  while (i < T.length - 1) {
    let j = i + 1, bpm = 60 / (T[j] - T[i]), best = j;
    for (; j < T.length; j++) {
      const cand = 60 * (j - i) / (T[j] - T[i]);
      let ok = true;
      for (let k = i + 1; k <= j; k++)
        if (Math.abs(T[i] + (k - i) * 60 / cand - T[k]) > TOL) { ok = false; break; }
      if (!ok) break;
      bpm = cand; best = j;
    }
    segs.push({ from_beat: i - d0, at_s: +T[i].toFixed(4), bpm: +bpm.toFixed(3) });
    i = best;
    if (best === segs.length - 1) break;
  }

  const secondsAt = n => {
    let s = segs[0];
    for (const x of segs) if (x.from_beat <= n) s = x; else break;
    return s.at_s + (n - s.from_beat) * 60 / s.bpm;
  };

  /* relabel every beat from the rule. Beat 0 is bar 1 beat 1; the pickup counts
     backwards into bar 0, which is what SPEC asks for. */
  const lab = n => {
    const bar = Math.floor(n / bpb) + 1, beat = ((n % bpb) + bpb) % bpb + 1;
    return { bar: n < 0 ? Math.floor(n / bpb) + 1 : bar, beat };
  };
  /* Every OTHER field in the score is addressed in the OLD bar and beat --
     sections, moments, layers.subsection, layers.presence, energy.from_bar,
     harmony.from_bar. Renumbering the beat table without renumbering those
     silently detaches them: the form layer stops covering the song and the
     moments stop landing inside the spans that contain them. So the old label
     is captured first and every reference is carried across with it. */
  const oldOf = new Map(), oldBar = new Map();
  B.forEach((b, k) => {
    const key = b.bar + ":" + b.beat;
    if (!oldOf.has(key)) oldOf.set(key, k);
    if (!oldBar.has(b.bar)) oldBar.set(b.bar, k);
  });

  let worst = 0, total = 0;
  B.forEach((b, k) => {
    const n = k - d0, p = lab(n), pred = secondsAt(n), err = Math.abs(b.t - pred);
    worst = Math.max(worst, err); total += err;
    b.bar = p.bar; b.beat = p.beat; b.off_ms = Math.round((b.t - pred) * 1000);
  });

  const newOf = B.map(b => ({ bar: b.bar, beat: b.beat }));
  const mapPos = p => {
    const i = oldOf.get(p.bar + ":" + p.beat);
    if (i != null) return { ...p, ...newOf[i] };
    const j = oldBar.get(p.bar);
    return j != null ? { ...p, bar: newOf[j].bar, beat: p.beat } : p;
  };
  const mapBar = n => {
    const j = oldBar.get(n);
    return j != null ? newOf[j].bar : n;
  };
  const walk = (node, key) => {
    if (Array.isArray(node)) return node.map(x => walk(x, key));
    if (!node || typeof node !== "object") return node;
    if (typeof node.bar === "number" && typeof node.beat === "number" && node.t == null)
      return mapPos(node);
    const out = {};
    for (const k of Object.keys(node)) {
      if (/^(from_bar|to_bar|first_bar|last_bar)$/.test(k) && typeof node[k] === "number") out[k] = mapBar(node[k]);
      else out[k] = walk(node[k], k);
    }
    return out;
  };
  for (const k of Object.keys(score)) {
    if (k === "beats" || k === "grid" || k === "downbeats") continue;
    score[k] = walk(score[k], k);
  }

  const dom = segs.slice().sort((a, b) =>
    (a.from_beat - b.from_beat) - (a.from_beat - b.from_beat))[0];
  score.grid = {
    ...score.grid,
    bpm: +(score.key_tempo && score.key_tempo.grid_bpm || dom.bpm),
    first_beat_s: +T[d0].toFixed(4),
    first_bar: 1,
    tempo: segs,
    refit: { tolerance_s: TOL, segments: segs.length,
             mean_err_ms: +(1000 * total / B.length).toFixed(1),
             max_err_ms: +(1000 * worst).toFixed(1),
             note: "beat 0 is the first FLAGGED downbeat; beats before it are the pickup in bar 0" },
  };
  score.beats = B.slice(d0);
  score.downbeats = score.beats.filter(b => b.downbeat);
  if (pickup.length) score.grid.pickup = { count: pickup.length, before_bar_1: pickup.map(p => +p.t.toFixed(3)) };
  return { score, segs, mean: 1000 * total / B.length, worst: 1000 * worst, d0 };
}

if (require.main === module) {
  const f = process.argv[2];
  if (!f) { console.error("usage: refit.js <score> [--write]"); process.exit(2); }
  const score = JSON.parse(fs.readFileSync(f, "utf8"));
  const before = (() => {
    const t = score.grid.tempo || [{ from_beat: 0, at_s: score.grid.first_beat_s, bpm: score.grid.bpm }];
    const at = n => { let s = t[0]; for (const x of t) if (x.from_beat <= n) s = x; return s.at_s + (n - s.from_beat) * 60 / s.bpm; };
    const e = score.beats.map((b, i) => Math.abs(b.t - at(i)));
    return { mean: 1000 * e.reduce((a, c) => a + c, 0) / e.length, max: 1000 * Math.max(...e) };
  })();
  const r = refit(score);
  const onOne = r.score.beats.filter(b => b.downbeat).every(b => b.beat === 1);
  console.log("before:  " + (score.grid.tempo ? "" : "") + before.mean.toFixed(0) + " ms mean, " + before.max.toFixed(0) + " ms max");
  console.log("after:   " + r.mean.toFixed(1) + " ms mean, " + r.worst.toFixed(1) + " ms max, " + r.segs.length + " tempo segments");
  console.log("phase:   beat 0 moved to " + r.score.grid.first_beat_s + "s (was " + score.grid.first_beat_s + "s)");
  console.log("every flagged downbeat is bar N beat 1: " + (onOne ? "YES" : "NO"));
  if (process.argv.includes("--write")) {
    fs.writeFileSync(f, JSON.stringify(r.score, null, 1) + "\n");
    console.log("wrote " + f);
  }
}
module.exports = { refit };
