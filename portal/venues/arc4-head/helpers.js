"use strict";
/* Shared helpers for the arc4-head DMX effect functions.
   Rig: 4 × par7 (7ch each, addresses 1-28) + 1 × head13 (13ch, address 29-41).
   Total: 41 DMX channels, universe 0. */

const TOTAL_CH = 41;
const FPS = 40;

/* par7 channel offsets (within a 7-channel block):
   0=master 1=R 2=G 3=B 4=strobe 5=keep_zero 6=keep_zero */
const PAR = { master: 0, r: 1, g: 2, b: 3, strobe: 4 };

/* head13 channel offsets (within a 13-channel block):
   0=pan 1=pan_fine 2=tilt 3=tilt_fine 4=speed 5=master 6=strobe
   7=colour_wheel 8=gobo 9=prism 10..12=keep_zero */
const HEAD = { pan: 0, panFine: 1, tilt: 2, tiltFine: 3, speed: 4,
               master: 5, strobe: 6, colour: 7, gobo: 8, prism: 9 };

const COLOUR_WHEEL = [
  { name: "white",      value: 4,   rgb: [1, 1, 1] },
  { name: "red",        value: 20,  rgb: [1, 0, 0] },
  { name: "yellow",     value: 36,  rgb: [1, 0.85, 0] },
  { name: "blue",       value: 52,  rgb: [0, 0, 1] },
  { name: "green",      value: 68,  rgb: [0, 1, 0] },
  { name: "pink",       value: 84,  rgb: [1, 0, 0.55] },
  { name: "orange",     value: 100, rgb: [1, 0.3, 0] },
  { name: "light blue", value: 116, rgb: [0, 0.6, 1] },
];

const HEAD_PARK = { pan: 169, tilt: 127, speed: 200, level: 0 };

/* Fixture layout: 4 pars, 1 head. Addresses are 1-based in the layout but
   DMX frame arrays are 0-based. */
const PARS = [
  { id: "par_1",  offset: 0 },
  { id: "par_8",  offset: 7 },
  { id: "par_15", offset: 14 },
  { id: "par_22", offset: 21 },
];
const HEADS = [
  { id: "head", offset: 28 },
];
const ALL_FIXTURES = PARS.map(p => p.id).concat(HEADS.map(h => h.id));
const PAR_IDS = PARS.map(p => p.id);
const HEAD_IDS = HEADS.map(h => h.id);

/* Grouping helpers — adapted for 4 pars. */
const INNER = PARS.slice(1, 3);           // par_8, par_15
const OUTER = [PARS[0], PARS[3]];         // par_1, par_22
const LEFT  = PARS.slice(0, 2);           // par_1, par_8
const RIGHT = PARS.slice(2, 4);           // par_15, par_22
const ENDS  = [PARS[0], PARS[3]];         // par_1, par_22

function parsForExtent(extent) {
  switch (extent) {
    case "inner":  return INNER;
    case "outer":  return OUTER;
    case "left":   return LEFT;
    case "right":  return RIGHT;
    case "ends":   return ENDS;
    case "single": return [PARS[Math.floor(PARS.length / 2)]];
    case "all": default: return PARS;
  }
}

function fixtureIdsForExtent(extent) {
  return parsForExtent(extent).map(p => p.id);
}

function emptyFrame() { return new Array(TOTAL_CH).fill(0); }

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function parseColour(v, fallback) {
  if (v == null) return fallback || [1, 1, 1];
  if (Array.isArray(v) && v.length >= 3) {
    const any255 = v[0] > 1 || v[1] > 1 || v[2] > 1;
    return any255 ? [v[0] / 255, v[1] / 255, v[2] / 255] : [v[0], v[1], v[2]];
  }
  if (typeof v === "string") {
    const byName = COLOUR_WHEEL.find(c => c.name === v.toLowerCase());
    if (byName) return byName.rgb.slice();
    const hex = v.replace(/^#/, "");
    if (/^[0-9a-fA-F]{6}$/.test(hex)) {
      return [parseInt(hex.slice(0, 2), 16) / 255,
              parseInt(hex.slice(2, 4), 16) / 255,
              parseInt(hex.slice(4, 6), 16) / 255];
    }
    if (/^[0-9a-fA-F]{3}$/.test(hex)) {
      return [parseInt(hex[0] + hex[0], 16) / 255,
              parseInt(hex[1] + hex[1], 16) / 255,
              parseInt(hex[2] + hex[2], 16) / 255];
    }
  }
  return fallback || [1, 1, 1];
}

function parseColours(v, fallback) {
  if (Array.isArray(v) && v.length >= 2 && !Array.isArray(v[0]) && typeof v[0] !== "string") {
    return fallback;
  }
  if (Array.isArray(v)) return v.map((c, i) => parseColour(c, (fallback || [])[i]));
  return fallback;
}

function rgb255(rgb) {
  return rgb.map(v => clamp(Math.round(v * 255), 0, 255));
}

function nearestWheelColour(rgb) {
  let best = COLOUR_WHEEL[0], bestDist = Infinity;
  for (const c of COLOUR_WHEEL) {
    const d = Math.abs(c.rgb[0] - rgb[0]) + Math.abs(c.rgb[1] - rgb[1]) + Math.abs(c.rgb[2] - rgb[2]);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}

function setPar(frame, par, colour, level) {
  const o = par.offset;
  const l = clamp(level, 0, 1);
  const c = rgb255(colour);
  frame[o + PAR.master] = 255;
  frame[o + PAR.r] = clamp(Math.round(c[0] * l), 0, 255);
  frame[o + PAR.g] = clamp(Math.round(c[1] * l), 0, 255);
  frame[o + PAR.b] = clamp(Math.round(c[2] * l), 0, 255);
}

function setParStrobe(frame, par, hz) {
  const o = par.offset;
  frame[o + PAR.strobe] = hz > 0 ? clamp(Math.round((hz / 25) * 255), 1, 255) : 0;
}

function setHead(frame, head, opts) {
  const o = head.offset;
  const level = clamp(opts.level != null ? opts.level : 0, 0, 1);
  frame[o + HEAD.master] = clamp(Math.round(level * 255), 0, 255);
  frame[o + HEAD.speed] = HEAD_PARK.speed;
  if (opts.colour) {
    const wc = nearestWheelColour(opts.colour);
    frame[o + HEAD.colour] = wc.value;
  }
  if (opts.pan != null) {
    frame[o + HEAD.pan] = clamp(Math.round(opts.pan * 255), 0, 255);
    frame[o + HEAD.panFine] = 0;
  } else {
    frame[o + HEAD.pan] = HEAD_PARK.pan;
  }
  if (opts.tilt != null) {
    frame[o + HEAD.tilt] = clamp(Math.round(opts.tilt * 255), 0, 255);
    frame[o + HEAD.tiltFine] = 0;
  } else {
    frame[o + HEAD.tilt] = HEAD_PARK.tilt;
  }
  if (opts.gobo != null) frame[o + HEAD.gobo] = opts.gobo;
  if (opts.prism != null) frame[o + HEAD.prism] = opts.prism;
  if (opts.strobe != null) {
    frame[o + HEAD.strobe] = opts.strobe > 0 ? clamp(Math.round((opts.strobe / 25) * 255), 1, 255) : 0;
  }
}

function framesPerBeat(bpm) { return Math.round(FPS * 60 / bpm); }

function easeLinear(t) { return t; }
function easeInOut(t)  { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function easeSettle(t) { return 1 - Math.pow(1 - t, 3); }
function easeCurve(name) {
  if (name === "ease") return easeInOut;
  if (name === "settle") return easeSettle;
  return easeLinear;
}

function hitEnv(t) { return t < 0.08 ? 1 : Math.max(0, 1 - (t - 0.08) / 0.30); }

function swellEnv(t, rise) {
  if (t < rise) return t / rise;
  return 1 - (t - rise) / (1 - rise);
}

module.exports = {
  TOTAL_CH, FPS, PAR, HEAD, COLOUR_WHEEL, HEAD_PARK,
  PARS, HEADS, ALL_FIXTURES, PAR_IDS, HEAD_IDS,
  INNER, OUTER, LEFT, RIGHT, ENDS,
  parsForExtent, fixtureIdsForExtent,
  emptyFrame, clamp, rgb255, nearestWheelColour,
  parseColour, parseColours,
  setPar, setParStrobe, setHead,
  framesPerBeat, easeLinear, easeInOut, easeSettle, easeCurve,
  hitEnv, swellEnv,
};
