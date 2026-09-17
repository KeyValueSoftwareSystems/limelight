"use strict";
/* Shared helpers for the halo-portal DMX effect functions.
   -------------------------------------------------------------------------
   EVERY RIG FACT HERE IS READ, NOT TYPED. Channel width, fixture offsets and
   per-type channel roles all come from readers/lights/halo-portal.layout.json
   and the driver profiles beside it.

   That is not tidiness, it is the bug fix. portal/venues/keycode-arena/ was made
   by copying a helpers.js and editing its manifest: the copy still declared
   TOTAL_CH = 138 and sixteen par7 at 7-channel offsets while its rig was 488
   channels of seven other device types. It baked, and reported success, and
   every address was wrong. A helpers that reads its own layout cannot do that.

   THE COMPAT SHIM. The 28 effect modules are portable across rigs because they
   only ever talk to this file -- parsForExtent, setPar, setHead, emptyFrame.
   This rig has no head13, so HEADS is the movers it does have (6 spot29 + 6
   wash12) and setHead dispatches on the fixture's own type. That is what lets
   the modules come over from arc4-head unchanged. */
const fs = require("fs");
const path = require("path");

const LIGHTS = path.join(__dirname, "..", "..", "..", "readers", "lights");
const PROFILE_DIR = path.join(LIGHTS, "drivers", "profiles");

const LAYOUT = JSON.parse(fs.readFileSync(path.join(LIGHTS, "halo-portal.layout.json"), "utf8"));

const PROFILES = {};
for (const fn of fs.readdirSync(PROFILE_DIR)) {
  if (!fn.endsWith(".profile.json")) continue;
  const p = JSON.parse(fs.readFileSync(path.join(PROFILE_DIR, fn), "utf8"));
  PROFILES[p.type] = p;
}

const FPS = 40;

/* role -> first index within a device's channel block. A pixelbar repeats
   colour.r six times, once per cell; the first wins here and the cell stride in
   setPixel is what addresses the rest. */
function rolesOf(type) {
  const at = {};
  PROFILES[type].channels.forEach((c, i) => { if (!(c.role in at)) at[c.role] = i; });
  return at;
}

const FX = LAYOUT.fixtures.map(f => ({
  id: f.id,
  type: f.type,
  group: f.group || null,
  x: f.at[0],
  z: f.at[2],
  offset: f.address - 1,
  roles: rolesOf(f.type),
  footprint: PROFILES[f.type].footprint,
  cells: PROFILES[f.type].cells || 0,
}));

const TOTAL_CH = Math.max(...FX.map(f => f.offset + f.footprint));

const byType = t => FX.filter(f => f.type === t).sort((a, b) => a.x - b.x);

const PARS    = byType("par5");        // the arch outline -- what "extent" means
const PIXELS  = byType("pixelbar24");
const SPOTS   = byType("spot29");
const WASHES  = byType("wash12");
const BLINDS  = byType("blinder1");
const STROBES = byType("strobe3");
const LASERS  = byType("laser8");

/* "heads" is the modules' word for anything that moves */
const HEADS = SPOTS.concat(WASHES).sort((a, b) => a.x - b.x);

const ALL_FIXTURES = FX.map(f => f.id);
const PAR_IDS = PARS.map(p => p.id);
const HEAD_IDS = HEADS.map(h => h.id);

/* -- groups --------------------------------------------------------------- */

const archOf = g => PARS.filter(p => p.group === g);
const ARCH_A = archOf("arch_a"), ARCH_B = archOf("arch_b"), ARCH_C = archOf("arch_c");

const quarter = Math.round(PARS.length / 4);
const half = Math.floor(PARS.length / 2);
const INNER = PARS.slice(quarter, PARS.length - quarter);
const OUTER = PARS.slice(0, quarter).concat(PARS.slice(PARS.length - quarter));
const LEFT  = PARS.slice(0, half);
const RIGHT = PARS.slice(half);
const ENDS  = [PARS[0], PARS[PARS.length - 1]];
const CENTRE = PARS.length % 2
  ? [PARS[(PARS.length - 1) / 2]]
  : PARS.slice(PARS.length / 2 - 1, PARS.length / 2 + 1);

/* the top quarter of the rig by height: where a crown look lives */
const zMax = Math.max(...PARS.map(p => p.z));
const CROWN = PARS.filter(p => p.z >= 0.75 * zMax);
const LEGS  = PARS.filter(p => p.z < 0.75 * zMax);

function parsForExtent(extent) {
  switch (extent) {
    case "inner":  return INNER;
    case "outer":  return OUTER;
    case "left":   return LEFT;
    case "right":  return RIGHT;
    case "ends":   return ENDS;
    case "single": return CENTRE;
    case "arch_a": return ARCH_A;
    case "arch_b": return ARCH_B;
    case "arch_c": return ARCH_C;
    case "crown":  return CROWN;
    case "legs":   return LEGS;
    case "all": default: {
      const m = /^lamp(\d+)$/.exec(String(extent || ""));
      if (m) { const p = PARS[Number(m[1]) - 1]; return p ? [p] : []; }
      return PARS;
    }
  }
}

function fixtureIdsForExtent(extent) { return parsForExtent(extent).map(p => p.id); }

/* -- frame primitives ----------------------------------------------------- */

function emptyFrame() { return new Array(TOTAL_CH).fill(0); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function rgb255(rgb) { return rgb.map(v => clamp(Math.round(v * 255), 0, 255)); }

/* Kept for module compatibility: a few gestures name a colour by word. This rig
   has no colour wheel -- everything mixes RGBW or CMY -- so these are names, not
   slots, and setHead mixes the real colour instead of snapping to a wheel. */
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
const HEAD_PARK = { pan: 128, tilt: 128, speed: 200, level: 0 };

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
  if (Array.isArray(v) && v.length >= 2 && !Array.isArray(v[0]) && typeof v[0] !== "string") return fallback;
  if (Array.isArray(v)) return v.map((c, i) => parseColour(c, (fallback || [])[i]));
  return fallback;
}

function nearestWheelColour(rgb) {
  let best = COLOUR_WHEEL[0], bestDist = Infinity;
  for (const c of COLOUR_WHEEL) {
    const d = Math.abs(c.rgb[0] - rgb[0]) + Math.abs(c.rgb[1] - rgb[1]) + Math.abs(c.rgb[2] - rgb[2]);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}

/* write an RGBW set from an rgb triple: W carries the common floor, so a white
   look uses the white emitter rather than three colours at full */
function writeRGBW(frame, o, roles, colour, level) {
  const l = clamp(level, 0, 1);
  const c = colour.map(v => clamp(v, 0, 1));
  const w = Math.min(c[0], c[1], c[2]);
  frame[o + roles["colour.r"]] = clamp(Math.round((c[0] - w) * l * 255), 0, 255);
  frame[o + roles["colour.g"]] = clamp(Math.round((c[1] - w) * l * 255), 0, 255);
  frame[o + roles["colour.b"]] = clamp(Math.round((c[2] - w) * l * 255), 0, 255);
  if (roles["colour.w"] !== undefined) frame[o + roles["colour.w"]] = clamp(Math.round(w * l * 255), 0, 255);
}

/* -- per-type setters ----------------------------------------------------- */

/* par5: RGBW with its own master. Master is held open and the colour carries the
   level, which is how every other rig in the repo drives a par. */
function setPar(frame, par, colour, level) {
  frame[par.offset + par.roles.master] = 255;
  writeRGBW(frame, par.offset, par.roles, colour, level);
}

/* par5 has no strobe channel. Kept so copied modules do not crash; a module that
   wants a strobe on this rig should reach for STROBES or setHead's strobe. */
function setParStrobe() { /* no strobe channel on par5 */ }

function setBlinder(frame, blind, level) {
  frame[blind.offset + blind.roles.master] = clamp(Math.round(clamp(level, 0, 1) * 255), 0, 255);
}

function setStrobe(frame, st, level, hz) {
  frame[st.offset + st.roles.master] = clamp(Math.round(clamp(level, 0, 1) * 255), 0, 255);
  frame[st.offset + st.roles.strobe_duration] = 128;
  frame[st.offset + st.roles.strobe] = hz > 0 ? clamp(Math.round((hz / 25) * 255), 1, 255) : 0;
}

function setLaser(frame, laser, opts) {
  const o = laser.offset, r = laser.roles;
  frame[o + r.master] = clamp(Math.round(clamp(opts.level != null ? opts.level : 0, 0, 1) * 255), 0, 255);
  const c = rgb255(opts.colour || [0, 1, 0]);
  frame[o + r["colour.r"]] = c[0];
  frame[o + r["colour.g"]] = c[1];
  frame[o + r["colour.b"]] = c[2];
  frame[o + r.pan]  = clamp(Math.round((opts.pan  != null ? opts.pan  : 0.5) * 255), 0, 255);
  frame[o + r.tilt] = clamp(Math.round((opts.tilt != null ? opts.tilt : 0.5) * 255), 0, 255);
  frame[o + r.speed] = clamp(Math.round((opts.speed != null ? opts.speed : 0.6) * 255), 0, 255);
}

/* one pixelbar cell, 0-based */
function setPixel(frame, bar, cell, colour, level) {
  if (cell < 0 || cell >= bar.cells) return;
  const stride = bar.footprint / bar.cells;          // 24 / 6 = 4: RGBW per cell
  writeRGBW(frame, bar.offset + cell * stride,
            { "colour.r": 0, "colour.g": 1, "colour.b": 2, "colour.w": 3 }, colour, level);
}

function setPixelAll(frame, bar, colour, level) {
  for (let i = 0; i < bar.cells; i++) setPixel(frame, bar, i, colour, level);
}

/* A MOVER. Dispatches on the fixture's own type, so a module written against
   head13's vocabulary drives a spot29 or a wash12 without knowing which. */
function setHead(frame, head, opts) {
  if (!head) return;
  const o = head.offset, r = head.roles;
  const level = clamp(opts.level != null ? opts.level : 0, 0, 1);
  const colour = opts.colour ? parseColour(opts.colour, [1, 1, 1]) : [1, 1, 1];

  frame[o + r.master] = clamp(Math.round(level * 255), 0, 255);
  if (r.speed !== undefined) frame[o + r.speed] = HEAD_PARK.speed;

  if (r["colour.c"] !== undefined) {
    /* spot29 mixes SUBTRACTIVELY: the flags take colour out of a white lamp */
    frame[o + r["colour.c"]] = clamp(Math.round((1 - colour[0]) * 255), 0, 255);
    frame[o + r["colour.m"]] = clamp(Math.round((1 - colour[1]) * 255), 0, 255);
    frame[o + r["colour.y"]] = clamp(Math.round((1 - colour[2]) * 255), 0, 255);
  } else if (r["colour.r"] !== undefined) {
    writeRGBW(frame, o, r, colour, 1);              // master already carries level
  }

  frame[o + r.pan]  = opts.pan  != null ? clamp(Math.round(opts.pan  * 255), 0, 255) : HEAD_PARK.pan;
  frame[o + r.tilt] = opts.tilt != null ? clamp(Math.round(opts.tilt * 255), 0, 255) : HEAD_PARK.tilt;
  if (r.panFine  !== undefined) frame[o + r.panFine] = 0;
  if (r.tiltFine !== undefined) frame[o + r.tiltFine] = 0;

  if (opts.gobo  != null && r.gobo  !== undefined) frame[o + r.gobo] = opts.gobo;
  if (opts.prism != null && r.prism !== undefined) frame[o + r.prism] = opts.prism;
  if (r.focus !== undefined) frame[o + r.focus] = 128;
  if (opts.strobe != null && r.strobe !== undefined) {
    frame[o + r.strobe] = opts.strobe > 0 ? clamp(Math.round((opts.strobe / 25) * 255), 1, 255) : 0;
  }
}

/* -- timing and easing (identical to every other rig's) -------------------- */

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
function swellEnv(t, rise) { return t < rise ? t / rise : 1 - (t - rise) / (1 - rise); }

/* Drive EVERY mover, not one. This rig has twelve (6 spots + 6 washes), and the
   effects were written against a single head, so a show ran one lamp while the
   rest sat dark. Both helpers take one pose and spread it across all movers
   (ordered left-to-right by x); every other option (level, colour, tilt, gobo,
   prism, strobe) passes straight through, and setHead still dispatches per type.
     - setHeadsAll: PARALLEL. Every mover fans the same way around the aimed pan,
       so a swept aim reads as the whole rig travelling together. For travelling
       effects (beam, chase, trade, bounce, sweep).
     - setHeadsMirror: SYMMETRIC. The left half mirrors the right about centre,
       so an aim off-centre opens the rig out like a butterfly and an aim at
       centre converges it. For blooming/two-sided effects (impact, drive,
       pulse, ripple, split, swell, breathe, converge). */
function fanHeads(frame, opts, mirror, spread) {
  const n = HEADS.length;
  if (!n) return;
  const basePan = opts.pan != null ? opts.pan : 0.5;
  HEADS.forEach((head, i) => {
    const t = n > 1 ? i / (n - 1) : 0.5;                 // 0..1 across the movers
    let pan;
    if (mirror) {
      const left = t < 0.5;
      const local = (left ? 0.5 - t : t - 0.5) * 2;      // 0 at centre .. 1 at the ends
      const aim = left ? 1 - basePan : basePan;          // mirror the aim across centre
      pan = aim + (left ? -1 : 1) * local * spread;
    } else {
      pan = basePan + (t - 0.5) * 2 * spread;
    }
    setHead(frame, head, { ...opts, pan: clamp(pan, 0, 1) });
  });
}
function setHeadsAll(frame, opts, spread = 0.3) { fanHeads(frame, opts, false, spread); }
function setHeadsMirror(frame, opts, spread = 0.3) { fanHeads(frame, opts, true, spread); }

module.exports = {
  TOTAL_CH, FPS, COLOUR_WHEEL, HEAD_PARK,
  PARS, HEADS, PIXELS, SPOTS, WASHES, BLINDS, STROBES, LASERS,
  ALL_FIXTURES, PAR_IDS, HEAD_IDS,
  INNER, OUTER, LEFT, RIGHT, ENDS, CENTRE, ARCH_A, ARCH_B, ARCH_C, CROWN, LEGS,
  parsForExtent, fixtureIdsForExtent,
  emptyFrame, clamp, rgb255, nearestWheelColour,
  parseColour, parseColours,
  setPar, setParStrobe, setHead, setHeadsAll, setHeadsMirror,
  setBlinder, setStrobe, setLaser, setPixel, setPixelAll,
  framesPerBeat, easeLinear, easeInOut, easeSettle, easeCurve,
  hitEnv, swellEnv,
};
