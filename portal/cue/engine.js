"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const LIGHTS = path.join(ROOT, "readers", "lights");

const PAN_CENTRE = 169.0;
const PAN_DEG_PER_DMX = 540.0 / 255.0;

function panKeepOut() {
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(path.join(ROOT, "portal", "limits.json"), "utf8"));
  } catch (e) {
    return [];
  }
  return (doc.keep_out || []).map((z) => {
    const a = PAN_CENTRE + z.pan_from_deg / PAN_DEG_PER_DMX;
    const b = PAN_CENTRE + z.pan_to_deg / PAN_DEG_PER_DMX;
    return [Math.min(a, b) / 255, Math.max(a, b) / 255];
  }).filter((z) => z[1] > 0 && z[0] < 1);
}

const REF_LUM = 0.55;

function lumOfRgb(c) {
  if (!c) return 1;
  return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
}

function evenOut(c) {
  const l = lumOfRgb(c);
  if (l <= 0.02) return 1;
  return Math.max(0.35, Math.min(1.9, REF_LUM / l));
}

const HEAD_MOVES = {
  park: () => ({}),
  sweep: (x) => ({ pan: x < 0.5 ? x * 2 : 2 - x * 2 }),
  arc: (x) => ({ pan: x < 0.5 ? x * 2 : 2 - x * 2, tilt: Math.sin(Math.PI * x) }),
  circle: (x) => ({ pan: 0.5 + 0.5 * Math.cos(2 * Math.PI * x),
                    tilt: 0.5 + 0.5 * Math.sin(2 * Math.PI * x) }),
  nod: (x) => ({ tilt: Math.abs(Math.sin(2 * Math.PI * x)) }),
  dip: (x) => ({ tilt: 1 - Math.abs(Math.sin(Math.PI * x)) }),
  snap: (x) => ({ pan: x < 0.5 ? 0 : 1 }),
  drift: (x) => ({ pan: 0.5 + 0.5 * Math.sin(2 * Math.PI * x),
                   tilt: 0.5 + 0.5 * Math.sin(4 * Math.PI * x) }),
};

const COLOUR_FIGURES = {
  hold: (n, step) => new Array(n).fill(0),
  flip: (n, step) => new Array(n).fill(step),
  alternate: (n, step) => Array.from({ length: n }, (_, i) => i + step),
  halves: (n, step) => Array.from({ length: n }, (_, i) => Math.floor(i / Math.ceil(n / 2)) + step),
  poles: (n, step) => Array.from({ length: n }, (_, i) => (i === 0 || i === n - 1 ? 0 : 1) + step),
  walk: (n, step) => Array.from({ length: n }, (_, i) => (i === (((step % n) + n) % n) ? 1 : 0)),
};

function safePanSpan(rig) {
  const zones = ((rig.limits && rig.limits.pan_keep_out) || [])
    .slice().sort((a, b) => a[0] - b[0]);
  let best = [0, 0], at = 0;
  for (const z of zones) {
    if (z[0] - at > best[1] - best[0]) best = [at, z[0]];
    at = Math.max(at, z[1]);
  }
  if (1 - at > best[1] - best[0]) best = [at, 1];
  const pad = Math.min(0.05, (best[1] - best[0]) * 0.1);
  return [best[0] + pad, best[1] - pad];
}

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
        prism: roles.indexOf("prism"),
      },
      movable: roles.indexOf("pan") >= 0,
      defaults: (prof.channels || []).map((c) => c.default || 0),
    };
  });
  const lamps = fixtures.filter((f) => !f.movable).sort((a, b) => a.x - b.x);
  const movers = fixtures.filter((f) => f.movable);
  const limits = { ...(layout.limits || {}) };
  limits.pan_keep_out = panKeepOut();
  return {
    name: rigName, channels: manifest.total_channels, layoutFile: manifest.layout_file,
    fixtures, lamps, movers, limits,
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
  const notes = [];
  for (const n of (score.melody || []).slice().sort((a, b) => a.start - b.start)) {
    const last = notes[notes.length - 1];
    if (last && n.start - last.t < 0.055) {
      if (n.pitch > last.p) { last.p = n.pitch; last.v = Math.max(last.v, n.velocity || 0); }
    } else {
      notes.push({ t: +n.start, p: +n.pitch, v: +n.velocity || 0 });
    }
  }
  return { beats, perBar, phase, secondsAt, hits, notes,
           beatSeconds: step, barSeconds: step * perBar };
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
    return step % 2 === 0 ? ids.slice(0, half) : ids.slice(half);
  },
  hocket(ids, step) {
    return ids.filter((_, i) => i % 2 === step % 2);
  },
  sweep(ids, step) {
    const n = ids.length;
    if (!n) return [];
    const span = Math.max(1, 2 * n - 2);
    let i = ((step % span) + span) % span;
    if (i >= n) i = span - i;
    return [ids[i]];
  },
  wave(ids, step) {
    const n = ids.length;
    if (!n) return {};
    const span = Math.max(1, 2 * n - 2);
    let head = ((step % span) + span) % span;
    if (head >= n) head = span - head;
    const out = {};
    for (let k = 0; k < n; k++) {
      const d = Math.abs(k - head);
      out[ids[k]] = d === 0 ? 1 : d === 1 ? 0.5 : d === 2 ? 0.2 : 0.06;
    }
    return out;
  },
  comet(ids, step) {
    const n = ids.length;
    if (!n) return {};
    const span = Math.max(1, 2 * n - 2);
    let h = ((step % span) + span) % span;
    if (h >= n) h = span - h;
    const out = {};
    for (let k = 0; k < n; k++) out[ids[k]] = Math.max(0.05, 1 - Math.abs(k - h) * 0.45);
    return out;
  },
  handover(ids, step) {
    const n = ids.length;
    if (n < 2) return ids.slice();
    const span = Math.max(1, 2 * n - 2);
    let a = ((step % span) + span) % span;
    let dir = 1;
    if (a >= n) { a = span - a; dir = -1; }
    const b = Math.max(0, Math.min(n - 1, a + dir));
    const out = {};
    for (let k = 0; k < n; k++) out[ids[k]] = k === a ? 1 : k === b ? 0.65 : 0.1;
    return out;
  },
  converge(ids, step) {
    const n = ids.length;
    if (n < 2) return ids.slice();
    const depth = Math.floor(n / 2);
    const d = ((step % depth) + depth) % depth;
    return [ids[d], ids[n - 1 - d]];
  },
  diverge(ids, step) {
    const n = ids.length;
    if (n < 2) return ids.slice();
    const depth = Math.floor(n / 2);
    const d = depth - 1 - (((step % depth) + depth) % depth);
    return [ids[d], ids[n - 1 - d]];
  },
  build(ids, step) {
    const n = ids.length;
    if (!n) return {};
    const head = (((step % n) + n) % n);
    const out = {};
    for (let k = 0; k < n; k++) out[ids[k]] = k > head ? 0.12 : (k === head ? 1 : 0.5);
    return out;
  },
  unbuild(ids, step) {
    const n = ids.length;
    if (!n) return {};
    const head = n - 1 - (((step % n) + n) % n);
    const out = {};
    for (let k = 0; k < n; k++) out[ids[k]] = k > head ? 0.12 : (k === head ? 1 : 0.5);
    return out;
  },
  cascade(ids, step) {
    const n = ids.length;
    if (n < 2) return ids.slice();
    const span = 2 * n - 1;
    const i = ((step % span) + span) % span;
    const a = Math.floor(i / 2);
    return i % 2 === 0 ? [ids[a]] : [ids[a], ids[Math.min(n - 1, a + 1)]];
  },
  pulse(ids, step) {
    return step % 2 === 0 ? ids.slice() : [];
  },
  split(ids, step) {
    const h = Math.ceil(ids.length / 2);
    const out = {};
    ids.forEach((id, i) => { out[id] = (i < h) === (step % 2 === 0) ? 1 : 0.22; });
    return out;
  },
  zigzag(ids, step) {
    const n = ids.length;
    if (!n) return [];
    const order = [];
    for (let k = 0; k < n; k += 2) order.push(k);
    for (let k = 1; k < n; k += 2) order.push(k);
    return [ids[order[((step % order.length) + order.length) % order.length]]];
  },
  pendulum(ids, step) {
    const n = ids.length;
    if (n < 2) return ids.slice();
    return [step % 2 === 0 ? ids[0] : ids[n - 1]];
  },
  tail(ids, step) {
    const n = ids.length;
    if (!n) return {};
    const span = Math.max(1, 2 * n - 2);
    let h = ((step % span) + span) % span;
    if (h >= n) h = span - h;
    const out = {};
    for (let k = 0; k < n; k++) {
      const d = Math.abs(k - h);
      out[ids[k]] = d === 0 ? 1 : d === 1 ? 0.7 : d === 2 ? 0.35 : 0.1;
    }
    return out;
  },
  march(ids, step) {
    const n = ids.length;
    if (n < 2) return ids.slice();
    const span = Math.max(1, 2 * (n - 1) - 1);
    let a = ((step % span) + span) % span;
    if (a >= n - 1) a = span - a - 1;
    return [ids[a], ids[Math.min(n - 1, a + 1)]];
  },
  blink(ids, step) {
    const n = ids.length;
    if (!n) return {};
    const who = Math.floor(step / 2) % n;
    const out = {};
    for (let k = 0; k < n; k++) out[ids[k]] = step % 2 === 0 ? (k === who ? 1 : 0.45) : 0.45;
    return out;
  },
  wipe(ids, step) {
    const n = ids.length;
    if (!n) return {};
    const span = 2 * n;
    const i = ((step % span) + span) % span;
    const up = i < n;
    const edge = up ? i : span - 1 - i;
    const out = {};
    for (let k = 0; k < n; k++) out[ids[k]] = k <= edge ? 1 : 0.15;
    return out;
  },
  stack(ids, step) {
    const n = ids.length;
    if (!n) return {};
    const t = ((step % n) + n) % n;
    const out = {};
    for (let k = 0; k < n; k++) {
      const x = n > 1 ? k / (n - 1) : 0;
      out[ids[k]] = t % 2 === 0 ? 0.2 + 0.8 * x : 1.0 - 0.8 * x;
    }
    return out;
  },
  breathe(ids, step) {
    const n = ids.length;
    if (!n) return {};
    const lv = step % 2 === 0 ? 1 : 0.4;
    const out = {};
    for (let k = 0; k < n; k++) out[ids[k]] = lv;
    return out;
  },
  twin(ids, step) {
    const n = ids.length;
    if (n < 4) return ids.slice();
    const a = ((step % n) + n) % n;
    const b2 = (n - 1) - a;
    const out = {};
    for (let k = 0; k < n; k++) out[ids[k]] = (k === a || k === b2) ? 1 : 0.15;
    return out;
  },
  pitch(ids, step, ctx) {
    const n = ids.length;
    if (!n) return {};
    if (ctx && Array.isArray(ctx.targets) && ctx.targets.length) {
      const tg = ctx.targets;
      let at = tg[0];
      for (let k = 1; k <= step && k < tg.length; k++) {
        if (tg[k] > at) at += 1;
        else if (tg[k] < at) at -= 1;
      }
      at = Math.max(0, Math.min(n - 1, at));
      const out = {};
      for (let k = 0; k < n; k++) {
        const d = Math.abs(k - at);
        out[ids[k]] = d === 0 ? 1 : (d === 1 ? 0.42 : 0.1);
      }
      return out;
    }
    const p = ctx && ctx.pitch != null ? ctx.pitch : null;
    if (p == null) return FIGURES.sweep(ids, step);
    let lo = ctx.lo != null ? ctx.lo : 30;
    let hi = ctx.hi != null ? ctx.hi : 90;
    if (Array.isArray(ctx.all) && ctx.all.length >= 6) {
      const q = ctx.all.slice().sort((a, b) => a - b);
      lo = q[Math.floor(q.length * 0.15)];
      hi = q[Math.floor(q.length * 0.85)];
      if (hi - lo < 4) { lo = q[0]; hi = q[q.length - 1]; }
    }
    const x = Math.max(0, Math.min(1, (p - lo) / Math.max(1, hi - lo)));
    const at = x * (n - 1);
    const out = {};
    for (let k = 0; k < n; k++) {
      const d = Math.abs(k - at);
      out[ids[k]] = d <= 1 ? Math.max(0.08, 1 - d * 0.78) : 0.08;
    }
    return out;
  },
};

const FORMS = {
  sine: (x) => Math.sin(2 * Math.PI * x),
  cosine: (x) => Math.cos(2 * Math.PI * x),
  ramp: (x) => 2 * (x - Math.floor(x)) - 1,
  saw: (x) => 1 - 2 * (x - Math.floor(x)),
  triangle: (x) => 4 * Math.abs(x - Math.floor(x + 0.5)) - 1,
  step: (x) => ((x - Math.floor(x)) < 0.5 ? 1 : -1),
  swell: (x) => {
    const f = x - Math.floor(x);
    return f < 0.25 ? f / 0.25 : (1 - (f - 0.25) / 0.75);
  },
};

function effectPeriod(fx, grid) {
  const r = fx.rate || { bars: 1 };
  if (r.bars != null) return Math.max(0.2, grid.barSeconds * +r.bars);
  if (r.beats != null) return Math.max(0.2, grid.beatSeconds * +r.beats);
  if (r.seconds != null) return Math.max(0.2, +r.seconds);
  return grid.barSeconds;
}

function effectValue(fx, grid, t, index, count) {
  const form = FORMS[fx.form] || FORMS.sine;
  const period = effectPeriod(fx, grid);
  const spread = fx.phase != null ? +fx.phase : 0;
  const per = count > 1 ? (spread / 360) * (index / (count - 1)) : 0;
  const dir = fx.reverse ? -1 : 1;
  return form(dir * (t / period) + per + (fx.offset != null ? +fx.offset : 0));
}

function chaseStepSeconds(chase, grid) {
  const every = chase.every || { bars: 1 };
  if (every.bars != null) return grid.barSeconds * Math.max(0.25, +every.bars);
  if (every.beats != null) return grid.beatSeconds * Math.max(0.25, +every.beats);
  return grid.barSeconds;
}

function noteStepsIn(grid, startS, endS, n) {
  const step = Math.max(1, Math.round(n || 1));
  const picked = (grid.notes || []).filter((x) => x.t >= startS - 1e-6 && x.t < endS - 1e-6);
  const out = [];
  for (let k = 0; k < picked.length; k += step) out.push(picked[k]);
  return out;
}

function fillGaps(out, grid, chase, startS, endS) {
  const most = chase.max_step_s != null ? +chase.max_step_s : 0.95;
  const filled = [];
  let prev = startS;
  for (const t of out.concat([endS])) {
    while (t - prev > most) {
      prev += most;
      let b = prev, best = Infinity;
      for (const x of grid.beats) {
        const d = Math.abs(x - prev);
        if (d < best) { best = d; b = x; }
      }
      if (b > (filled.length ? filled[filled.length - 1] : startS) + 0.2 && b < t - 0.2) {
        filled.push(b);
        prev = b;
      }
    }
    if (t < endS) { filled.push(t); prev = t; }
  }
  filled.sort((a, b) => a - b);
  const seen = [];
  for (const t of filled) if (!seen.length || t - seen[seen.length - 1] > 0.05) seen.push(t);
  return seen.length ? seen : out;
}

function gateSteps(out, grid, chase) {
  const sub = chase.min_step_beats != null ? +chase.min_step_beats : 0.5;
  const floor = Math.max(0.22, grid.beatSeconds * sub * 0.92);
  const kept = [];
  for (const t of out) if (!kept.length || t - kept[kept.length - 1] >= floor) kept.push(t);
  return kept.length ? kept : out.slice(0, 1);
}

function chaseStepTimes(chase, grid, startS, endS) {
  const every = chase.every || { bars: 1 };
  if (every.notes != null) {
    const n = Math.max(1, Math.round(+every.notes));
    const picked = (grid.notes || [])
      .filter((x) => x.t >= startS - 1e-6 && x.t < endS - 1e-6)
      .map((x) => x.t);
    const out = [];
    for (let k = 0; k < picked.length; k += n) out.push(Math.max(startS, picked[k]));
    return gateSteps(fillGaps(out.length ? out : [startS], grid, chase, startS, endS), grid, chase);
  }
  if (every.hits != null) {
    const n = Math.max(1, Math.round(+every.hits));
    const floor = chase.min_intensity != null ? +chase.min_intensity : 0.3;
    const picked = grid.hits
      .filter((h) => h.t >= startS - 1e-6 && h.t < endS - 1e-6 && h.i >= floor)
      .map((h) => h.t);
    const chosen = [];
    for (let k = 0; k < picked.length; k += n) chosen.push(Math.max(startS, picked[k]));
    const fillBeats = chase.fill_beats != null ? +chase.fill_beats : 2;
    const maxGap = grid.beatSeconds * fillBeats * 1.35;
    const beats = grid.beats.filter((t) => t >= startS - 1e-6 && t < endS - 1e-6);
    const merged = chosen.slice();
    let cursor = startS;
    for (let k = 0; k <= chosen.length; k++) {
      const next = k < chosen.length ? chosen[k] : endS;
      if (next - cursor > maxGap) {
        for (const b of beats) {
          if (b <= cursor + grid.beatSeconds * 0.5) continue;
          if (b >= next - grid.beatSeconds * 0.5) break;
          if (merged.length && Math.min(...merged.map((x) => Math.abs(x - b))) < grid.beatSeconds * (fillBeats - 0.4)) continue;
          merged.push(b);
        }
      }
      cursor = next;
    }
    merged.sort((a, b) => a - b);
    const out = [];
    for (const t of merged) if (!out.length || t - out[out.length - 1] > 0.05) out.push(t);
    return gateSteps(fillGaps(out.length ? out : [startS], grid, chase, startS, endS), grid, chase);
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

module.exports = { loadRig, safePanSpan, COLOUR_FIGURES, HEAD_MOVES, evenOut, lumOfRgb, groupsFor, expandTargets, parseColour, makeGrid, cueSeconds, FIGURES, chaseStepSeconds, chaseStepTimes, noteStepsIn, FORMS, effectValue, effectPeriod };
