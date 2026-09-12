/* fromscore.js tests -- the one place that turns the hub's raw score (the
   pipeline's parts/bars) into the flat sections + energy the reader wants.
   The arranger drives drum accents off each section's stems, so the mapping
   must carry stems through, not just the section edges. Plain node idiom. */
"use strict";
const { shape } = require("./fromscore.js");

const out = [];
const ok = (name, cond, detail) => out.push([!!cond, name, detail || ""]);

const RAW = {
  score: "t",
  grid: { bpm: 128, first_beat_s: 4.86, beats_per_bar: 4, bars: 18, first_bar: 0, last_bar: 17 },
  parts: [
    { from_bar: 0, to_bar: 8, role: "intro", nth: 1, like: "A", returns: true,
      feels: "no drums", fullness: 0.68, rise: -0.02, playing: ["other"],
      stems: { drums: { is: "none", level: 0.003 }, other: { is: "full", level: 0.79 } } },
    { from_bar: 9, to_bar: 16, role: "drop", nth: 2, like: "B", returns: true,
      feels: "drums in", fullness: 0.74, rise: 0.09, playing: ["drums", "bass"],
      stems: { drums: { is: "full", level: 0.94 }, bass: { is: "full", level: 0.92 } } },
  ],
  bars: { intensity: [0.05, 0.05, 0.06, 0.05, 0.07, 0.06, 0.05, 0.05, 0.06,
                      0.90, 0.92, 0.95, 0.90, 0.93, 0.88, 0.90, 0.95, 0.90] },
};

const s = shape(RAW);
const drop = s.sections.find(x => x.name === "drop");

ok("a section per part", s.sections.length === 2, `${s.sections.length}`);
ok("from_bar -> from.bar", drop.from.bar === 9, `${drop.from.bar}`);
ok("to_bar made half-open (+1)", drop.to.bar === 17, `${drop.to.bar}`);
/* the enhancement this test pins: */
ok("section carries stems, so drum accents use real levels",
   drop.stems && drop.stems.drums && drop.stems.drums.level === 0.94,
   JSON.stringify(drop.stems));
ok("section carries nth (to tell repeated drops apart)", drop.nth === 2, `${drop.nth}`);
ok("energy comes from bars.intensity", Array.isArray(s.energy) && s.energy.length === 18);
ok("parts are kept so arranger.riseOf works", Array.isArray(s.parts) && s.parts[1].rise === 0.09);

/* idempotent: a score that already has sections passes through untouched. */
const already = { grid: {}, sections: [{ from: { bar: 1 }, to: { bar: 5 }, name: "x" }] };
ok("already-shaped score returned as-is", shape(already) === already);

let bad = 0;
for (const [pass, name, detail] of out) {
  console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
  if (!pass) bad++;
}
console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
