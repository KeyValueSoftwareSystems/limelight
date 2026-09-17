"use strict";
/* Shared helpers for the club16-2head DMX effect functions.
   Rig: 16 × par7 (7ch each, addresses 1-112) + 2 × head13 (13ch each, addresses 113-138).
   Total: 138 DMX channels, universe 0. */

const TOTAL_CH = 138;
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
/* the colour wheel turns continuously at and above this value (rig.py: COLOUR_SPIN_MIN) */
const SPIN_MIN = 150;

/* Fixture layout: 16 pars, 2 heads. Addresses are 1-based in the layout but
   DMX frame arrays are 0-based, so par_01 at address 1 starts at index 0. */
const PARS = [];
for (let i = 0; i < 16; i++) PARS.push({ id: "par_" + String(i + 1).padStart(2, "0"), offset: i * 7 });
const HEADS = [
  { id: "head_1", offset: 112 },
  { id: "head_2", offset: 125 },
];
const ALL_FIXTURES = PARS.map(p => p.id).concat(HEADS.map(h => h.id));
const PAR_IDS = PARS.map(p => p.id);
const HEAD_IDS = HEADS.map(h => h.id);

/* Grouping helpers matching preflight.js's groupsOf semantics. */
const INNER = PARS.slice(4, 12);
const OUTER = PARS.slice(0, 4).concat(PARS.slice(12, 16));
const LEFT  = PARS.slice(0, 8);
const RIGHT = PARS.slice(8, 16);
const ENDS  = [PARS[0], PARS[15]];

const CENTRE = PARS.length % 2
  ? [PARS[(PARS.length - 1) / 2]]
  : PARS.slice(PARS.length / 2 - 1, PARS.length / 2 + 1);

function parsForExtent(extent) {
  switch (extent) {
    case "inner":  return INNER;
    case "outer":  return OUTER;
    case "left":   return LEFT;
    case "right":  return RIGHT;
    case "ends":   return ENDS;
    case "single": return CENTRE;
    case "all": default: {
      /* "lamp3": one lamp by its place in the row, 1 = leftmost. A cue that wants
         to mark the lamp AHEAD of a walker needs to name a single lamp, and the
         pairs cannot say that. */
      const m = /^lamp(\d+)$/.exec(String(extent || ""));
      if (m) { const p = PARS[Number(m[1]) - 1]; return p ? [p] : []; }
      return PARS;
    }
  }
}

function fixtureIdsForExtent(extent) {
  return parsForExtent(extent).map(p => p.id);
}

function emptyFrame() { return new Array(TOTAL_CH).fill(0); }

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/* Normalise any colour value to [r, g, b] with each component 0..1.
   Accepts: "#rrggbb", "#rgb", [r,g,b] (0..1), [R,G,B] (0..255 if any > 1),
   a colour name from the wheel, or null/undefined (returns fallback). */
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

/* Set a par's colour and level in a frame. Level is 0..1, colour is [r,g,b] 0..1. */
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

/* Set a head's state in a frame. Level 0..1, colour as [r,g,b], pan/tilt 0..1. */
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
    const pv = clamp(Math.round(opts.pan * 255), 0, 255);
    frame[o + HEAD.pan] = pv;
    frame[o + HEAD.panFine] = 0;
  } else {
    frame[o + HEAD.pan] = HEAD_PARK.pan;
  }
  if (opts.tilt != null) {
    const tv = clamp(Math.round(opts.tilt * 255), 0, 255);
    frame[o + HEAD.tilt] = tv;
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

/* Easing curves. t is 0..1, returns 0..1. */
function easeLinear(t) { return t; }
function easeInOut(t)  { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function easeSettle(t) { return 1 - Math.pow(1 - t, 3); }
function easeCurve(name) {
  if (name === "ease") return easeInOut;
  if (name === "settle") return easeSettle;
  return easeLinear;
}

/* Hit envelope: spike on beat, short hold, fast fall. */
function hitEnv(t) { return t < 0.08 ? 1 : Math.max(0, 1 - (t - 0.08) / 0.30); }

/* Swell envelope: up then down over the span. Rise controls the peak position. */
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
