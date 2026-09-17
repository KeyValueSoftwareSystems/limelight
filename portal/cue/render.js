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
  const ids = (chase.on ? [].concat(chase.on) : ["lamps"])
    .reduce((acc, k) => acc.concat(E.expandTargets(rig, k)), []);
  if (!ids.length) return base;
  const figure = E.FIGURES[chase.figure] || E.FIGURES.alternate;
  const lit = new Set(figure(ids, step));
  const low = chase.low != null ? +chase.low : 0;
  const hiCol = E.parseColour(chase.c != null ? chase.c : chase.colour, palette);
  const out = {};
  for (const id of Object.keys(base)) out[id] = base[id];
  for (const id of ids) {
    const b = base[id] || { l: 0, c: [1, 1, 1] };
    const on = lit.has(id);
    out[id] = {
      l: on ? (chase.high != null ? +chase.high : b.l) : b.l * low,
      c: on && hiCol ? hiCol : b.c,
      pan: b.pan, tilt: b.tilt, strobe: b.strobe,
    };
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
      let step = 0;
      if (cue.chase) {
        const secs = E.chaseStepSeconds(cue.chase, grid);
        step = Math.floor((t - cue._t) / secs + 1e-9);
      }
      const changed = ci !== liveCue || step !== liveStep;
      if (changed) {
        const isCueChange = ci !== liveCue;
        const f = isCueChange
          ? (cue.fade != null ? +cue.fade : 0)
          : (cue.chase && cue.chase.fade != null ? +cue.chase.fade : 0);
        if (prevOut && f > 0) { fadeFrom = prevOut.slice(); fadeStart = t; fadeSecs = f; }
        else { fadeFrom = null; fadeSecs = 0; }
        liveCue = ci; liveStep = step;
      }
      const state = applyChase(rig, cue._look, cue.chase, step, palette);
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

  return { frames, fps, rig, grid, cues };
}

module.exports = { render, resolveLook, applyChase, blankFrame, writeFixture };
