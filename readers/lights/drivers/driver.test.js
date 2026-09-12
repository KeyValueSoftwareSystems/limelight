/* Device-driver runtime tests. Plain node, same idiom as protocol/session.test.js.
   A driver turns a device profile (what each channel does) into semantic intents
   (setColour/setLevel/...), so sequences never touch raw channels. */
"use strict";
const { Driver } = require("./driver.js");

const out = [];
const ok = (name, cond, detail) => out.push([!!cond, name, detail || ""]);
const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps);

/* A minimal RGB par-like profile: brightness lives in the colour channels, with a
   master dimmer held full and two locked "program" channels. */
const PAR = {
  type: "parX", footprint: 7, can: ["colour", "level", "strobe"], brightness: "colour",
  channels: [
    { role: "master", default: 255 },
    { role: "colour.r", default: 0 },
    { role: "colour.g", default: 0 },
    { role: "colour.b", default: 0 },
    { role: "strobe", default: 0 },
    { role: "keep_zero", default: 0 },
    { role: "keep_zero", default: 0 },
  ],
  strobe: { max_hz: 25 },
};

/* ---- capabilities ------------------------------------------------------- */
{
  const d = Driver(PAR);
  ok("a driver exposes the capabilities its profile declares",
     d.can.includes("colour") && d.can.includes("level") && d.can.includes("strobe"),
     JSON.stringify(d.can));
  ok("and its channel footprint", d.footprint === 7, "footprint " + d.footprint);
}

/* ---- render: colour + level on an rgb device ---------------------------- */
{
  const d = Driver(PAR);
  const f = d.render({ colour: [1, 0, 0], level: 0.5 });
  ok("render returns one value per channel", Array.isArray(f) && f.length === 7,
     "len " + (f && f.length));
  ok("on an rgb device, level scales the colour channels",
     f[1] === 128 && f[2] === 0 && f[3] === 0, JSON.stringify(f));
  ok("and the master dimmer is held full", f[0] === 255, "master " + f[0]);
  ok("locked channels stay zero", f[5] === 0 && f[6] === 0, JSON.stringify(f));
}

/* A minimal moving-head-like profile: brightness is a master dimmer, colour is a
   mechanical wheel of discrete slots, movement is 16-bit pan/tilt, three channels
   locked at zero. */
const HEAD = {
  type: "headX", footprint: 13, brightness: "master",
  can: ["colour", "level", "move", "strobe", "gobo", "prism"],
  channels: [
    { role: "pan", default: 0 }, { role: "pan_fine", default: 0 },
    { role: "tilt", default: 0 }, { role: "tilt_fine", default: 0 },
    { role: "speed", default: 0 }, { role: "master", default: 0 },
    { role: "strobe", default: 0 }, { role: "colour_wheel", default: 0 },
    { role: "gobo", default: 0 }, { role: "prism", default: 0 },
    { role: "keep_zero", default: 0 }, { role: "keep_zero", default: 0 },
    { role: "keep_zero", default: 0 },
  ],
  colour_wheel: [
    { name: "white", value: 4, rgb: [1, 1, 1] },
    { name: "red", value: 20, rgb: [1, 0, 0] },
    { name: "blue", value: 52, rgb: [0, 0, 1] },
    { name: "green", value: 68, rgb: [0, 1, 0] },
  ],
  gobo: { open: 0, flower: 80 }, prism: { off: 0, six: 100 }, spin_min: 150,
};

/* ---- render: master brightness + colour wheel --------------------------- */
{
  const d = Driver(HEAD);
  ok("on a wheel device, level drives the master dimmer",
     d.render({ level: 0.5 })[5] === 128, JSON.stringify(d.render({ level: 0.5 })));
  ok("a blue-ish colour snaps to the nearest wheel slot",
     d.render({ colour: [0, 0, 1] })[7] === 52, "wheel " + d.render({ colour: [0, 0, 1] })[7]);
  ok("a red-ish colour snaps to the red slot",
     d.render({ colour: [0.9, 0.1, 0.0] })[7] === 20, "wheel " + d.render({ colour: [0.9, 0.1, 0.0] })[7]);
  const f = d.render({ level: 1, colour: [1, 0, 0] });
  ok("a wheel device's locked channels stay zero", f[10] === 0 && f[11] === 0 && f[12] === 0,
     JSON.stringify(f));
}

/* ---- render: 16-bit pan/tilt from normalized 0..1 ----------------------- */
{
  const d = Driver(HEAD);
  const f = d.render({ pan: 0.5, tilt: 1 });
  ok("pan 0.5 maps to 16-bit coarse+fine", f[0] === 128 && f[1] === 0, `pan ${f[0]}/${f[1]}`);
  ok("tilt at full maps to max coarse+fine", f[2] === 255 && f[3] === 255, `tilt ${f[2]}/${f[3]}`);
}

/* ---- render: head-specific gobo / prism / colour-spin ------------------- */
{
  const d = Driver(HEAD);
  ok("a named gobo maps to its wheel value", d.render({ gobo: "flower" })[8] === 80,
     "gobo " + d.render({ gobo: "flower" })[8]);
  ok("prism true engages the prism", d.render({ prism: true })[9] === 100,
     "prism " + d.render({ prism: true })[9]);
  ok("prism false disengages it", d.render({ prism: false })[9] === 0);
  ok("spin overrides the wheel slot with a continuous-spin value",
     d.render({ colour: [1, 0, 0], spin: true })[7] === 150,
     "wheel " + d.render({ colour: [1, 0, 0], spin: true })[7]);
}

/* ---- park: a safe, non-all-zero pose ------------------------------------ */
{
  const parked = { ...HEAD, park: { pan: 0.5, tilt: 0.5, level: 0, speed: 1 } };
  const p = Driver(parked).park();
  ok("park sets the declared pose with the dimmer dark", p[5] === 0 && p[0] === 128,
     JSON.stringify(p));
  ok("park is a full-footprint frame", p.length === 13, "len " + p.length);
  const par = Driver(PAR).park();
  ok("a par parks dark (colour off) but keeps its master default",
     par[0] === 255 && par[1] === 0 && par[2] === 0 && par[3] === 0, JSON.stringify(par));
}

for (const [pass, name, detail] of out)
  console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
const bad = out.filter(r => !r[0]).length;
console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
