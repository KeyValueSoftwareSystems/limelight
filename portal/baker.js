#!/usr/bin/env node
"use strict";
/* baker.js — bake a show plan into DMX frames using per-venue DMX functions.

     node portal/baker.js <score> <plan.json> --rig <rig> --lights <out>

   The plan is a show plan (states, bindings, gestures) produced by the composer.
   The rig is a directory under portal/venues/ with DMX function modules for each
   supported effect.

   This replaces the role of portal/effects.js for the new architecture:
   - Instead of interpreting gestures through frame.js, it calls per-venue DMX
     functions that produce raw frames directly
   - Multi-layer composition with per-fixture fallthrough:
     gesture > binding > state, for each fixture independently

   Output: a .lights.json in the same format the existing player expects. */

const fs = require("fs");
const path = require("path");

const HERE = path.join(__dirname);
const REPO = path.dirname(HERE);
const LIGHTS = path.join(REPO, "readers", "lights");

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const scoreFile = args[0];
const planFile = args[1] && !args[1].startsWith("--") ? args[1] : null;
const rigName = opt("--rig", "club16-2head");
const lightsOut = opt("--lights", null);
const fps = +opt("--fps", 40);

if (!scoreFile || !planFile || !lightsOut) {
  console.error("usage: baker.js <score> <plan.json> --rig <rig> --lights <out>");
  process.exit(2);
}

/* ── load inputs ──────────────────────────────────────────────────────────── */

const { load } = require(path.join(LIGHTS, "fromscore.js"));
const { frameAt, slew, makeStreamSampler, bindingValueFn,
        makeBeatClock, makePerBeatWeight, makeEnergy } = require("./bakelib.js");
const score = load(scoreFile);
const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));

/* the sampler turns a binding's stream name + a time into the 0..1 value its
   render() follows, reading the score's own per-window stems and drum onsets. */
const sampler = makeStreamSampler(score);

const venueDir = path.join(HERE, "venues", rigName);
const manifest = JSON.parse(fs.readFileSync(path.join(venueDir, "manifest.json"), "utf8"));
const layoutFile = path.join(LIGHTS, manifest.layout_file);
const layout = JSON.parse(fs.readFileSync(layoutFile, "utf8"));

const TOTAL_CH = manifest.total_channels;
const catalog = JSON.parse(fs.readFileSync(path.join(HERE, "effects.json"), "utf8")).effects;
const catalogById = Object.fromEntries(catalog.map(e => [e.id, e]));

/* ── score clock ──────────────────────────────────────────────────────────── */

const { Session } = require(path.join(REPO, "protocol", "session.js"));
const S = Session(score, { now: () => 0 });
const bpm = score.grid.bpm;
const bpb = score.grid.beats_per_bar || 4;
const bars = score.grid.bars || 120;
/* the grid can run a bar or so past the audio; cap at the song length so the show
   doesn't trail off into dead black frames after the music ends. */
const songLen = (score.song && score.song.length_s) || null;
const dur = songLen ? Math.min(songLen, S.secondsAt(bars + 1, 1)) : S.secondsAt(bars + 1, 1);
const sections = score.sections || [];

/* gestures that OWN the rig — they REPLACE the layer under them rather than
   accenting over it. Darkeners (blackout/cut/hush/strip/isolate) need this so
   they can pull the room down; anticipation needs it so the room goes dark
   BETWEEN its strobe pops instead of the bed filling the gaps. Every other
   gesture is a departure that brightens and RETURNS to the resting look, so it
   composites OVER the state/binding by max. */
const REDUCTIVE = new Set(["blackout", "cut", "hush", "strip", "isolate", "anticipation"]);

/* ── the real beat grid, per-beat weight, and energy curve ──────────────────
   Beat-locked effects render per frame against these instead of a nominal BPM,
   so hits land on the song's ACTUAL beats (this song is 89 bpm then 119), scale
   with the drums, and breathe with the mix. */
const beatClock = makeBeatClock(score.beats, bpm);
const perBeat = makePerBeatWeight((score.rhythm && score.rhythm.hits) || [], score.beats);
const energyCurve = makeEnergy(score);

/* what a beat-locked effect's render(bx) receives each frame */
function beatCtx(startS, endS, t) {
  const beat = beatClock.beatAt(t);
  const bi = Math.floor(beat);
  const span = (endS || 0) - (startS || 0);
  return {
    t, beat, beatIndex: bi, bphase: beat - bi,
    bar: beatClock.barIndex(bi), downbeat: beatClock.isDownbeat(bi),
    weight: perBeat.weightAt(beat), energy: energyCurve.energyAt(t),
    p: span > 0 ? Math.max(0, Math.min(1, (t - startS) / span)) : 0,
  };
}

function sectionAt(t) {
  for (let i = sections.length - 1; i >= 0; i--) {
    const s = sections[i];
    const start = S.secondsAt(s.from.bar, s.from.beat || 1);
    if (t >= start) return i;
  }
  return 0;
}

function barBeatAt(t) {
  const pos = S.positionAt(t);
  return { bar: pos.bar, beat: pos.beat };
}

/* ── load venue DMX functions ─────────────────────────────────────────────── */

const dmxFunctions = {};
for (const eid of manifest.supported_effects) {
  const fpath = path.join(venueDir, eid + ".js");
  if (fs.existsSync(fpath)) {
    dmxFunctions[eid] = require(fpath);
  }
}

/* ── resolve plan entries to timed spans ──────────────────────────────────── */

const moments = score.moments || [];

function resolveGesture(g) {
  const eid = g.effect;
  const edef = catalogById[eid];
  if (!edef || !dmxFunctions[eid]) return null;

  let startS, endS;
  if (g.at_s != null) {
    /* absolute-time anchor — for placing on a computed event (a drop, a gap)
       that the moment labels don't mark. lead_beats still pulls it earlier. */
    const leadBeats = g.lead_beats || 0;
    startS = g.at_s - leadBeats * (60 / bpm);
    const forBeats = g.for_beats || edef.default_beats || 1;
    endS = startS + forBeats * (60 / bpm);
  } else if (g.from_s != null && g.to_s != null) {
    startS = g.from_s; endS = g.to_s;
  } else if (g.moment != null && g.moment >= 0 && g.moment < moments.length) {
    const m = moments[g.moment];
    const leadBeats = g.lead_beats || 0;
    startS = (m.time_s || m.at_s || 0) - leadBeats * (60 / bpm);
    const forBeats = g.for_beats || edef.default_beats || 1;
    endS = startS + forBeats * (60 / bpm);
  } else if (g.from_moment != null && g.to_moment != null) {
    const fm = moments[g.from_moment];
    const tm = moments[g.to_moment];
    if (!fm || !tm) return null;
    startS = fm.time_s || fm.at_s || 0;
    endS = tm.time_s || tm.at_s || 0;
  } else {
    return null;
  }

  const SKIP = new Set(["effect", "moment", "from_moment", "to_moment", "lead_beats", "why", "at_s", "from_s", "to_s"]);
  const params = { ...edef.dials };
  for (const [k, v] of Object.entries(g)) {
    if (!SKIP.has(k)) {
      if (typeof v === "object" && v !== null && v.default !== undefined) {
        params[k] = v.default;
      } else {
        params[k] = v;
      }
    }
  }
  const resolvedParams = {};
  for (const [k, v] of Object.entries(params)) {
    resolvedParams[k] = typeof v === "object" && v !== null && v.default !== undefined ? v.default : v;
  }

  return { eid, startS: Math.max(0, startS), endS, params: resolvedParams, kind: "gesture" };
}

function resolveBinding(b) {
  const eid = b.effect;
  const edef = catalogById[eid];
  if (!edef || !dmxFunctions[eid]) return null;
  const secIdx = b.section;
  if (secIdx == null || secIdx < 0 || secIdx >= sections.length) return null;
  const sec = sections[secIdx];
  const startS = S.secondsAt(sec.from.bar, sec.from.beat || 1);
  const endS = S.secondsAt(sec.to.bar, sec.to.beat || 1);

  const params = {};
  for (const [k, v] of Object.entries(b)) {
    if (k !== "effect" && k !== "section" && k !== "why") {
      params[k] = typeof v === "object" && v !== null && v.default !== undefined ? v.default : v;
    }
  }
  return { eid, startS, endS, params, kind: "binding", streams: b.streams || b.stream };
}

function resolveState(s) {
  const eid = s.effect;
  const edef = catalogById[eid];
  if (!edef || !dmxFunctions[eid]) return null;
  const secIdx = s.section;
  if (secIdx == null || secIdx < 0 || secIdx >= sections.length) return null;
  const sec = sections[secIdx];
  const startS = S.secondsAt(sec.from.bar, sec.from.beat || 1);
  const endS = S.secondsAt(sec.to.bar, sec.to.beat || 1);

  const params = {};
  for (const [k, v] of Object.entries(s)) {
    if (k !== "effect" && k !== "section" && k !== "why") {
      params[k] = typeof v === "object" && v !== null && v.default !== undefined ? v.default : v;
    }
  }
  return { eid, startS, endS, params, kind: "state" };
}

const resolvedGestures = (plan.gestures || []).map(resolveGesture).filter(Boolean);
const resolvedBindings = (plan.bindings || []).map(resolveBinding).filter(Boolean);
const resolvedStates   = (plan.states || []).map(resolveState).filter(Boolean);

/* each binding gets a per-frame value function of the right shape for its
   render() — a scalar for follow, an onset scalar for accent, a [left,right]
   pair for split. */
resolvedBindings.forEach(b => { b.valueAt = bindingValueFn(b, sampler); });

/* ── generate DMX frames for each resolved entry ─────────────────────────── */

function generateFrames(entry) {
  const fn = dmxFunctions[entry.eid];
  if (!fn) return null;
  /* duration_s lets a span gesture (a build) place beat-locked hits across its
     own length while its floor rises. */
  const ctx = { fps, bpm, layout, duration_s: (entry.endS || 0) - (entry.startS || 0) };
  const result = fn(entry.params, ctx);
  return result;
}

/* ── bake: compose layers per frame ───────────────────────────────────────── */

const stateResults = resolvedStates.map(s => ({ ...s, dmx: generateFrames(s) })).filter(r => r.dmx);
const bindingResults = resolvedBindings.map(b => ({ ...b, dmx: generateFrames(b) })).filter(r => r.dmx);
const gestureResults = resolvedGestures.map(g => ({ ...g, dmx: generateFrames(g) })).filter(r => r.dmx);

const allFrames = [];
const fixtureIds = layout.fixtures.map(f => f.id);
const fixtureChannels = {};
for (const f of layout.fixtures) {
  const profPath = path.join(LIGHTS, "drivers", "profiles", f.type + ".profile.json");
  const prof = JSON.parse(fs.readFileSync(profPath, "utf8"));
  const offset = f.address - 1;
  const roles = (prof.channels || []).map(c => c.role);
  const panIdx = roles.indexOf("pan"), tiltIdx = roles.indexOf("tilt"), masterIdx = roles.indexOf("master");
  const lim = prof.limits || {};
  fixtureChannels[f.id] = {
    offset, width: prof.footprint,
    panCh:  panIdx  >= 0 ? offset + panIdx  : -1,   // for the head slew limit
    tiltCh: tiltIdx >= 0 ? offset + tiltIdx : -1,
    masterCh: masterIdx >= 0 ? offset + masterIdx : -1,   // for head brighten-compositing
    maxPan:  lim.max_pan_per_frame  > 0 ? lim.max_pan_per_frame  : 7,
    maxTilt: lim.max_tilt_per_frame > 0 ? lim.max_tilt_per_frame : 7,
  };
}

/* render an effect's 41-channel source frame at time t. A beat-locked effect
   (beat:true) renders per frame against the real beat grid; a binding renders
   from its live stream value; anything else plays its fixed looped frames.
   Cached per frame so an effect driving 5 fixtures renders once, not 5×. */
function sourceFrame(res, cache) {
  if (cache.has(res)) return cache.get(res);
  let f;
  if (res.dmx.beat && typeof res.dmx.render === "function") f = res.dmx.render(beatCtx(res.startS, res.endS, res._t));
  else if (res.dmx.binding && typeof res.dmx.render === "function") f = res.dmx.render(res.valueAt(res._t), res._t);
  else f = frameAt(res.dmx, res._t - res.startS, res.endS - res.startS, bpm);
  cache.set(res, f);
  return f;
}

for (let t = 0; t < dur; t += 1 / fps) {
  const frame = new Array(TOTAL_CH).fill(0);
  const cache = new Map();

  for (const fid of fixtureIds) {
    const fc = fixtureChannels[fid];
    if (!fc) continue;
    const o = fc.offset, W = fc.width;
    const isHead = fc.panCh >= 0;

    /* base = the resting look for this fixture: an active binding, else the
       section state. It always sits under a gesture so a departure can return. */
    let base = null;
    for (const b of bindingResults) {
      if (t < b.startS || t >= b.endS || !b.dmx.per_fixture.includes(fid)) continue;
      b._t = t; base = sourceFrame(b, cache); break;
    }
    if (!base) {
      for (const s of stateResults) {
        if (t < s.startS || t >= s.endS || !s.dmx.per_fixture.includes(fid)) continue;
        s._t = t; base = sourceFrame(s, cache); break;
      }
    }

    /* gesture: among those covering this fixture now, the most recently STARTED
       one wins the overlap — a blackout placed at the drop supersedes the ramp
       that has been building into it, not whichever was declared first. */
    let g = null, gStart = -Infinity;
    for (const cand of gestureResults) {
      if (t < cand.startS || t >= cand.endS) continue;
      if (!cand.dmx.per_fixture.includes(fid)) continue;
      if (cand.startS >= gStart) { g = cand; gStart = cand.startS; }
    }
    let gsrc = null;
    if (g) { g._t = t; gsrc = sourceFrame(g, cache); }

    /* compose the gesture over the base */
    if (gsrc && REDUCTIVE.has(g.eid)) {
      for (let c = 0; c < W; c++) frame[o + c] = gsrc[o + c] || 0;                 // darken: replace the base
    } else if (gsrc && base && isHead) {
      for (let c = 0; c < W; c++) frame[o + c] = gsrc[o + c] || 0;                 // gesture drives the head move...
      if (fc.masterCh >= 0) frame[fc.masterCh] = Math.max(base[fc.masterCh] || 0, gsrc[fc.masterCh] || 0); // ...but never dimmer than the rest
    } else if (gsrc && base) {
      for (let c = 0; c < W; c++) frame[o + c] = Math.max(base[o + c] || 0, gsrc[o + c] || 0); // brighten over the wash, return to it as the envelope decays
    } else if (gsrc) {
      for (let c = 0; c < W; c++) frame[o + c] = gsrc[o + c] || 0;
    } else if (base) {
      for (let c = 0; c < W; c++) frame[o + c] = base[o + c] || 0;
    }
  }

  allFrames.push(frame);
}

/* ── head slew limit ──────────────────────────────────────────────────────
   The per-effect layers above are stateless and independent, so the head can
   jump at a seam (a gesture ending, a state resuming). A real moving head can
   only travel so far per frame; clamp pan/tilt change to the fixture profile's
   limit so the beam glides. Rig-general: any fixture whose profile declares a
   pan channel is limited by its own max_*_per_frame. Clamps the coarse channel
   only — these rigs hold pan_fine/tilt_fine at 0; a 16-bit head would want the
   combined value slewed (as readers/lights/wire.js does). */
const movers = fixtureIds.map(id => fixtureChannels[id]).filter(fc => fc && fc.panCh >= 0);
for (const fc of movers) {
  for (let i = 1; i < allFrames.length; i++) {
    const prev = allFrames[i - 1], cur = allFrames[i];
    cur[fc.panCh] = slew(prev[fc.panCh], cur[fc.panCh], fc.maxPan);
    if (fc.tiltCh >= 0) cur[fc.tiltCh] = slew(prev[fc.tiltCh], cur[fc.tiltCh], fc.maxTilt);
  }
}

/* ── output in the same format the player expects ─────────────────────────── */

function secondsAtBar(bar) { return S.secondsAt(bar, 1); }

const beats = [], downbeats = [];
for (let b = 1; b <= bars; b++) {
  for (let bt = 1; bt <= bpb; bt++) {
    const s = +S.secondsAt(b, bt).toFixed(3);
    beats.push(s);
    if (bt === 1) downbeats.push(s);
  }
}

const phases = sections.map(sec => ({
  start: +S.secondsAt(sec.from.bar, sec.from.beat || 1).toFixed(3),
  end: +S.secondsAt(sec.to.bar, sec.to.beat || 1).toFixed(3),
  phase: sec.name || null,
}));

const fixtures = layout.fixtures.map(f => ({
  id: f.id, type: f.type, address: f.address, at: f.at || [0, 0, 0],
}));

const show = {
  rig: rigName,
  layout: manifest.layout_file,
  channels: TOTAL_CH,
  fixtures,
  style: "limelight-v2",
  fps,
  duration: (score.song && score.song.length_s) || +dur.toFixed(3),
  tempo: bpm,
  /* the full beat grid, so a consumer (e.g. the editor UI) can place clips on
     the real clock without asking the hub. */
  grid: {
    bpm,
    beats_per_bar: bpb,
    first_beat_s: score.grid.first_beat_s,
    first_bar: score.grid.first_bar,
    bars,
    tempo: score.grid.tempo,
  },
  source: (score.score || "song") + ".wav",
  wav: (score.score || "song") + ".wav",
  beats,
  downbeats,
  sections: phases.map(x => x.start),
  phases,
  moments: moments.map(m => ({
    t: m.time_s || m.at_s || 0,
    bar: (m.at || {}).bar || 0,
    kind: m.type || "unknown",
    what: m.description || "",
    weight: m.intensity || 0,
  })),
  frames: allFrames,
  plan: {
    text: plan.plan || "",
    states: plan.states || [],
    bindings: plan.bindings || [],
    gestures: plan.gestures || [],
  },
};

fs.writeFileSync(lightsOut, JSON.stringify(show));
console.log(`baked ${allFrames.length} frames on ${rigName} (${fixtures.length} fixtures, ${TOTAL_CH}ch, plan: ${
  (plan.states || []).length}s/${(plan.bindings || []).length}b/${(plan.gestures || []).length}g) -> ${lightsOut}`);
