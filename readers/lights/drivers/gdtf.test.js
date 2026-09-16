/* The device profiles read out of the GDTF files under mvr/gdtf/, plus the two
   things the shared runtime had to learn to drive them: a fourth (white) emitter,
   subtractive CMY, a shutter-and-strobe channel, and a NAMED colour on a device
   with no wheel to snap it to. Plain node idiom, same shape as the tests beside it. */
"use strict";
const fs = require("fs"), path = require("path");
const drivers = require("./index.js");

const out = [];
const ok = (name, cond, detail) => out.push([!!cond, name, detail || ""]);
const load = n => JSON.parse(fs.readFileSync(path.join(__dirname, "profiles", n), "utf8"));

const GDTF = ["par5", "wash12", "spot29", "strobe3", "blinder1", "pixelbar24"];

/* ---- every profile is registered, and says where it came from ------------ */
{
  for (const t of GDTF.concat("laser8")) {
    let d = null;
    try { d = drivers.forType(t); } catch (e) { /* reported below */ }
    ok(`${t} is registered in the driver registry`, !!d);
  }
  for (const t of GDTF) {
    const p = load(`${t}.profile.json`);
    ok(`${t} names the GDTF it was read from`, !!p.gdtf && !!p.mode, `${p.gdtf} [${p.mode}]`);
    ok(`${t} declares its beam angle`, p.beam && typeof p.beam.angle_deg === "number",
       JSON.stringify(p.beam));
    ok(`${t}'s footprint matches its channel count`,
       p.footprint === (p.channels || []).length, `${p.footprint} vs ${(p.channels||[]).length}`);
  }
  const laser = load("laser8.profile.json");
  ok("laser8 is marked as invented, because there is no laser GDTF here",
     laser.invented === true && /INVENTED|invented/.test(laser.note || ""));
}

/* ---- the regression this file exists for -------------------------------- */
{
  /* A head gesture names a WHEEL SLOT, because that is all a mechanical wheel can
     do. head13 snaps to the slot. A mixing device has no wheel, and before the
     runtime knew the names it computed 255 * "pink"[0] and wrote NaN into the
     frame -- which then went out over the wire as a corrupt byte. Latent for as
     long as the only mixing device was a par, which is never sent a name. */
  for (const t of ["par5", "wash12", "spot29", "pixelbar24", "laser8"]) {
    const f = drivers.forType(t).render({ colour: "pink", level: 1 });
    ok(`${t} renders a NAMED colour to finite bytes`,
       f.every(v => Number.isFinite(v)) && f.every(v => v >= 0 && v <= 255), f.join(","));
  }
  const wash = drivers.forType("wash12");
  const named = wash.render({ colour: "pink", level: 1 });
  const triple = wash.render({ colour: [1, 0, 0.55], level: 1 });
  ok("a named colour and its rgb triple render identically",
     named.join(",") === triple.join(","), `${named} vs ${triple}`);
  ok("an unknown colour name leaves the emitters alone rather than writing NaN",
     drivers.forType("par5").render({ colour: "chartreuse", level: 1 })
       .every(v => Number.isFinite(v)));
}

/* ---- RGBW: the white emitter carries the achromatic part ----------------- */
{
  const d = drivers.forType("par5");
  const w = i => d.render(i)[4];
  ok("open white drives the W emitter full", w({ colour: [1, 1, 1], level: 1 }) === 255);
  ok("a saturated hue leaves W dark", w({ colour: [1, 0, 0], level: 1 }) === 0);
  ok("a pastel drives W by its achromatic part",
     w({ colour: [1, 0.5, 0.5], level: 1 }) === 128, String(w({ colour: [1, 0.5, 0.5], level: 1 })));
}

/* ---- spot29: subtractive CMY, and the wheel held open -------------------- */
{
  const d = drivers.forType("spot29");
  const cmy = i => d.render(i).slice(5, 8).join(",");
  ok("white takes nothing out", cmy({ colour: [1, 1, 1], level: 1 }) === "0,0,0");
  ok("red blocks green and blue", cmy({ colour: [1, 0, 0], level: 1 }) === "0,255,255");
  ok("green blocks red and blue", cmy({ colour: [0, 1, 0], level: 1 }) === "255,0,255");
  ok("blue blocks red and green", cmy({ colour: [0, 0, 1], level: 1 }) === "255,255,0");
  ok("Color1 is held open, so a mix never also runs through a dichroic",
     d.render({ colour: [1, 0, 0], level: 1 })[4] === 0);
  ok("brightness is the master, not the flags",
     d.render({ colour: [1, 0, 0], level: 0.5 })[28] === 128 &&
     cmy({ colour: [1, 0, 0], level: 0.5 }) === "0,255,255");
}

/* ---- one channel doing shutter AND strobe -------------------------------- */
{
  for (const [t, i] of [["wash12", 0], ["spot29", 27]]) {
    const d = drivers.forType(t), sr = load(`${t}.profile.json`).strobe_range;
    ok(`${t} opens its shutter when nothing asks for strobe`,
       d.render({ level: 1 })[i] === sr.open, `${d.render({ level: 1 })[i]} want ${sr.open}`);
    ok(`${t} strobes inside its declared range`,
       d.render({ level: 1, strobe: 1 })[i] === sr.hi &&
       d.render({ level: 1, strobe: 0.5 })[i] > sr.lo - 1);
  }
  /* the two rig.py profiles have no strobe_range and must still be linear */
  ok("par7's strobe channel is untouched by the range logic",
     drivers.forType("par7").render({ strobe: 1 })[4] === 255);
}

/* ---- park: dark, and never a channel the device needs held up ------------ */
{
  for (const t of drivers.types()) {
    const p = drivers.forType(t).park();
    ok(`${t} parks to finite bytes`, p.every(v => Number.isFinite(v)), p.join(","));
  }
  ok("a wash parks with its shutter open but its dimmer at zero",
     drivers.forType("wash12").park()[1] === 0);
  ok("a spot parks dark", drivers.forType("spot29").park()[28] === 0);
  ok("a blinder is a single channel and parks at zero",
     drivers.forType("blinder1").park().join(",") === "0");
}

for (const [pass, name, detail] of out)
  console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
const bad = out.filter(r => !r[0]).length;
console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
