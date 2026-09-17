"use strict";
const E = require("./engine.js");

function blankFrame(rig) {
  const f = new Array(rig.channels).fill(0);
  for (const fx of rig.fixtures) {
    for (let c = 0; c < fx.width; c++) f[fx.offset + c] = fx.defaults[c] || 0;
  }
  return f;
}

function writeFixture(frame, fx, state) {
  const level = Math.max(0, Math.min(1, state.l == null ? 0 : state.l));
  const col = state.c || [1, 1, 1];
  const ch = fx.ch;
  if (fx.brightness === "colour") {
    if (ch.master >= 0) frame[fx.offset + ch.master] = 255;
    if (ch.r >= 0) frame[fx.offset + ch.r] = Math.round(col[0] * level * 255);
    if (ch.g >= 0) frame[fx.offset + ch.g] = Math.round(col[1] * level * 255);
    if (ch.b >= 0) frame[fx.offset + ch.b] = Math.round(col[2] * level * 255);
  } else {
    if (ch.master >= 0) frame[fx.offset + ch.master] = Math.round(level * 255);
    if (ch.r >= 0) frame[fx.offset + ch.r] = Math.round(col[0] * 255);
    if (ch.g >= 0) frame[fx.offset + ch.g] = Math.round(col[1] * 255);
    if (ch.b >= 0) frame[fx.offset + ch.b] = Math.round(col[2] * 255);
  }
  if (ch.w >= 0) frame[fx.offset + ch.w] = 0;
  if (ch.pan >= 0 && state.pan != null) frame[fx.offset + ch.pan] = Math.round(Math.max(0, Math.min(1, state.pan)) * 255);
  if (ch.tilt >= 0 && state.tilt != null) frame[fx.offset + ch.tilt] = Math.round(Math.max(0, Math.min(1, state.tilt)) * 255);
  if (ch.strobe >= 0) frame[fx.offset + ch.strobe] = state.strobe ? Math.round(Math.max(0, Math.min(1, state.strobe)) * 255) : 0;
}

function resolveLook(rig, look, palette) {
  const out = {};
  for (const fx of rig.fixtures) out[fx.id] = { l: 0, c: [1, 1, 1] };
  for (const key of Object.keys(look || {})) {
    const spec = look[key] || {};
    const ids = E.expandTargets(rig, key);
    for (const id of ids) {
      const prev = out[id] || { l: 0, c: [1, 1, 1] };
      const col = E.parseColour(spec.c != null ? spec.c : spec.colour, palette);
      out[id] = {
        l: spec.l != null ? +spec.l : (spec.level != null ? +spec.level : prev.l),
        c: col || prev.c,
        pan: spec.pan != null ? +spec.pan : prev.pan,
        tilt: spec.tilt != null ? +spec.tilt : prev.tilt,
        strobe: spec.strobe != null ? +spec.strobe : prev.strobe,
      };
    }
  }
  return out;
}

function applyChase(rig, base, chase, step, palette) {
  if (!chase) return base;
  let ids = (chase.on ? [].concat(chase.on) : ["lamps"])
    .reduce((acc, k) => acc.concat(E.expandTargets(rig, k)), []);
  if (!ids.length) return base;
  if (chase.reverse) ids = ids.slice().reverse();
  const figure = E.FIGURES[chase.figure] || E.FIGURES.alternate;
  const res = figure(ids, step);
  const weights = {};
  if (Array.isArray(res)) {
    const lit = new Set(res);
    for (const id of ids) weights[id] = lit.has(id) ? 1 : 0;
  } else {
    for (const id of ids) weights[id] = res[id] != null ? +res[id] : 0;
  }
  const low = chase.low != null ? +chase.low : 0;
  const hiCol = E.parseColour(chase.c != null ? chase.c : chase.colour, palette);
  const ring = Array.isArray(chase.colours)
    ? chase.colours.map((c) => E.parseColour(c, palette)).filter(Boolean) : null;
  const out = {};
  for (const id of Object.keys(base)) out[id] = base[id];
  ids.forEach((id, i) => {
    const b = base[id] || { l: 0, c: [1, 1, 1] };
    const w = weights[id];
    const top = chase.high != null ? +chase.high : b.l;
    out[id] = {
      l: b.l * low + (top - b.l * low) * Math.max(0, Math.min(1, w)),
      c: ring ? ring[(i + step) % ring.length] : (w > 0.5 && hiCol ? hiCol : b.c),
      pan: b.pan, tilt: b.tilt, strobe: b.strobe,
    };
  });
  if (chase.move_head) {
    const lampIds = rig.lamps.map((f) => f.id);
    let bestId = null, bestW = -1;
    for (const id of lampIds) if (weights[id] != null && weights[id] > bestW) { bestW = weights[id]; bestId = id; }
    const lamp = rig.lamps.find((f) => f.id === bestId);
    if (lamp) {
      const xs = rig.lamps.map((f) => f.x);
      const lo = Math.min(...xs), hi = Math.max(...xs);
      const pan = hi > lo ? 0.5 + 0.42 * ((lamp.x - lo) / (hi - lo) - 0.5) * 2 : 0.5;
      for (const h of rig.movers) {
        const hb = out[h.id] || { l: 0, c: [1, 1, 1] };
        out[h.id] = { ...hb, pan: Math.max(0, Math.min(1, pan)) };
      }
    }
  }
  return out;
}

function render(cueFile, score, rigName, opts) {
  const o = opts || {};
  const fps = o.fps || 40;
  const rig = E.loadRig(rigName || cueFile.rig || "arc4-head");
  const grid = E.makeGrid(score);
  const palette = cueFile.palette || {};
  const duration = o.duration || (score.song && score.song.length_s) || 0;

  const cues = (cueFile.cues || [])
    .map((c, i) => ({ ...c, _i: i, _t: E.cueSeconds(c, grid) }))
    .sort((a, b) => a._t - b._t || a._i - b._i);
  for (let i = 0; i < cues.length; i++) {
    cues[i]._end = i + 1 < cues.length ? cues[i + 1]._t : duration;
    cues[i]._look = resolveLook(rig, cues[i].look, palette);
    const layers = cues[i].chases || (cues[i].chase ? [cues[i].chase] : []);
    cues[i]._layers = layers;
    cues[i]._steps = layers.map((ch) => E.chaseStepTimes(ch, grid, cues[i]._t, cues[i]._end));
  }

  const total = Math.max(1, Math.round(duration * fps));
  const frames = [];
  let prevOut = null;
  let fadeFrom = null, fadeStart = 0, fadeSecs = 0;
  let liveCue = -1, liveStep = -1;

  for (let i = 0; i < total; i++) {
    const t = i / fps;
    let ci = -1;
    for (let k = cues.length - 1; k >= 0; k--) if (t >= cues[k]._t) { ci = k; break; }

    const frame = blankFrame(rig);
    if (ci >= 0) {
      const cue = cues[ci];
      const steps = cue._steps.map((list) => {
        let k = 0;
        while (k + 1 < list.length && list[k + 1] <= t + 1e-9) k++;
        return k;
      });
      const stepKey = steps.join(",");
      const changed = ci !== liveCue || stepKey !== liveStep;
      if (changed) {
        const isCueChange = ci !== liveCue;
        const f = isCueChange
          ? (cue.fade != null ? +cue.fade : 0)
          : (cue._layers[0] && cue._layers[0].fade != null ? +cue._layers[0].fade : 0.06);
        if (prevOut && f > 0) { fadeFrom = prevOut.slice(); fadeStart = t; fadeSecs = f; }
        else { fadeFrom = null; fadeSecs = 0; }
        liveCue = ci; liveStep = stepKey;
      }
      let state = cue._look;
      cue._layers.forEach((ch, li) => { state = applyChase(rig, state, ch, steps[li], palette); });
      if (cue.swell) {
        const span = Math.max(1e-6, cue._end - cue._t);
        const p = Math.max(0, Math.min(1, (t - cue._t) / span));
        const a = cue.swell.from != null ? +cue.swell.from : 1;
        const b = cue.swell.to != null ? +cue.swell.to : 1;
        const g = a + (b - a) * Math.pow(p, cue.swell.curve != null ? +cue.swell.curve : 1);
        const scaled = {};
        for (const id of Object.keys(state)) scaled[id] = { ...state[id], l: state[id].l * g };
        state = scaled;
      }
      for (const fx of rig.fixtures) writeFixture(frame, fx, state[fx.id] || { l: 0 });
    }

    if (fadeFrom && fadeSecs > 0) {
      const p = Math.min(1, (t - fadeStart) / fadeSecs);
      for (let c = 0; c < frame.length; c++) {
        frame[c] = Math.round(fadeFrom[c] * (1 - p) + frame[c] * p);
      }
      if (p >= 1) { fadeFrom = null; fadeSecs = 0; }
    }

    for (const fx of rig.movers) {
      if (!prevOut) break;
      const lim = rig.limits || {};
      const maxPan = lim.max_pan_per_frame > 0 ? lim.max_pan_per_frame : 7;
      const maxTilt = lim.max_tilt_per_frame > 0 ? lim.max_tilt_per_frame : 7;
      if (fx.ch.pan >= 0) {
        const c = fx.offset + fx.ch.pan, d = frame[c] - prevOut[c];
        if (d > maxPan) frame[c] = prevOut[c] + maxPan;
        else if (d < -maxPan) frame[c] = prevOut[c] - maxPan;
      }
      if (fx.ch.tilt >= 0) {
        const c = fx.offset + fx.ch.tilt, d = frame[c] - prevOut[c];
        if (d > maxTilt) frame[c] = prevOut[c] + maxTilt;
        else if (d < -maxTilt) frame[c] = prevOut[c] - maxTilt;
      }
    }

    prevOut = frame;
    frames.push(frame);
  }

  for (const acc of cueFile.accents || []) {
    const ta = +acc.t;
    if (!(ta >= 0)) continue;
    const decay = acc.decay != null ? +acc.decay : 0.22;
    const lvl = acc.l != null ? +acc.l : 1;
    const col = E.parseColour(acc.c, palette) || [1, 1, 1];
    const ids = (acc.on ? [].concat(acc.on) : ["lamps"])
      .reduce((a, k) => a.concat(E.expandTargets(rig, k)), []);
    const i0 = Math.round(ta * fps), i1 = Math.min(frames.length, Math.round((ta + decay) * fps) + 1);
    for (let i = Math.max(0, i0); i < i1; i++) {
      const w = Math.pow(1 - (i - i0) / Math.max(1, i1 - i0), 2);
      for (const id of ids) {
        const fx = rig.fixtures.find((f) => f.id === id);
        if (!fx) continue;
        const ch = fx.ch;
        const amp = lvl * w;
        if (fx.brightness === "colour") {
          if (ch.r >= 0) frames[i][fx.offset + ch.r] = Math.max(frames[i][fx.offset + ch.r], Math.round(col[0] * amp * 255));
          if (ch.g >= 0) frames[i][fx.offset + ch.g] = Math.max(frames[i][fx.offset + ch.g], Math.round(col[1] * amp * 255));
          if (ch.b >= 0) frames[i][fx.offset + ch.b] = Math.max(frames[i][fx.offset + ch.b], Math.round(col[2] * amp * 255));
        } else if (ch.master >= 0) {
          frames[i][fx.offset + ch.master] = Math.max(frames[i][fx.offset + ch.master], Math.round(amp * 255));
        }
      }
    }
  }

  return { frames, fps, rig, grid, cues };
}

module.exports = { render, resolveLook, applyChase, blankFrame, writeFixture };
