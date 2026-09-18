"use strict";
/* Shared helpers for the KeyCode Arena DMX effect functions.

   This venue shipped as a copy of club16-2head, helpers and all, so it built
   138-channel frames for a rig its own manifest declares at 488. Every cue
   addressed channels the arena does not have and the whole show baked black,
   with nothing anywhere saying why.

   The rig is not hardcoded any more. It is read from the layout the manifest
   points at and the fixture profiles that layout names, so the channel map
   cannot drift from the rig again: add a fixture to the layout and the effects
   see it. */

const fs = require("fs");
const path = require("path");

const HERE = __dirname;
const REPO = path.dirname(path.dirname(path.dirname(HERE)));
const LIGHTS = path.join(REPO, "readers", "lights");

const manifest = JSON.parse(fs.readFileSync(path.join(HERE, "manifest.json"), "utf8"));
const layout = JSON.parse(fs.readFileSync(path.join(LIGHTS, manifest.layout_file), "utf8"));

const FPS = 40;

/** A fixture type's channel roles, by index, from its own profile. */
function roles(type) {
  const p = path.join(LIGHTS, "drivers", "profiles", type + ".profile.json");
  const prof = JSON.parse(fs.readFileSync(p, "utf8"));
  const list = prof.channels;
  const out = {};
  const n = Array.isArray(list) ? list.length : Number(list) || 0;
  if (Array.isArray(list)) {
    list.forEach((c, i) => {
      const role = typeof c === "string" ? c : c && (c.role || c.name);
      if (role && out[role] === undefined) out[role] = i;
    });
  }
  return { n, ...out };
}

const ROLES = {};
for (const t of new Set(layout.fixtures.map((f) => f.type))) ROLES[t] = roles(t);

const TOTAL_CH = manifest.total_channels;

/* Addresses are 1-based in the layout; a DMX frame is a 0-based array. */
const of = (f) => ({ id: f.id, type: f.type, offset: f.address - 1, x: f.at[0] });

/* Anything that makes flat colour is a "par" to an effect: the 22 par5 cans and
   the 6 wash12 movers, which the effects drive as colour rather than as heads.
   Ordered left to right, because every extent below is a slice of a ROW. */
const PARS = layout.fixtures
  .filter((f) => f.type === "par5" || f.type === "wash12")
  .sort((a, b) => a.at[0] - b.at[0] || a.address - b.address)
  .map(of);

/* The spot29 movers are the heads. */
const HEADS = layout.fixtures
  .filter((f) => f.type === "spot29")
  .sort((a, b) => a.at[0] - b.at[0] || a.address - b.address)
  .map(of);

/* Kept so effects written against the club16 names still read: these are the
   par5 offsets, and setPar() resolves the right ones per fixture type. */
const PAR = { master: 0, r: 1, g: 2, b: 3, strobe: 4 };
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
const SPIN_MIN = 150;

const ALL_FIXTURES = PARS.map((p) => p.id).concat(HEADS.map((h) => h.id));
const PAR_IDS = PARS.map((p) => p.id);
const HEAD_IDS = HEADS.map((h) => h.id);

/* Grouping helpers matching preflight.js's groupsOf semantics, as fractions of
   the row rather than fixed indices - this row is 28 wide, not 16. */
const q = (a, b) => PARS.slice(Math.round(PARS.length * a), Math.round(PARS.length * b));
const INNER = q(0.25, 0.75);
const OUTER = q(0, 0.25).concat(q(0.75, 1));
const LEFT  = q(0, 0.5);
const RIGHT = q(0.5, 1);
const ENDS  = [PARS[0], PARS[PARS.length - 1]].filter(Boolean);

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
      const m = /^lamp(\d+)$/.exec(String(extent || ""));
      if (m) { const p = PARS[Number(m[1]) - 1]; return p ? [p] : []; }
      return PARS;
    }
  }
}

function fixtureIdsForExtent(extent) {
  return parsForExtent(extent).map((p) => p.id);
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

/* Set a par's colour and level. par5 carries master + RGB; wash12 is a mover
   whose colour sits further into its block, so the roles come from the profile
   rather than from one hardcoded offset table. */
function setPar(frame, par, colour, level) {
  if (!par) return;
  const r = ROLES[par.type] || ROLES.par5;
  const o = par.offset;
  const l = clamp(level, 0, 1);
  const c = rgb255(colour);
  if (r.master !== undefined) frame[o + r.master] = 255;
  if (r["colour.r"] !== undefined) {
    frame[o + r["colour.r"]] = clamp(Math.round(c[0] * l), 0, 255);
    frame[o + r["colour.g"]] = clamp(Math.round(c[1] * l), 0, 255);
    frame[o + r["colour.b"]] = clamp(Math.round(c[2] * l), 0, 255);
  }
}

function setParStrobe(frame, par, hz) {
  if (!par) return;
  const r = ROLES[par.type] || ROLES.par5;
  if (r.strobe === undefined) return;
  frame[par.offset + r.strobe] = hz > 0 ? clamp(Math.round((hz / 25) * 255), 1, 255) : 0;
}

/* Set a head's state. The arena's heads are spot29: subtractive CMY rather than
   a colour wheel, master at the far end of the block, and no fine channels. */
function setHead(frame, head, opts) {
  if (!head) return;
  const r = ROLES[head.type] || ROLES.spot29;
  const o = head.offset;
  const level = clamp(opts.level != null ? opts.level : 0, 0, 1);

  if (r.master !== undefined) frame[o + r.master] = clamp(Math.round(level * 255), 0, 255);
  if (r.speed !== undefined) frame[o + r.speed] = HEAD_PARK.speed;

  if (opts.colour) {
    const c = opts.colour;
    if (r["colour.c"] !== undefined) {
      frame[o + r["colour.c"]] = clamp(Math.round((1 - c[0]) * 255), 0, 255);
      frame[o + r["colour.m"]] = clamp(Math.round((1 - c[1]) * 255), 0, 255);
      frame[o + r["colour.y"]] = clamp(Math.round((1 - c[2]) * 255), 0, 255);
    } else if (r["colour.r"] !== undefined) {
      const v = rgb255(c);
      frame[o + r["colour.r"]] = v[0];
      frame[o + r["colour.g"]] = v[1];
      frame[o + r["colour.b"]] = v[2];
    } else if (r.colour !== undefined) {
      frame[o + r.colour] = nearestWheelColour(c).value;
    }
  }

  if (r.pan !== undefined) {
    frame[o + r.pan] = opts.pan != null
      ? clamp(Math.round(opts.pan * 255), 0, 255)
      : HEAD_PARK.pan;
  }
  if (r.tilt !== undefined) {
    frame[o + r.tilt] = opts.tilt != null
      ? clamp(Math.round(opts.tilt * 255), 0, 255)
      : HEAD_PARK.tilt;
  }
  if (opts.gobo != null && r.gobo !== undefined) frame[o + r.gobo] = opts.gobo;
  if (opts.prism != null && r.prism !== undefined) frame[o + r.prism] = opts.prism;
  if (opts.strobe != null && r.strobe !== undefined) {
    frame[o + r.strobe] = opts.strobe > 0 ? clamp(Math.round((opts.strobe / 25) * 255), 1, 255) : 0;
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
  TOTAL_CH, FPS, PAR, HEAD, COLOUR_WHEEL, HEAD_PARK, SPIN_MIN, ROLES,
  PARS, HEADS, ALL_FIXTURES, PAR_IDS, HEAD_IDS,
  INNER, OUTER, LEFT, RIGHT, ENDS, CENTRE,
  parsForExtent, fixtureIdsForExtent,
  emptyFrame, clamp, rgb255, nearestWheelColour,
  parseColour, parseColours,
  setPar, setParStrobe, setHead,
  framesPerBeat, easeLinear, easeInOut, easeSettle, easeCurve,
  hitEnv, swellEnv,
};
