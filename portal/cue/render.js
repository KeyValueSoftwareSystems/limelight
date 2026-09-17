"use strict";
const E = require("./engine.js");
const TRAVELS = new Set(["sweep", "bounce", "wave", "comet", "handover", "cascade",
                         "pitch", "converge", "diverge", "split", "rotate",
                         "alternate", "pairs", "hocket"]);

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
  if (ch.prism >= 0) frame[fx.offset + ch.prism] = state.prism ? Math.round(Math.max(0, Math.min(1, state.prism)) * 255) : 0;
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
        prism: spec.prism != null ? +spec.prism : prev.prism,
      };
    }
  }
  return out;
}

function applyChase(rig, base, chase, step, palette, ctx) {
  if (!chase) return base;
  let ids = (chase.on ? [].concat(chase.on) : ["lamps"])
    .reduce((acc, k) => acc.concat(E.expandTargets(rig, k)), []);
  if (!ids.length) return base;
  if (chase.reverse) ids = ids.slice().reverse();
  const figure = E.FIGURES[chase.figure] || E.FIGURES.alternate;
  const res = figure(ids, step, ctx);
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
  const raw = {};
  ids.forEach((id) => {
    const b = base[id] || { l: 0, c: [1, 1, 1] };
    const w = weights[id];
    const top = chase.high != null ? +chase.high : b.l;
    raw[id] = b.l * low + (top - b.l * low) * Math.max(0, Math.min(1, w));
  });
  const conserve = chase.conserve != null ? !!chase.conserve : TRAVELS.has(chase.figure);
  let gain = 1;
  if (conserve) {
    let want = 0, got = 0;
    for (const id of ids) { want += (base[id] || { l: 0 }).l; got += raw[id]; }
    if (got > 1e-6 && want > 1e-6) gain = Math.max(0.6, Math.min(2.2, want / got));
  }
  let overflow = 1;
  if (ring) {
    const cfN0 = chase.colour_figure || "walk";
    const cf0 = E.COLOUR_FIGURES[cfN0] || E.COLOUR_FIGURES.walk;
    const ce0 = Math.max(1, Math.round(+chase.colour_every || 1));
    const ci0 = cf0(ids.length, Math.floor(step / ce0));
    ids.forEach((id, i) => {
      const b0 = base[id] || { l: 0, c: [1, 1, 1] };
      const k = ci0 ? ci0[i] : i;
      const col0 = ring[((k % ring.length) + ring.length) % ring.length];
      const want = raw[id] * gain * (E.evenOut(col0) / E.evenOut(b0.c));
      if (want > overflow) overflow = want;
    });
  }
  const cfName = chase.colour_figure || (ring ? "walk" : null);
  const cf = cfName && E.COLOUR_FIGURES[cfName] ? E.COLOUR_FIGURES[cfName] : null;
  const cevery = Math.max(1, Math.round(+chase.colour_every || 1));
  const cstep = Math.floor(step / cevery);
  const cidx = ring && cf ? cf(ids.length, cstep) : null;
  ids.forEach((id, i) => {
    const b = base[id] || { l: 0, c: [1, 1, 1] };
    const w = weights[id];
    let col = b.c;
    if (ring) {
      const k = cidx ? cidx[i] : i + cstep;
      col = ring[((k % ring.length) + ring.length) % ring.length];
    } else if (w > 0.5 && hiCol) {
      col = hiCol;
    }
    const even = ring ? E.evenOut(col) / E.evenOut(b.c) : 1;
    out[id] = {
      l: Math.max(0, Math.min(1, (raw[id] * gain * even) / overflow)),
      c: col,
      pan: b.pan, tilt: b.tilt, strobe: b.strobe, prism: b.prism,
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
      const span = E.safePanSpan(rig);
      const pan = hi > lo
        ? span[0] + (span[1] - span[0]) * ((lamp.x - lo) / (hi - lo))
        : (span[0] + span[1]) / 2;
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
    let layers = cues[i].chases || (cues[i].chase ? [cues[i].chase] : []);
    layers = layers.map((ch) => {
      if (ch && ch.figure === "pitch") return { ...ch, every: { beats: 1 } };
      if (!ch || !ch.every || ch.every.notes == null) return ch;
      const span = Math.max(0.01, cues[i]._end - cues[i]._t);
      const inside = (grid.notes || []).filter((x) => x.t >= cues[i]._t && x.t < cues[i]._end);
      const perBeat = inside.length / (span / grid.beatSeconds);
      if (perBeat >= 0.9) return ch;
      const alt = { ...ch, every: { beats: 2 } };
      if (ch.figure === "pitch") alt.figure = "comet";
      return alt;
    });
    cues[i]._layers = layers;
    cues[i]._steps = layers.map((ch) => E.chaseStepTimes(ch, grid, cues[i]._t, cues[i]._end));
    const sig = (ch) => (ch ? [ch.figure, JSON.stringify(ch.on || "lamps"),
                               JSON.stringify(ch.every || {}), ch.reverse ? 1 : 0].join("|") : "");
    cues[i]._phase = layers.map((ch, li) => {
      if (!ch || ch.figure === "pitch" || i === 0) return 0;
      const prev = cues[i - 1];
      const pl = (prev._layers || [])[li];
      if (!pl || sig(pl) !== sig(ch)) return 0;
      return (prev._phase ? prev._phase[li] : 0) + ((prev._steps || [])[li] || []).length;
    });
    if (cues[i]._steps.length > 1) {
      const lead = cues[i]._steps[0];
      for (let li = 1; li < cues[i]._steps.length; li++) {
        cues[i]._steps[li] = cues[i]._steps[li].map((t) => {
          let best = lead[0], d = Infinity;
          for (const x of lead) { const q = Math.abs(x - t); if (q < d) { d = q; best = x; } }
          return d <= grid.beatSeconds ? best : t;
        }).filter((t, k, arr) => k === 0 || t !== arr[k - 1]);
      }
    }
    cues[i]._notes = layers.map((ch, li) => {
      if (ch.figure !== "pitch") return null;
      const times = cues[i]._steps[li] || [];
      const notes = grid.notes || [];
      const span = notes.filter((x) => x.t >= cues[i]._t - 0.4 && x.t < cues[i]._end + 0.4);
      if (!span.length) return null;
      const ps = span.map((x) => x.p).sort((a, b) => a - b);
      const lo = ps[Math.floor(ps.length * 0.12)];
      const hi = ps[Math.ceil(ps.length * 0.88) - 1];
      const lamps = E.expandTargets(rig, [].concat(ch.on || "lamps")[0]).length || 4;
      const targets = times.map((t) => {
        let best = span[0], d = Infinity;
        for (const x of span) { const q = Math.abs(x.t - t); if (q < d) { d = q; best = x; } }
        const f = hi > lo ? (best.p - lo) / (hi - lo) : 0.5;
        return Math.max(0, Math.min(lamps - 1, Math.round(f * (lamps - 1))));
      });
      const spread = new Set(targets).size;
      if (spread < 3) {
        layers[li] = { ...ch, figure: "comet", every: { beats: 1 } };
        return null;
      }
      return { targets };
    });
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
      cue._layers.forEach((ch, li) => {
        const phase = (cue._phase || [])[li] || 0;
        const seq = cue._notes[li];
        const cx = seq && seq.targets ? { targets: seq.targets } : null;
        state = applyChase(rig, state, ch, steps[li] + phase, palette, cx);
      });
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
      const fxs = (cueFile.effects || []).map((e) => ({ ...e, __abs: true }))
        .concat(cue.effects || []);
      if (fxs.length) {
        const out = {};
        for (const id of Object.keys(state)) out[id] = { ...state[id] };
        for (const ef of fxs) {
          const ids = [].concat(ef.on || "lamps")
            .reduce((a, k) => a.concat(E.expandTargets(rig, k)), []);
          const size = ef.size != null ? +ef.size : 0.3;
          ids.forEach((id, i) => {
            const st0 = out[id];
            if (!st0) return;
            const v = E.effectValue(ef, grid, ef.__abs ? t : t - cue._t, i, ids.length);
            if (ef.attr === "pan" && st0.pan != null) {
              const sp = E.safePanSpan(rig);
              st0.pan = Math.max(sp[0], Math.min(sp[1], st0.pan + size * v));
            } else if (ef.attr === "tilt" && st0.tilt != null) {
              st0.tilt = Math.max(0, Math.min(1, st0.tilt + size * v));
            } else {
              st0.l = Math.max(0, Math.min(1, st0.l * (1 + size * v)));
            }
          });
        }
        state = out;
      }
      if (cue.head && cue.head.move && E.HEAD_MOVES[cue.head.move]) {
        const per = E.effectPeriod({ rate: cue.head.every || { bars: 2 } }, grid);
        const ph = per > 0 ? ((t - cue._t) / per) % 1 : 0;
        const m = E.HEAD_MOVES[cue.head.move](ph < 0 ? ph + 1 : ph);
        const sp = E.safePanSpan(rig);
        const tlo = cue.head.tilt_lo != null ? +cue.head.tilt_lo : 0.22;
        const thi = cue.head.tilt_hi != null ? +cue.head.tilt_hi : 0.52;
        const moved = { ...state };
        for (const h of rig.movers) {
          const s0 = moved[h.id];
          if (!s0) continue;
          const nx = { ...s0 };
          if (m.pan != null) nx.pan = sp[0] + (sp[1] - sp[0]) * Math.max(0, Math.min(1, m.pan));
          if (m.tilt != null) nx.tilt = tlo + (thi - tlo) * Math.max(0, Math.min(1, m.tilt));
          moved[h.id] = nx;
        }
        state = moved;
      }
      if (((rig.limits && rig.limits.pan_keep_out) || []).length) {
        const sp = E.safePanSpan(rig);
        const steered = { ...state };
        for (const h of rig.movers) {
          const s0 = steered[h.id];
          if (!s0 || s0.pan == null) continue;
          const p = Math.max(sp[0], Math.min(sp[1], s0.pan));
          if (p !== s0.pan) steered[h.id] = { ...s0, pan: p };
        }
        state = steered;
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
    const col = acc.c ? E.parseColour(acc.c, palette) : null;
    let ids;
    if (acc.on === "auto") {
      const i0 = Math.max(0, Math.min(frames.length - 1, Math.round(ta * fps)));
      const score = (key) => {
        const g = E.expandTargets(rig, key);
        let m = 0;
        for (const id of g) {
          const fx = rig.fixtures.find((f) => f.id === id);
          if (!fx) continue;
          const c = fx.ch;
          m += Math.max(frames[i0][fx.offset + (c.r >= 0 ? c.r : 0)],
                        frames[i0][fx.offset + (c.g >= 0 ? c.g : 0)],
                        frames[i0][fx.offset + (c.b >= 0 ? c.b : 0)]);
        }
        return g.length ? m / g.length : 0;
      };
      const i1 = Math.max(0, Math.min(frames.length - 1, Math.round(ta * fps)));
      let best = null, bv = -1;
      for (const f of rig.lamps) {
        const c = f.ch;
        const m = Math.max(frames[i1][f.offset + (c.r >= 0 ? c.r : 0)],
                           frames[i1][f.offset + (c.g >= 0 ? c.g : 0)],
                           frames[i1][f.offset + (c.b >= 0 ? c.b : 0)]);
        if (m > bv) { bv = m; best = f.id; }
      }
      ids = best ? [best] : E.expandTargets(rig, "lamps");
    } else {
      ids = (acc.on ? [].concat(acc.on) : ["lamps"])
        .reduce((a, k) => a.concat(E.expandTargets(rig, k)), []);
    }
    const hit = new Set(ids);
    const rest = rig.lamps.filter((f) => !hit.has(f.id));
    const wholeRig = rest.length === 0 && ids.length > 1;
    /* A glare is not a lift. It is the whole row held flat at a level, which is
       the other half of a travelling figure: the room blazes, then collapses to
       one lamp, and the collapse is what makes the travel read. A proportional
       accent can never do this because it preserves the shape it is scaling. */
    const blaze = acc.mode === "glare" && wholeRig;
    const i0 = Math.round(ta * fps), i1 = Math.min(frames.length, Math.round((ta + decay) * fps) + 1);
    for (let i = Math.max(0, i0); i < i1; i++) {
      /* A flash is held and then released, not a spike that decays from the
         first frame. Renjith's glares run for_beats; ours were dying in three
         frames, which is why the room sat 1.3x its bed for 11% of the show
         against his 23%. */
      const through = (i - i0) / Math.max(1, i1 - i0);
      const hold = acc.hold != null ? +acc.hold : 0.3;
      /* a glare holds flat for its whole length and then simply stops - the
         collapse is the event, so it must not be faded away */
      const w = acc.mode === "glare"
        ? 1
        : (through <= hold ? 1 : Math.pow(1 - (through - hold) / (1 - hold), 0.45));
      let added = 0;
      let rigGain = 0;
      if (wholeRig) {
        let peak = 0;
        for (const id of ids) {
          const fx = rig.fixtures.find((f) => f.id === id);
          if (!fx) continue;
          const ch = fx.ch;
          peak = Math.max(peak, fx.brightness === "colour"
            ? Math.max(frames[i][fx.offset + (ch.r >= 0 ? ch.r : 0)],
                       frames[i][fx.offset + (ch.g >= 0 ? ch.g : 0)],
                       frames[i][fx.offset + (ch.b >= 0 ? ch.b : 0)])
            : (ch.master >= 0 ? frames[i][fx.offset + ch.master] : 0));
        }
        if (peak > 4) rigGain = Math.max(1, Math.min(255 / peak, 1 + 3.2 * lvl * w));
      }
      for (const id of ids) {
        const fx = rig.fixtures.find((f) => f.id === id);
        if (!fx) continue;
        const ch = fx.ch;
        const amp = lvl * w;
        if (blaze) {
          const flat = Math.round(255 * lvl * (w > 0 ? 1 : 0));
          if (flat > 0) {
            if (fx.brightness === "colour") {
              let bc = col;
              if (!bc) {
                const r0 = ch.r >= 0 ? frames[i][fx.offset + ch.r] : 0;
                const g0 = ch.g >= 0 ? frames[i][fx.offset + ch.g] : 0;
                const b0 = ch.b >= 0 ? frames[i][fx.offset + ch.b] : 0;
                const mx = Math.max(r0, g0, b0);
                bc = mx > 4 ? [r0 / mx, g0 / mx, b0 / mx] : [1, 1, 1];
              }
              if (ch.r >= 0) frames[i][fx.offset + ch.r] = Math.round(bc[0] * flat);
              if (ch.g >= 0) frames[i][fx.offset + ch.g] = Math.round(bc[1] * flat);
              if (ch.b >= 0) frames[i][fx.offset + ch.b] = Math.round(bc[2] * flat);
              if (ch.master >= 0) frames[i][fx.offset + ch.master] = 255;
            } else if (ch.master >= 0) {
              frames[i][fx.offset + ch.master] = flat;
            }
          }
          continue;
        }
        if (fx.brightness === "colour") {
          const before = Math.max(frames[i][fx.offset + (ch.r >= 0 ? ch.r : 0)],
                                frames[i][fx.offset + (ch.g >= 0 ? ch.g : 0)],
                                frames[i][fx.offset + (ch.b >= 0 ? ch.b : 0)]);
          const target = Math.min(255, Math.round(before * (rigGain > 0 ? rigGain : 1 + amp)));
          if (target > before) added += target - before;
          if (col) {
            if (ch.r >= 0) frames[i][fx.offset + ch.r] = Math.max(frames[i][fx.offset + ch.r], Math.round(col[0] * amp * 255));
            if (ch.g >= 0) frames[i][fx.offset + ch.g] = Math.max(frames[i][fx.offset + ch.g], Math.round(col[1] * amp * 255));
            if (ch.b >= 0) frames[i][fx.offset + ch.b] = Math.max(frames[i][fx.offset + ch.b], Math.round(col[2] * amp * 255));
          } else if (before > 0 && target > before) {
            const g = target / before;
            for (const c of [ch.r, ch.g, ch.b]) {
              if (c >= 0) frames[i][fx.offset + c] = Math.min(255, Math.round(frames[i][fx.offset + c] * g));
            }
          }
        } else if (ch.master >= 0) {
          const held = frames[i][fx.offset + ch.master];
          frames[i][fx.offset + ch.master] =
            Math.min(255, Math.round(held * (rigGain > 0 ? rigGain : 1 + amp)));
        }
      }
      if (!rest.length || added <= 0) continue;
      let restTotal = 0;
      for (const fx of rest) {
        const ch = fx.ch;
        restTotal += fx.brightness === "colour"
          ? Math.max(frames[i][fx.offset + (ch.r >= 0 ? ch.r : 0)],
                     frames[i][fx.offset + (ch.g >= 0 ? ch.g : 0)],
                     frames[i][fx.offset + (ch.b >= 0 ? ch.b : 0)])
          : (ch.master >= 0 ? frames[i][fx.offset + ch.master] : 0);
      }
      if (restTotal <= 0) continue;
      const k = Math.max(0.55, Math.min(1, 1 - added / restTotal));
      for (const fx of rest) {
        const ch = fx.ch;
        if (fx.brightness === "colour") {
          for (const c of [ch.r, ch.g, ch.b]) {
            if (c >= 0) frames[i][fx.offset + c] = Math.round(frames[i][fx.offset + c] * k);
          }
        } else if (ch.master >= 0) {
          frames[i][fx.offset + ch.master] = Math.round(frames[i][fx.offset + ch.master] * k);
        }
      }
    }
  }

  return { frames, fps, rig, grid, cues };
}

module.exports = { render, resolveLook, applyChase, blankFrame, writeFixture };
