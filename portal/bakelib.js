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

module.exports = { frameAt, slew, makeStreamSampler, bindingValueFn, clamp01 };
