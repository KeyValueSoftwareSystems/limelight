"use strict";
/* bakelib.js — the pure, testable core of the show baker.

   baker.js is a CLI that reads argv and writes a file, which makes it awkward to
   test. The three pieces of logic that decide what a frame looks like live here
   instead, as pure functions:

     frameAt(dmx, localT, spanDur, bpm)   which frame of an effect plays at a time
     slew(prev, target, maxStep)          a moving head cannot teleport
     makeStreamSampler(score)             the live value a binding follows
     bindingValueFn(binding, sampler)     what to pass render() for each binding

   All four are covered by bakelib.test.js. baker.js is a thin shell over them. */

/* ── which frame of a looping effect plays at localT ────────────────────────
   States and gestures both return { frames, loop_beats }. A single frame is a
   held look. Multiple frames LOOP: loop_beats>0 means the frames span that many
   beats and repeat; loop_beats==0 means they play once across the whole span.
   This is the fix for the baker rendering only frames[0] for states — a drone
   that breathes over four beats now actually breathes. */
function frameAt(dmx, localT, spanDur, bpm) {
  const frames = dmx && dmx.frames;
  if (!frames || !frames.length) return null;
  if (frames.length === 1) return frames[0];
  const loopDur = dmx.loop_beats > 0 ? dmx.loop_beats * (60 / bpm) : spanDur;
  if (!(loopDur > 0)) return frames[0];
  const idx = Math.floor((localT / loopDur) * frames.length);
  const fi = ((idx % frames.length) + frames.length) % frames.length; // wrap, incl. negatives
  return frames[fi];
}

/* ── head slew limit ────────────────────────────────────────────────────────
   Clamp a channel's change between consecutive frames to what the fixture can
   physically do in 1/fps of a second. A real moving head cannot jump from one
   side of the room to the other in 25ms; without this, cross-effect seams (a
   gesture ending, a state resuming) snap the beam. */
function slew(prev, target, maxStep) {
  const d = target - prev;
  if (d > maxStep) return prev + maxStep;
  if (d < -maxStep) return prev - maxStep;
  return target;
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

/* ── stream sampler ─────────────────────────────────────────────────────────
   A binding names a stream ("vocal") or a pair (["lead-vocal","back-vocal"]),
   or rides drum onsets (accent). The composer's plan is rig-agnostic and carries
   only the name; this turns (name, time) into the 0..1 value the effect's
   render() wants, reading the score's own measurements:

     stems_temporal.stems[name]  per-window (window_s) level series, 0..1
     rhythm.hits                  onsets [{t, intensity}]

   Without this the baker fed a constant 0.5 to every binding, so follow sat
   flat, split rendered black (0.5 is not an array), and accent never fired. */
function makeStreamSampler(score, opts) {
  opts = opts || {};
  const st = (score && score.stems_temporal) || {};
  const win = st.window_s > 0 ? st.window_s : 0.5;
  const stems = st.stems || {};
  const names = Object.keys(stems);
  const byLower = new Map(names.map(n => [n.toLowerCase(), n]));

  /* Map a composer-supplied stream name to an actual stem. Exact first, then
     separator-normalised ("lead vocal" -> "lead-vocal"), then substring either
     way (shortest wins) so "vocal" resolves even if only "lead-vocal" exists. */
  function resolveStemName(name) {
    if (name == null) return null;
    const key = String(name).toLowerCase().trim();
    if (byLower.has(key)) return byLower.get(key);
    const norm = key.replace(/[\s_]+/g, "-");
    if (byLower.has(norm)) return byLower.get(norm);
    let best = null;
    for (const n of names) {
      const nl = n.toLowerCase();
      if (nl === norm || nl.includes(norm) || norm.includes(nl)) {
        if (best === null || n.length < best.length) best = n;
      }
    }
    return best;
  }

  /* Linear interpolation between window centres. Window i is the average over
     [i*win, (i+1)*win), so its centre is (i+0.5)*win; x = t/win - 0.5 lands on
     window i when t is that centre. Clamped at both ends. */
  function sampleStem(name, t) {
    const resolved = resolveStemName(name);
    if (resolved === null) return 0;
    const series = stems[resolved];
    if (!Array.isArray(series) || series.length === 0) return 0;
    const x = t / win - 0.5;
    if (x <= 0) return clamp01(series[0]);
    const i = Math.floor(x);
    if (i >= series.length - 1) return clamp01(series[series.length - 1]);
    const frac = x - i;
    return clamp01(series[i] * (1 - frac) + series[i + 1] * frac);
  }

  /* Onset envelope for accent. Each hit rings at its intensity then falls to 0
     over `onset_decay_s`. Intensity is normalised to the song's loudest hit so a
     threshold reads as "relative to this song" (architecture.md), not an
     absolute the measured onsets (here ~0..0.8) would never cross. */
  const hits = (((score && score.rhythm && score.rhythm.hits) || [])
    .filter(h => h && typeof h.t === "number")
    .slice()
    .sort((a, b) => a.t - b.t));
  let maxI = 0;
  for (const h of hits) { const v = h.intensity != null ? h.intensity : 1; if (v > maxI) maxI = v; }
  const norm = maxI > 0 ? maxI : 1;
  const decay = opts.onset_decay_s > 0 ? opts.onset_decay_s : 0.12;

  function sampleOnset(t) {
    let v = 0;
    for (let i = hits.length - 1; i >= 0; i--) {
      const dt = t - hits[i].t;
      if (dt < 0) continue;
      if (dt > decay) break; // sorted ascending; earlier hits are only older
      const inten = (hits[i].intensity != null ? hits[i].intensity : 1) / norm;
      const env = (1 - dt / decay) * inten;
      if (env > v) v = env;
    }
    return clamp01(v);
  }

  return { sampleStem, sampleOnset, resolveStemName, window_s: win, stemNames: names };
}

/* ── what a binding passes to render() each frame ───────────────────────────
   accent rides onsets (a scalar). A binding naming two streams (split) gets a
   [left, right] pair. Anything else (follow) gets a single stream's scalar. The
   shape has to match what the effect module's render() destructures. */
function bindingValueFn(binding, sampler) {
  const streams = binding && binding.streams;
  if (binding && binding.eid === "accent") return t => sampler.sampleOnset(t);
  if (Array.isArray(streams) && streams.length >= 2) {
    return t => streams.map(s => sampler.sampleStem(s, t));
  }
  const single = Array.isArray(streams) ? streams[0] : streams;
  return t => sampler.sampleStem(single, t);
}

/* ── the real beat grid ─────────────────────────────────────────────────────
   Beat-locked effects must phase off the song's ACTUAL beat times, not a nominal
   BPM — this song is 89 bpm for its first ~17s then 119, so a constant-BPM grid
   drifts through the intro. Ported from concert.py's BeatList: a fractional beat
   index at any time, extrapolated with the median interval past the ends. Each
   beat also knows if it's a downbeat, so a bar index comes for free. */
function _median(a) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

function makeBeatClock(beats, fallbackBpm) {
  const arr = (beats || []).filter(b => b && typeof b.t === "number").sort((a, b) => a.t - b.t);
  const times = arr.map(b => b.t);
  const isDb = arr.map(b => !!b.downbeat);
  const step = times.length > 1 ? _median(times.slice(1).map((t, i) => t - times[i])) : (60 / (fallbackBpm || 120));
  // cumulative bar index per beat (each downbeat starts a new bar)
  const barOfBeat = []; let bar = -1;
  for (let i = 0; i < arr.length; i++) { if (isDb[i] || i === 0) bar++; barOfBeat.push(Math.max(0, bar)); }

  function beatAt(t) {
    if (!times.length) return t / step;
    let lo = 0, hi = times.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (times[m] <= t) lo = m + 1; else hi = m; }
    const i = lo - 1;
    if (i < 0) return (t - times[0]) / step;                                   // before the first beat
    if (i >= times.length - 1) return (times.length - 1) + (t - times[times.length - 1]) / step;
    return i + (t - times[i]) / (times[i + 1] - times[i]);
  }
  const isDownbeat = idx => (idx >= 0 && idx < isDb.length ? isDb[idx] : (idx % 4 === 0));
  const barIndex = idx => (idx >= 0 && idx < barOfBeat.length ? barOfBeat[idx] : Math.floor(Math.max(0, idx) / 4));
  return { beatAt, isDownbeat, barIndex, beatStep: step, count: times.length };
}

/* ── per-beat weight ────────────────────────────────────────────────────────
   How hard each beat lands, 0..1, from the measured drum onsets in that beat's
   window (normalised to the song's loudest onset). This is what lets a hit follow
   the track's own dynamics instead of a uniform grid. */
function makePerBeatWeight(hits, beats) {
  const bt = (beats || []).filter(b => b && typeof b.t === "number").map(b => b.t).sort((a, b) => a - b);
  const hh = (hits || []).filter(h => h && typeof h.t === "number").sort((a, b) => a.t - b.t);
  let maxI = 0; for (const h of hh) { const v = h.intensity != null ? h.intensity : 1; if (v > maxI) maxI = v; }
  const norm = maxI > 0 ? maxI : 1;
  const w = new Array(Math.max(1, bt.length)).fill(0);
  let j = 0;
  for (let i = 0; i < bt.length; i++) {
    const lo = bt[i], hi = i + 1 < bt.length ? bt[i + 1] : lo + (i > 0 ? bt[i] - bt[i - 1] : 0.5);
    while (j < hh.length && hh[j].t < lo) j++;
    let m = 0;
    for (let k = j; k < hh.length && hh[k].t < hi; k++) { const v = (hh[k].intensity != null ? hh[k].intensity : 1) / norm; if (v > m) m = v; }
    w[i] = m;
  }
  return { weightAt: beatFrac => w[Math.max(0, Math.min(w.length - 1, Math.floor(beatFrac)))] || 0, weights: w };
}

/* ── energy curve ───────────────────────────────────────────────────────────
   A dense 0..1 loudness proxy: the summed stem activity at time t (0.5s windows,
   linearly interpolated), normalised to the song's peak. Drives a section's
   floor/peak so the room breathes with the mix. */
function makeEnergy(score) {
  const st = (score && score.stems_temporal) || {};
  const win = st.window_s > 0 ? st.window_s : 0.5;
  const stems = st.stems || {};
  const names = Object.keys(stems);
  const nwin = names.length ? stems[names[0]].length : 0;
  const total = new Array(nwin).fill(0);
  for (const n of names) { const s = stems[n]; for (let i = 0; i < nwin; i++) total[i] += (s[i] || 0); }
  let mx = 0; for (const v of total) if (v > mx) mx = v; const norm = mx > 0 ? mx : 1;
  function energyAt(t) {
    if (!nwin) return 0.5;
    const x = t / win - 0.5;
    if (x <= 0) return total[0] / norm;
    const i = Math.floor(x);
    if (i >= nwin - 1) return total[nwin - 1] / norm;
    const f = x - i;
    return (total[i] * (1 - f) + total[i + 1] * f) / norm;
  }
  return { energyAt };
}

module.exports = {
  frameAt, slew, makeStreamSampler, bindingValueFn, clamp01,
  makeBeatClock, makePerBeatWeight, makeEnergy,
};
