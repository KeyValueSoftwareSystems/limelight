/* Verifies the profiles generated from rig.py drive the runtime correctly -- i.e.
   the real rig's channel map and colours flowed through gen_profiles.py intact.
   Run gen_profiles.py first (needs rig.py). Plain node idiom. */
"use strict";
const fs = require("fs"), path = require("path");
const { Driver } = require("./driver.js");

const out = [];
const ok = (name, cond, detail) => out.push([!!cond, name, detail || ""]);
const load = n => JSON.parse(fs.readFileSync(path.join(__dirname, "profiles", n), "utf8"));

let par7, head13;
try { par7 = load("par7.profile.json"); head13 = load("head13.profile.json"); }
catch (e) {
  console.log("  SKIP  profiles not generated -- run: python3 readers/lights/drivers/gen_profiles.py");
  process.exit(0);
}

/* ---- par7 --------------------------------------------------------------- */
{
  const d = Driver(par7);
  ok("par7 is a 7-channel colour/level/strobe device",
     d.footprint === 7 && ["colour", "level", "strobe"].every(c => d.can.includes(c)),
     JSON.stringify(d.can));
  const f = d.render({ colour: [1, 0, 0], level: 1 });
  ok("par7 renders full red with the master held full and locks the program channels",
     Math.max(...f) === 255 && f[5] === 0 && f[6] === 0, JSON.stringify(f));
}

/* ---- head13 ------------------------------------------------------------- */
{
  const d = Driver(head13);
  ok("head13 is a 13-channel mover with a colour wheel",
     d.footprint === 13 && d.can.includes("move") && d.can.includes("colour"),
     JSON.stringify(d.can));
  const blue = head13.colour_wheel.find(s => s.name === "blue");
  ok("blue snaps to rig's blue wheel slot value",
     d.render({ colour: [0, 0, 1] })[7] === blue.value, "wheel " + d.render({ colour: [0, 0, 1] })[7]);
  ok("level drives the head's master dimmer full",
     d.render({ level: 1 })[5] === 255, "master " + d.render({ level: 1 })[5]);
  const p = d.park();
  ok("head park is dark and never all-zero", p[5] === 0 && Math.max(...p) > 0, JSON.stringify(p));
}

for (const [pass, name, detail] of out)
  console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
const bad = out.filter(r => !r[0]).length;
console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
