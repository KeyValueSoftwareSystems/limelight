/* Each device TYPE is its own named driver, resolved from a registry by the type a
   layout fixture declares. Separate drivers, one shared runtime. Plain node idiom.
   (Needs the generated profiles: python3 readers/lights/drivers/gen_profiles.py) */
"use strict";
const drivers = require("./index.js");

const out = [];
const ok = (name, cond, detail) => out.push([!!cond, name, detail || ""]);

{
  const par = drivers.forType("par7");
  const head = drivers.forType("head13");

  ok("the PAR and the moving head are separate drivers",
     par !== head && par.footprint === 7 && head.footprint === 13,
     `par ${par.footprint}ch, head ${head.footprint}ch`);
  ok("the par driver has colour/level/strobe, not movement",
     par.can.includes("colour") && par.can.includes("strobe") && !par.can.includes("move"),
     JSON.stringify(par.can));
  ok("the head driver has movement and a colour wheel",
     head.can.includes("move") && head.can.includes("colour") && head.can.includes("prism"),
     JSON.stringify(head.can));
  ok("the registry lists the device types it knows",
     drivers.types().includes("par7") && drivers.types().includes("head13"),
     drivers.types().join(", "));

  let threw = false;
  try { drivers.forType("nonesuch"); } catch (e) { threw = true; }
  ok("an unknown device type is a clear error, not a silent black box", threw);
}

for (const [pass, name, detail] of out)
  console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
const bad = out.filter(r => !r[0]).length;
console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
