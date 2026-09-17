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
const LIT_ROLE = /^(master|colour\.[a-z])$/;

if (!scoreFile || !planFile || !lightsOut) {
  console.error("usage: baker.js <score> <plan.json> --rig <rig> --lights <out>");
  process.exit(2);
}

/* ── load inputs ──────────────────────────────────────────────────────────── */

const { load } = require(path.join(LIGHTS, "fromscore.js"));
const { frameAt, slew, makeStreamSampler, bindingValueFn,
        makeBeatClock, makePerBeatWeight, makeEnergy,
        pickGesture, byLayer } = require("./bakelib.js");
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
/* creator-built effects (custom-effects.json) are PRESETS over a base primitive:
   they carry a `base` and a set of `dials`, but no DMX function of their own. Fold
   them into the catalogue so a plan can name one; the base fallback below gives it
   a renderer, and the resolvers seed its dials. Purely additive — an effect with no
   `base` behaves exactly as before. */
let customEffects = [];
try { customEffects = (JSON.parse(fs.readFileSync(path.join(HERE, "custom-effects.json"), "utf8")).effects) || []; }
catch (e) { customEffects = []; }
const catalogById = Object.fromEntries(catalog.concat(customEffects).map(e => [e.id, e]));

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
const SNAP = new Set(["impact", "stab", "bump", "blackout", "cut", "strobe", "accent", "flare"]);
const cueFadeMs = (layout.limits && layout.limits.cue_fade_ms != null) ? layout.limits.cue_fade_ms : 180;
const fadeFrom = {}, fadeLeft = {}, fadeSpan = {}, drivenBy = {}, lastOut = {};

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
/* a preset effect renders through its base primitive's DMX function */
for (const e of customEffects) {
  if (e.base && !dmxFunctions[e.id] && dmxFunctions[e.base]) dmxFunctions[e.id] = dmxFunctions[e.base];
}

/* ── resolve plan entries to timed spans ──────────────────────────────────── */

const moments = score.moments || [];

const beatTimesList = (score.beats || [])
  .map((b) => (b && b.t != null ? b.t : b))
  .filter((x) => typeof x === "number");

function secondAtBeat(i) {
  if (!beatTimesList.length) return 0;
  const step = 60 / bpm;
  if (i < 0) return beatTimesList[0] + i * step;
  if (i >= beatTimesList.length - 1)
    return beatTimesList[beatTimesList.length - 1] + (i - beatTimesList.length + 1) * step;
  const lo = Math.floor(i);
  const frac = i - lo;
  if (frac === 0) return beatTimesList[lo];
  return beatTimesList[lo] + (beatTimesList[lo + 1] - beatTimesList[lo]) * frac;
}

const barPhase = (() => {
  const flags = (score.beats || []).map((b, i) => (b && b.downbeat ? i : -1)).filter((i) => i >= 0);
  const per = (score.grid && score.grid.beats_per_bar) || 4;
  return flags.length ? ((flags[0] % per) + per) % per : 0;
})();

function beatIndexOfBar(bar, beat) {
  const per = (score.grid && score.grid.beats_per_bar) || 4;
  return barPhase + (Math.round(bar) - 1) * per + (Math.round(beat || 1) - 1);
}

function resolveGesture(g) {
  const eid = g.effect;
  const edef = catalogById[eid];
  if (!edef || !dmxFunctions[eid]) return null;

  let startS, endS;
  if (g.at_bar != null && isFinite(g.at_bar)) {
    const forBeats = g.for_beats || edef.default_beats || 1;
    const fire = beatIndexOfBar(g.at_bar, g.at_beat) - (g.lead_beats || 0);
    startS = secondAtBeat(fire);
    endS = secondAtBeat(fire + forBeats);
  } else if (g.from_bar != null && g.to_bar != null) {
    startS = secondAtBeat(beatIndexOfBar(g.from_bar, g.from_beat));
    endS = secondAtBeat(beatIndexOfBar(g.to_bar, g.to_beat));
  } else if (g.at_s != null) {
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

  /* Anchors are not dials. at_bar and friends were not in this list, so every
     bar-anchored gesture handed the effect an `at_bar` parameter it never asked
     for -- harmless so far, and exactly the kind of thing that later gets read
     by accident. */
  const SKIP = new Set(["effect", "moment", "from_moment", "to_moment", "lead_beats", "why",
                        "at_s", "from_s", "to_s", "at", "id",
                        "at_bar", "at_beat", "from_bar", "from_beat", "to_bar", "to_beat",
                        /* The lane is priority, not a dial. Everything not named
                           here is handed to the effect as a parameter it never
                           asked for. */
                        "layer"]);
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

  return { eid, startS: Math.max(0, startS), endS, params: resolvedParams, kind: "gesture",
           layer: g.layer };
}

/* A section's own seconds beat a bar label converted back into seconds.
   Expressing 0.00s as a bar lands on "bar 1 beat 2" = 2.43s, so re-deriving the
   boundary from the label moved the start of the show forward by two and a half
   seconds and nothing could be placed there. The response anchors every section
   in seconds; read those. */
const secStart = sec => (sec.from_s != null ? sec.from_s
                      : sec.start != null ? sec.start
                      : S.secondsAt(sec.from.bar, sec.from.beat || 1));
const secEnd = sec => (sec.to_s != null ? sec.to_s
                    : sec.end != null ? sec.end
                    : S.secondsAt(sec.to.bar, sec.to.beat || 1));

function resolveBinding(b) {
  const eid = b.effect;
  const edef = catalogById[eid];
  if (!edef || !dmxFunctions[eid]) return null;
  const secIdx = b.section;
  if (secIdx == null || secIdx < 0 || secIdx >= sections.length) return null;
  const sec = sections[secIdx];
  let startS = secStart(sec);
  let endS = secEnd(sec);

  /* A BINDING NARROWS ITSELF THE SAME WAY A STATE DOES.
     resolveState has always honoured from_s/to_s; this did not, so every
     binding silently spanned its whole song section no matter what it said. A
     bass follow written for the eight bars of the riff (41.8-51.8s) actually
     rendered across the entire chorus to 81.8s and held the room at one percent
     through the biggest thirty seconds of the record; a 0.12s accent spanned
     nineteen seconds. Nothing reported it, because the cue was doing exactly
     what it was asked -- over a span nobody had asked for. */
  if (b.from_bar != null && isFinite(b.from_bar)) {
    const a = secondAtBeat(beatIndexOfBar(b.from_bar, b.from_beat));
    if (isFinite(a)) startS = Math.max(startS, a);
  }
  if (b.to_bar != null && isFinite(b.to_bar)) {
    const a = secondAtBeat(beatIndexOfBar(b.to_bar, b.to_beat));
    if (isFinite(a)) endS = Math.min(endS, a);
  }
  if (b.from_s != null && isFinite(b.from_s)) startS = Math.max(startS, b.from_s);
  if (b.to_s != null && isFinite(b.to_s)) endS = Math.min(endS, b.to_s);
  if (!(endS > startS)) return null;

  const params = edef.base ? { ...(edef.dials || {}) } : {};
  for (const [k, v] of Object.entries(b)) {
    if (k !== "effect" && k !== "section" && k !== "why" && k !== "layer" &&
        k !== "from_bar" && k !== "to_bar" && k !== "from_beat" && k !== "to_beat" &&
        k !== "from_s" && k !== "to_s") {
      params[k] = typeof v === "object" && v !== null && v.default !== undefined ? v.default : v;
    }
  }
  return { eid, startS, endS, params, kind: "binding", streams: b.streams || b.stream,
           layer: b.layer };
}

function resolveState(s) {
  const eid = s.effect;
  const edef = catalogById[eid];
  if (!edef || !dmxFunctions[eid]) return null;
  const secIdx = s.section;
  if (secIdx == null || secIdx < 0 || secIdx >= sections.length) return null;
  const sec = sections[secIdx];
  let startS = secStart(sec);
  let endS = secEnd(sec);

  if (s.from_bar != null && isFinite(s.from_bar)) {
    const a = secondAtBeat(beatIndexOfBar(s.from_bar, s.from_beat));
    if (isFinite(a)) startS = Math.max(startS, a);
  }
  if (s.to_bar != null && isFinite(s.to_bar)) {
    const a = secondAtBeat(beatIndexOfBar(s.to_bar, s.to_beat));
    if (isFinite(a)) endS = Math.min(endS, a);
  }
  if (s.from_s != null && isFinite(s.from_s)) startS = Math.max(startS, s.from_s);
  if (s.to_s != null && isFinite(s.to_s)) endS = Math.min(endS, s.to_s);
  if (!(endS > startS)) return null;

  const params = edef.base ? { ...(edef.dials || {}) } : {};
  for (const [k, v] of Object.entries(s)) {
    if (k !== "effect" && k !== "section" && k !== "why" && k !== "layer" &&
        k !== "from_bar" && k !== "to_bar" && k !== "from_beat" && k !== "to_beat" &&
        k !== "from_s" && k !== "to_s") {
      params[k] = typeof v === "object" && v !== null && v.default !== undefined ? v.default : v;
    }
  }
  return { eid, startS, endS, params, kind: "state", layer: s.layer };
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
  /* A venue's effects and its manifest have to agree on how wide a frame is.
     keycode-arena shipped as a copy of club16-2head, so its helpers built
     138-channel frames for a rig the manifest declares at 488: every cue landed
     outside the real fixtures and the room baked perfectly black, with nothing
     anywhere saying why. A silent blackout is the worst failure this baker has,
     so it is an error now rather than an empty show. */
  const width = result && result.frames && result.frames[0] && result.frames[0].length;
  if (width && width !== TOTAL_CH) {
    console.error(
      `${rigName}/${entry.eid}.js returns ${width}-channel frames but ` +
      `${rigName}/manifest.json declares total_channels ${TOTAL_CH}. ` +
      `Every cue from this venue would address the wrong channels and the show ` +
      `would bake black. Fix TOTAL_CH in ${rigName}/helpers.js, or the manifest.`,
    );
    process.exit(3);
  }
  return result;
}

/* ── bake: compose layers per frame ───────────────────────────────────────── */

/* Sorted by lane, because the base loops below take the FIRST binding (else the
   first state) covering a fixture and stop — so lane order IS resolution order
   for the bed. The editor already emits them sorted; doing it here too means a
   plan written by hand resolves the way its lanes say rather than the way its
   array happens to be ordered. With no lanes it is a stable no-op. */
const stateResults = byLayer(resolvedStates).map(s => ({ ...s, dmx: generateFrames(s) })).filter(r => r.dmx);
const bindingResults = byLayer(resolvedBindings).map(b => ({ ...b, dmx: generateFrames(b) })).filter(r => r.dmx);
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
  const resp = prof.response || {};
  const perFrame = (ms) => (ms > 0 ? Math.max(1, Math.round(255 / ((ms / 1000) * fps))) : 0);
  const lim = prof.limits || {};
  fixtureChannels[f.id] = {
    offset, width: prof.footprint,
    panCh:  panIdx  >= 0 ? offset + panIdx  : -1,   // for the head slew limit
    tiltCh: tiltIdx >= 0 ? offset + tiltIdx : -1,
    masterCh: masterIdx >= 0 ? offset + masterIdx : -1,   // for head brighten-compositing
    maxPan:  lim.max_pan_per_frame  > 0 ? lim.max_pan_per_frame  : 7,
    maxTilt: lim.max_tilt_per_frame > 0 ? lim.max_tilt_per_frame : 7,
    lightChs: roles.map((r, i) => (LIT_ROLE.test(r) ? offset + i : -1)).filter((i) => i >= 0),
    maxRise: perFrame(resp.rise_ms),
    maxFall: perFrame(resp.fall_ms),
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
  else if (res.dmx.binding && typeof res.dmx.render === "function")
    /* A binding-style effect placed as a GESTURE has no stream to follow, so it
       renders at full value. Without this the baker threw on res.valueAt being
       undefined, which is why fifteen effects that exist in every venue --
       chase, ripple, bounce, sweep, converge and the rest -- could only ever be
       used as bindings and were left out of the catalogue entirely. */
    f = res.dmx.render(typeof res.valueAt === "function" ? res.valueAt(res._t) : 1, res._t);
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
    const wasDriven = drivenBy[fid];

    /* base = the resting look for this fixture: an active binding, else the
       section state. It always sits under a gesture so a departure can return. */
    let base = null, baseRes = null;
    for (const b of bindingResults) {
      if (t < b.startS || t >= b.endS || !b.dmx.per_fixture.includes(fid)) continue;
      b._t = t; base = sourceFrame(b, cache); baseRes = b; break;
    }
    if (!base) {
      for (const s of stateResults) {
        if (t < s.startS || t >= s.endS || !s.dmx.per_fixture.includes(fid)) continue;
        s._t = t; base = sourceFrame(s, cache); baseRes = s; break;
      }
    }

    /* gesture: among those covering this fixture now, the TOP LANE wins, and
       within a lane the most recently STARTED one — a blackout placed at the
       drop supersedes the ramp that has been building into it, not whichever
       was declared first. See pickGesture in bakelib.js. */
    const covering = [];
    for (const cand of gestureResults) {
      if (t < cand.startS || t >= cand.endS) continue;
      if (!cand.dmx.per_fixture.includes(fid)) continue;
      covering.push(cand);
    }
    const g = pickGesture(covering);
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

    const nowDriven = (baseRes ? baseRes.eid + "@" + baseRes.startS : "-") + "/" + (g ? g.eid + "@" + g.startS : "-");
    if (wasDriven !== undefined && nowDriven !== wasDriven && lastOut[fid]) {
      const snap = g && SNAP.has(g.eid) && g.startS >= t - 1 / fps;
      const ms = snap ? 0
        : ((g && g.params && g.params.fade_ms != null) ? g.params.fade_ms
          : (baseRes && baseRes.params && baseRes.params.fade_ms != null) ? baseRes.params.fade_ms : cueFadeMs);
      const n = Math.round((ms / 1000) * fps);
      if (n > 0) { fadeFrom[fid] = lastOut[fid].slice(); fadeLeft[fid] = n; fadeSpan[fid] = n; }
      /* A cue that asks for NO fade arrives now, whatever was mid-fade before
         it. Without this a hit landing three frames after a blackout ended was
         blended into the tail of the bed's 180ms fade-up and came in as a
         six-frame ramp -- the loudest arrival in the first half of the song
         reading as a slow swell. */
      else fadeLeft[fid] = 0;
    }
    drivenBy[fid] = nowDriven;

    if (fadeLeft[fid] > 0) {
      const p = 1 - fadeLeft[fid] / (fadeSpan[fid] + 1);
      const from = fadeFrom[fid];
      for (let c = 0; c < W; c++) {
        if (c === fc.panCh - o || c === fc.tiltCh - o) continue;
        frame[o + c] = Math.round(from[c] * (1 - p) + frame[o + c] * p);
      }
      fadeLeft[fid]--;
    }
    lastOut[fid] = frame.slice(o, o + W);
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

for (const fc of fixtureIds.map((id) => fixtureChannels[id])) {
  if (!fc || (!fc.maxFall && !fc.maxRise)) continue;
  for (let i = 1; i < allFrames.length; i++) {
    const prev = allFrames[i - 1], cur = allFrames[i];
    for (const ch of fc.lightChs) {
      if (cur[ch] < prev[ch] && fc.maxFall) cur[ch] = Math.max(cur[ch], prev[ch] - fc.maxFall);
      else if (cur[ch] > prev[ch] && fc.maxRise) cur[ch] = Math.min(cur[ch], prev[ch] + fc.maxRise);
    }
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
