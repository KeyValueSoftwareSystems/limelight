/* wire.js tests -- intents -> 41-channel DMX frames, the one place the wire rules
   live for bake.js and preview.js alike: drivers per fixture, display gamma on the
   intensity channels, and the head's pose slew-limited as ONE 16-bit value (coarse
   and fine together) and HELD when nothing drives it. Plain node idiom. */
"use strict";
const W = require("./wire.js");
const layout = require("./arc4-head.layout.json");

const out = [];
const ok = (name, cond, detail) => out.push([!!cond, name, detail || ""]);
const head = layout.fixtures.find(f => f.type === "head13");
const PI = head.address - 1, TI = head.address + 1;     // coarse pan / tilt indices (0-based)
const v16 = (f, i) => f[i] * 256 + f[i + 1];              // the pose as one 16-bit number

const tick = (headIntent, parIntent) => ({ t: 0, bar: 1, beat: 1, fixtures: layout.fixtures.map(f =>
  ({ id: f.id, type: f.type, intent: f.type === "head13" ? headIntent : (parIntent || { colour: [1, 0, 0], level: 1 }) })) });

/* ---- shape ------------------------------------------------------------------- */
{
  const frames = W.toLightsFrames([tick({ pan: 0.5, tilt: 0.5, level: 1 })], layout);
  ok("one tick -> one 41-channel frame", frames.length === 1 && frames[0].length === 41, `${frames.length}x${frames[0] && frames[0].length}`);
  ok("PAR colour channels carry the display gamma (1.6): half level is not half DMX",
     W.toLightsFrames([tick({ level: 0 }, { colour: [1, 1, 1], level: 0.5 })], layout)[0][1] === Math.round(255 * Math.pow(Math.round(255 * 0.5) / 255, 1.6)));
}

/* ---- the head's pose: slew-limited as one 16-bit value ------------------------- */
{
  /* park is pan 169 / tilt 127; a first tick asking for the far corner of the travel
     (pan 255, tilt 0) must approach it at 7 DMX per frame with the fine channel in step */
  const far = { pan: 1, tilt: 0, level: 1 };
  const frames = W.toLightsFrames(Array.from({ length: 20 }, () => tick(far)), layout);   // 127 -> 0 takes 19 steps of 7
  const pans = frames.map(f => v16(f, PI));
  const steps = pans.slice(1).map((v, i) => v - pans[i]);
  ok("the pan approaches its target in whole 7-DMX steps (16-bit: 7 x 256) until it arrives",
     steps.slice(0, 2).every(s => s === 7 * 256), JSON.stringify(steps.slice(0, 4)));
  ok("the fine channel never jumps on its own while the coarse is still travelling",
     frames.slice(0, 3).every(f => f[PI + 1] === 0), JSON.stringify(frames.slice(0, 3).map(f => [f[PI], f[PI + 1]])));
  const last = frames[frames.length - 1];
  ok("and it arrives exactly at the driver's value for the end of travel", last[PI] === 255 && last[PI + 1] === 0, `${last[PI]}/${last[PI + 1]}`);
  ok("tilt travels down from park toward the floor the same way",
     frames[0][TI] === 120 && frames[1][TI] === 113 && last[TI] === 0, `${frames.map(f => f[TI]).join(",")}`);
}

/* ---- the head's pose is HELD when nothing drives it ---------------------------- */
{
  const drive = tick({ pan: 0.5, tilt: 0.5, level: 1 });
  const dark = tick({ level: 0 });                        // a blackout beat: no pan/tilt
  const frames = W.toLightsFrames([...Array.from({ length: 20 }, () => drive), dark, dark, dark], layout);
  const settled = frames[19];
  ok("an undriven frame keeps the last pan/tilt (coarse and fine)",
     frames.slice(20).every(f => f[PI] === settled[PI] && f[PI + 1] === settled[PI + 1] && f[TI] === settled[TI] && f[TI + 1] === settled[TI + 1]),
     JSON.stringify(frames.slice(19, 22).map(f => [f[PI], f[PI + 1], f[TI], f[TI + 1]])));
  ok("but the dimmer does go dark", frames[21][head.address + 4] === 0);
}

/* ---- determinism ------------------------------------------------------------- */
{
  const ticks = Array.from({ length: 5 }, (_, i) => tick({ pan: i / 4, tilt: 0.5, level: 0.7 }));
  ok("the same ticks wire identically", JSON.stringify(W.toLightsFrames(ticks, layout)) === JSON.stringify(W.toLightsFrames(ticks, layout)));
}

for (const [pass, name, detail] of out)
  console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
const bad = out.filter(r => !r[0]).length;
console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
