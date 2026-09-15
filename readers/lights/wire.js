"use strict";
/* wire.js -- intents -> DMX frames, one frame per tick, as wide as the rig.
   The one place the wire rules live, shared by bake.js (a whole show) and
   preview.js (one sequence):
     - each fixture's intent goes through ITS driver (channel truth lives there, and
       the head's aim window is applied there);
     - the display gamma (1.6) is applied once, here, on the intensity channels
       (PAR r/g/b, head dimmer);
     - EVERY head's pose is slew-limited as ONE 16-bit value -- coarse and fine
       together, at most `maxStep` DMX per frame -- and HELD whenever an intent
       carries no pan/tilt, so a dark beat or a gap between looks never lets the
       driver's zero defaults whip the head across the room.
   The limiter's state is what was last put on the wire, seeded to the park pose
   and never reset, exactly as the bridge's safety contract says. Pure in its
   inputs: the same ticks wire identically.

   The frame is as wide as the layout's last channel (41 on arc4-head, which is
   where the constant came from), so a rig with more fixtures is not truncated
   at someone else's universe size. */
const drivers = require("./drivers/index.js");

const GAMMA = 1.6;
const PARK = { pan: 169, tilt: 127 };      /* rig.py: PAN_WALL_CENTRE / TILT_UP */

const widthOf = layout => (layout.fixtures || []).reduce(
  (w, f) => Math.max(w, f.address + drivers.forType(f.type).footprint - 1), 0);

function toLightsFrames(ticks, layout, opts) {
  opts = opts || {};
  const W = opts.width || widthOf(layout), gammaExp = opts.gamma || GAMMA, maxStep = opts.maxStep || 7;
  const addrOf = {};
  for (const f of layout.fixtures) addrOf[f.id] = f.address;
  const gammaIdx = new Set();
  for (const f of layout.fixtures) {
    if (f.type === "par7") { const a = f.address; gammaIdx.add(a); gammaIdx.add(a + 1); gammaIdx.add(a + 2); }
    if (f.type === "head13") gammaIdx.add(f.address + 4);   // head dimmer channel
  }
  const gamma = v => Math.round(255 * Math.pow(Math.max(0, Math.min(255, v)) / 255, gammaExp));
  const heads = layout.fixtures.filter(f => f.type === "head13");

  const driven = [];   // per frame, per head: did its intent carry a pan / a tilt?
  const frames = ticks.map(tk => {
    const f = new Array(W).fill(0);
    const d = {};
    for (const fx of tk.fixtures) {
      const slice = drivers.forType(fx.type).render(fx.intent || {});
      const base = addrOf[fx.id] - 1;
      for (let k = 0; k < slice.length && base + k < W; k++) f[base + k] = slice[k];
      d[fx.id] = { pan: !!(fx.intent && fx.intent.pan != null), tilt: !!(fx.intent && fx.intent.tilt != null) };
    }
    for (const idx of gammaIdx) f[idx] = gamma(f[idx] || 0);
    driven.push(d);
    return f;
  });

  /* the pose as a DMX float: coarse + fine/256 */
  const write = (f, i, v) => {
    const coarse = Math.floor(v + 1e-9);
    f[i] = coarse;
    f[i + 1] = Math.max(0, Math.min(255, Math.round((v - coarse) * 256)));
  };
  for (const head of heads) {
    const pi = head.address - 1, ti = head.address + 1;
    let pv = PARK.pan, tv = PARK.tilt;
    frames.forEach((f, i) => {
      const d = driven[i][head.id] || { pan: false, tilt: false };
      if (d.pan) { const want = f[pi] + f[pi + 1] / 256; pv += Math.max(-maxStep, Math.min(maxStep, want - pv)); }
      if (d.tilt) { const want = f[ti] + f[ti + 1] / 256; tv += Math.max(-maxStep, Math.min(maxStep, want - tv)); }
      write(f, pi, pv);
      write(f, ti, tv);
    });
  }
  return frames;
}

module.exports = { toLightsFrames, widthOf, GAMMA, PARK };
