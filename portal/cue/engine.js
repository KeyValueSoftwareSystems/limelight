"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const LIGHTS = path.join(ROOT, "readers", "lights");

function loadRig(rigName) {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(ROOT, "portal", "venues", rigName, "manifest.json"), "utf8"));
  const layout = JSON.parse(fs.readFileSync(
    path.join(LIGHTS, manifest.layout_file), "utf8"));
  const fixtures = layout.fixtures.map((f) => {
    const prof = JSON.parse(fs.readFileSync(
      path.join(LIGHTS, "drivers", "profiles", f.type + ".profile.json"), "utf8"));
    const roles = (prof.channels || []).map((c) => c.role);
    const at = f.at || [0, 0, 0];
    return {
      id: f.id, type: f.type, address: f.address, at,
      x: at[0], offset: f.address - 1, width: prof.footprint,
      brightness: prof.brightness || "master",
      ch: {
        master: roles.indexOf("master"),
        r: roles.indexOf("colour.r"), g: roles.indexOf("colour.g"), b: roles.indexOf("colour.b"),
        w: roles.indexOf("colour.w"),
        pan: roles.indexOf("pan"), tilt: roles.indexOf("tilt"), strobe: roles.indexOf("strobe"),
      },
      movable: roles.indexOf("pan") >= 0,
      defaults: (prof.channels || []).map((c) => c.default || 0),
    };
  });
  const lamps = fixtures.filter((f) => !f.movable).sort((a, b) => a.x - b.x);
  const movers = fixtures.filter((f) => f.movable);
  return {
    name: rigName, channels: manifest.total_channels, layoutFile: manifest.layout_file,
    fixtures, lamps, movers,
    limits: layout.limits || {},
  };
}

function groupsFor(rig) {
  const L = rig.lamps.map((f) => f.id);
  const n = L.length;
  const half = Math.floor(n / 2);
  const mid = n % 2 ? [L[(n - 1) / 2]] : L.slice(n / 2 - 1, n / 2 + 1);
  return {
    all: L.concat(rig.movers.map((f) => f.id)),
    lamps: L,
    left: L.slice(0, half),
    right: L.slice(n - half),
    ends: n >= 2 ? [L[0], L[n - 1]] : L.slice(),
    outer: n >= 2 ? [L[0], L[n - 1]] : L.slice(),
    inner: n > 2 ? L.slice(1, n - 1) : L.slice(),
    centre: mid,
    heads: rig.movers.map((f) => f.id),
  };
}

function expandTargets(rig, key) {
  const g = groupsFor(rig);
  if (Object.prototype.hasOwnProperty.call(g, key)) return g[key];
  if (rig.fixtures.some((f) => f.id === key)) return [key];
  return [];
}

function parseColour(value, palette) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.slice(0, 3).map((v) => Math.max(0, Math.min(1, +v)));
  let v = String(value).trim();
  if (palette && Object.prototype.hasOwnProperty.call(palette, v)) v = String(palette[v]).trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(v);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function makeGrid(score) {
  const beats = (score.beats || []).map((b) => b.t);
  const perBar = (score.grid && score.grid.beats_per_bar) || 4;
  const flags = (score.beats || [])
    .map((b, i) => (b && b.downbeat ? i : -1)).filter((i) => i >= 0);
  const phase = flags.length ? ((flags[0] % perBar) + perBar) % perBar : 0;
  function indexOf(bar, beat) {
    return phase + (Math.round(bar) - 1) * perBar + (Math.round(beat || 1) - 1);
  }
  function secondsAt(bar, beat) {
    const i = indexOf(bar, beat);
    if (i <= 0) return beats.length ? beats[0] + i * (beats[1] - beats[0]) : 0;
    if (i >= beats.length) {
      const last = beats[beats.length - 1];
      const step = beats.length > 1 ? last - beats[beats.length - 2] : 0.5;
      return last + (i - beats.length + 1) * step;
    }
    return beats[i];
  }
  const step = beats.length > 1
    ? (beats[beats.length - 1] - beats[0]) / (beats.length - 1) : 0.5;
  const hits = (((score.rhythm || {}).hits) || [])
    .map((h) => ({ t: +h.t, i: +h.intensity || 0 }))
    .sort((a, b) => a.t - b.t);
  return { beats, perBar, phase, secondsAt, hits, beatSeconds: step, barSeconds: step * perBar };
}

function cueSeconds(cue, grid) {
  const at = cue.at || {};
  if (at.second != null) return +at.second;
  if (at.bar != null) return grid.secondsAt(at.bar, at.beat || 1);
  return 0;
}

const FIGURES = {
  alternate(ids, step) {
    const half = Math.ceil(ids.length / 2);
    const a = ids.slice(0, half), b = ids.slice(half);
    return step % 2 === 0 ? a : b;
  },
  sweep(ids, step) {
    return ids.length ? [ids[((step % ids.length) + ids.length) % ids.length]] : [];
  },
  bounce(ids, step) {
    const n = ids.length;
    if (!n) return [];
    const span = Math.max(1, 2 * n - 2);
    let i = ((step % span) + span) % span;
    if (i >= n) i = span - i;
    return [ids[i]];
  },
  build(ids, step) {
    const n = ids.length;
    if (!n) return [];
    return ids.slice(0, (((step % n) + n) % n) + 1);
  },
  pulse(ids, step) {
    return step % 2 === 0 ? ids.slice() : [];
  },
  pairs(ids, step) {
    const out = [];
    for (let i = 0; i < ids.length; i++) if (Math.floor(i / 2) % 2 === step % 2) out.push(ids[i]);
    return out;
  },
};

function chaseStepSeconds(chase, grid) {
  const every = chase.every || { bars: 1 };
  if (every.bars != null) return grid.barSeconds * Math.max(0.25, +every.bars);
  if (every.beats != null) return grid.beatSeconds * Math.max(0.25, +every.beats);
  return grid.barSeconds;
}

function chaseStepTimes(chase, grid, startS, endS) {
  const every = chase.every || { bars: 1 };
  if (every.hits != null) {
    const n = Math.max(1, Math.round(+every.hits));
    const floor = chase.min_intensity != null ? +chase.min_intensity : 0.3;
    const picked = grid.hits
      .filter((h) => h.t >= startS - 1e-6 && h.t < endS - 1e-6 && h.i >= floor)
      .map((h) => h.t);
    const out = [];
    for (let k = 0; k < picked.length; k += n) out.push(Math.max(startS, picked[k]));
    return out.length ? out : [startS];
  }
  const nBeats = every.beats != null
    ? Math.max(0.25, +every.beats)
    : Math.max(0.25, +(every.bars != null ? every.bars : 1)) * grid.perBar;
  const beats = grid.beats;
  if (!beats.length) return [startS];
  let i0 = 0;
  while (i0 + 1 < beats.length && beats[i0 + 1] <= startS + 1e-6) i0++;
  const at = (x) => {
    const lo = Math.floor(x), frac = x - lo;
    if (lo >= beats.length - 1) {
      const step = beats.length > 1 ? beats[beats.length - 1] - beats[beats.length - 2] : 0.5;
      return beats[beats.length - 1] + (x - (beats.length - 1)) * step;
    }
    return frac === 0 ? beats[lo] : beats[lo] + (beats[lo + 1] - beats[lo]) * frac;
  };
  const out = [];
  for (let k = 0; ; k++) {
    const t = at(i0 + k * nBeats);
    if (t >= endS - 1e-6) break;
    out.push(Math.max(startS, t));
    if (out.length > 4096) break;
  }
  return out.length ? out : [startS];
}

module.exports = { loadRig, groupsFor, expandTargets, parseColour, makeGrid, cueSeconds, FIGURES, chaseStepSeconds, chaseStepTimes };
