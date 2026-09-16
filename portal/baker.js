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
const { frameAt, slew, makeStreamSampler, bindingValueFn } = require("./bakelib.js");
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

/* gestures that REDUCE light replace the layer under them (they darken); every
   other gesture is a departure that brightens and must RETURN to the resting
   look, so it composites OVER the state/binding by max rather than blacking it
   out when its envelope decays. */
const beatTimes = (score.beats || [])
  .map((b) => (b && b.t != null ? b.t : b))
  .filter((x) => typeof x === "number");

function nearestBeat(t) {
  if (!beatTimes.length) return 0;
  let lo = 0, hi = beatTimes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beatTimes[mid] < t) lo = mid + 1; else hi = mid;
  }
  const prev = Math.max(0, lo - 1);
  return Math.abs(beatTimes[prev] - t) <= Math.abs(beatTimes[lo] - t) ? prev : lo;
}

function beatSecond(i) {
  if (!beatTimes.length) return 0;
  const step = 60 / bpm;
  if (i < 0) return beatTimes[0] + i * step;
  if (i >= beatTimes.length)
    return beatTimes[beatTimes.length - 1] + (i - beatTimes.length + 1) * step;
  return beatTimes[i];
}

const REDUCTIVE = new Set(["blackout", "cut", "hush", "strip", "isolate"]);

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
  if (g.moment != null && g.moment >= 0 && g.moment < moments.length) {
    const m = moments[g.moment];
    const leadBeats = g.lead_beats || 0;
    const forBeats = g.for_beats || edef.default_beats || 1;
    const fire = nearestBeat(m.time_s || m.at_s || 0) - leadBeats;
    startS = beatSecond(fire);
    endS = beatSecond(fire + forBeats);
  } else if (g.from_moment != null && g.to_moment != null) {
    const fm = moments[g.from_moment];
    const tm = moments[g.to_moment];
    if (!fm || !tm) return null;
    startS = beatSecond(nearestBeat(fm.time_s || fm.at_s || 0));
    endS = beatSecond(nearestBeat(tm.time_s || tm.at_s || 0));
  } else {
    return null;
  }

  const params = { ...edef.dials };
  for (const [k, v] of Object.entries(g)) {
    if (k !== "effect" && k !== "moment" && k !== "from_moment" && k !== "to_moment" &&
        k !== "lead_beats" && k !== "why") {
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
  return { eid, startS, endS, params, kind: "binding", section: secIdx, streams: b.streams || b.stream };
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
/* A section change is a change of look, not a cut; a hit is a cut and must
   stay one. States and bindings cross over STATE_FADE, gestures over a sixth of
   a second, and the six that are meant to be instant are exempt. */
const STATE_FADE = 1.1;
const GESTURE_FADE = 0.18;
const INSTANT = new Set(["impact", "blackout", "cut", "stab", "strobe", "flare", "bump"]);
function ease(x) {
  const u = Math.max(0, Math.min(1, x));
  return u * u * (3 - 2 * u);
}
function mixFrames(from, to, k, offset, width) {
  const out = to.slice();
  for (let c = 0; c < width; c++) {
    const at = offset + c;
    out[at] = Math.max(0, Math.min(255,
      Math.round((from[at] || 0) + ((to[at] || 0) - (from[at] || 0)) * k)));
  }
  return out;
}

/* The venue forbids the head throwing light into certain pan angles, and
   server.py enforces it by forcing the head's dimmer to zero inside a zone. A
   show that aims there is a show with a dark head, which is what was on screen:
   follow's sweep reached pan DMX 111 - -123 degrees, inside the -150..-110
   keep-out - so the head went black for part of every cycle. The clamp stays as
   the backstop; the show simply stops pointing at the bar. */
const PAN_WALL_CENTRE = 169, PAN_DEG_PER_DMX = 540 / 255;
const keepOut = (() => {
  try {
    const lim = JSON.parse(fs.readFileSync(path.join(HERE, "limits.json"), "utf8"));
    return (lim.keep_out || []).map(z => {
      const a = PAN_WALL_CENTRE + (z.pan_from_deg || 0) / PAN_DEG_PER_DMX;
      const b = PAN_WALL_CENTRE + (z.pan_to_deg || 0) / PAN_DEG_PER_DMX;
      return [Math.min(a, b), Math.max(a, b)];
    });
  } catch (e) { return []; }
})();
function safePan(dmx) {
  let v = dmx;
  for (const [a, b] of keepOut) {
    if (v > a && v < b) v = (v - a < b - v) ? Math.floor(a) - 2 : Math.ceil(b) + 2;
  }
  return Math.max(0, Math.min(255, v));
}

const resolvedBindings = (plan.bindings || []).map(resolveBinding).filter(Boolean);
const resolvedStates   = (plan.states || []).map(resolveState).filter(Boolean);

/* each binding gets a per-frame value function of the right shape for its
   render() — a scalar for follow, an onset scalar for accent, a [left,right]
   pair for split. */
resolvedBindings.forEach(b => { b.valueAt = bindingValueFn(b, sampler); });

/* ── generate DMX frames for each resolved entry ─────────────────────────── */

function stateColourFor(secIdx) {
  for (const s of plan.states || []) {
    if (s.section === secIdx && s.colour) return s.colour;
  }
  return null;
}

function generateFrames(entry) {
  const fn = dmxFunctions[entry.eid];
  if (!fn) return null;
  const ctx = { fps, bpm, layout, restColour: entry.restColour || null };
  const result = fn(entry.params, ctx);
  return result;
}

/* ── bake: compose layers per frame ───────────────────────────────────────── */

const stateResults = resolvedStates.map(s => ({ ...s, dmx: generateFrames(s) })).filter(r => r.dmx);
const bindingResults = resolvedBindings
  .map(b => ({ ...b, restColour: stateColourFor(b.section) }))
  .map(b => ({ ...b, dmx: generateFrames(b) })).filter(r => r.dmx);
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
  const wheelIdx = roles.indexOf("colour_wheel") >= 0 ? roles.indexOf("colour_wheel") : roles.indexOf("colour");
  const goboIdx = roles.indexOf("gobo"), prismIdx = roles.indexOf("prism");
  const lim = prof.limits || {};
  fixtureChannels[f.id] = {
    offset, width: prof.footprint,
    panCh:  panIdx  >= 0 ? offset + panIdx  : -1,   // for the head slew limit
    tiltCh: tiltIdx >= 0 ? offset + tiltIdx : -1,
    masterCh: masterIdx >= 0 ? offset + masterIdx : -1,   // for head brighten-compositing
    maxPan:  lim.max_pan_per_frame  > 0 ? lim.max_pan_per_frame  : 7,
    maxTilt: lim.max_tilt_per_frame > 0 ? lim.max_tilt_per_frame : 7,
    wheelCh: wheelIdx >= 0 ? offset + wheelIdx : -1,
    goboCh:  goboIdx  >= 0 ? offset + goboIdx  : -1,
    prismCh: prismIdx >= 0 ? offset + prismIdx : -1,
    wheelHold: lim.wheel_settle_s > 0 ? lim.wheel_settle_s : 0.22,
  };
}

for (let t = 0; t < dur; t += 1 / fps) {
  const frame = new Array(TOTAL_CH).fill(0);

  for (const fid of fixtureIds) {
    const fc = fixtureChannels[fid];
    if (!fc) continue;
    const o = fc.offset, W = fc.width;
    const isHead = fc.panCh >= 0;

    /* base = the resting look for this fixture: an active binding, else the
       section state (looped so it animates). It always sits under a gesture so
       a departure has something to return to. */
    /* A rig layers. A designer has the wash follow the voice AND the pars answer
       the kick, and taking only the first binding per fixture made those two
       mutually exclusive - which is why a composer given three bindings could
       only ever spend one on a section. Every binding covering this fixture now
       contributes, brightest-wins per channel, so a bed and its accents live
       together the way they do on a real desk. */
    let base = null, bindStart = null;
    for (const b of bindingResults) {
      if (t < b.startS || t >= b.endS) continue;
      if (!b.dmx.per_fixture.includes(fid)) continue;
      const one = (b.dmx.binding && typeof b.dmx.render === "function")
        ? b.dmx.render(b.valueAt(t), t)
        : frameAt(b.dmx, t - b.startS, b.endS - b.startS, bpm);
      if (!base) {
        base = one.slice();
        bindStart = b.startS;
      } else {
        for (let c = 0; c < W; c++) {
          const at = o + c;
          base[at] = Math.max(base[at] || 0, one[at] || 0);
        }
        bindStart = Math.max(bindStart, b.startS);
      }
    }
    if (!base) {
      for (let si = 0; si < stateResults.length; si++) {
        const s = stateResults[si];
        if (t < s.startS || t >= s.endS) continue;
        if (!s.dmx.per_fixture.includes(fid)) continue;
        base = frameAt(s.dmx, t - s.startS, s.endS - s.startS, bpm);
        /* A section change is a change of look, not a cut. Holding the previous
           state under the new one for a beat and crossing between them is what a
           person does on a fader; snapping is what a bug does, and on
           raga-of-revenge the pars jumped 101 to 179 in a single frame at 25.4s. */
        const into = t - s.startS;
        if (into < STATE_FADE && si > 0) {
          const prev = stateResults[si - 1];
          if (prev && prev.dmx.per_fixture.includes(fid)) {
            const was = frameAt(prev.dmx, Math.max(0, s.startS - prev.startS),
                                prev.endS - prev.startS, bpm);
            base = mixFrames(was, base, ease(into / STATE_FADE), o, W);
          }
        }
        break;
      }
    }

    /* A binding takes over from the section's resting look, and taking over is
       still a change of look. Without this the rig jumped at 47.8s and 81.3s,
       where a split binding starts, for no reason an audience could hear. */
    if (base && bindStart != null && t - bindStart < STATE_FADE) {
      for (const st of stateResults) {
        if (bindStart < st.startS || bindStart >= st.endS) continue;
        if (!st.dmx.per_fixture.includes(fid)) continue;
        const was = frameAt(st.dmx, bindStart - st.startS,
                            st.endS - st.startS, bpm);
        base = mixFrames(was, base, ease((t - bindStart) / STATE_FADE), o, W);
        break;
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
    let gsrc = g ? frameAt(g.dmx, t - g.startS, g.endS - g.startS, bpm) : null;
    /* A hit is meant to be instant; a sweep, a lift, a tint are not, and they
       were snapping on because a gesture simply replaced the base on its first
       frame. On raga-of-revenge the head jumped 50 to 179 in a single frame at
       22.1s when the sweep began. Everything that is not a hit now crosses in
       and out over a sixth of a second. */
    if (gsrc && base && !INSTANT.has(g.eid)) {
      const inK = ease((t - g.startS) / GESTURE_FADE);
      const outK = ease((g.endS - t) / GESTURE_FADE);
      const k = Math.min(inK, outK);
      if (k < 0.999) gsrc = mixFrames(base, gsrc, k, o, W);
    }

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
  for (let i = 0; i < allFrames.length; i++) {
    allFrames[i][fc.panCh] = safePan(allFrames[i][fc.panCh]);
  }
  for (let i = 1; i < allFrames.length; i++) {
    const prev = allFrames[i - 1], cur = allFrames[i];
    cur[fc.panCh] = safePan(slew(prev[fc.panCh], cur[fc.panCh], fc.maxPan));
    if (fc.tiltCh >= 0) cur[fc.tiltCh] = slew(prev[fc.tiltCh], cur[fc.tiltCh], fc.maxTilt);
  }
  /* Pan and tilt are motors and were already slewed; a colour wheel, a gobo
     wheel and a prism are motors too and were not. The show asked this head to
     change colour 242 times in 131 seconds, 188 of them closer together than
     0.2s, which no wheel can do - it would blur or simply not arrive. Each
     holds its position for wheelHold before it may move again, so what the
     screen shows is what the fixture could actually produce. */
  for (const key of ["wheelCh", "goboCh", "prismCh"]) {
    const ch = fc[key];
    if (ch < 0) continue;
    const hold = Math.max(1, Math.round((fc.wheelHold || 0.22) * fps));
    let settled = allFrames.length ? allFrames[0][ch] : 0;
    let since = hold;
    for (let i = 0; i < allFrames.length; i++) {
      if (allFrames[i][ch] !== settled && since >= hold) {
        settled = allFrames[i][ch];
        since = 0;
      }
      allFrames[i][ch] = settled;
      since++;
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
