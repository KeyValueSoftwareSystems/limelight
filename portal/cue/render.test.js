"use strict";
const R = require("./render.js");
const E = require("./engine.js");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  fail++;
  console.log("  FAIL " + name + (extra ? "  " + extra : ""));
}
function eq(name, a, b) { ok(name, a === b, `got ${a}, want ${b}`); }

const score = {
  song: { length_s: 20 },
  grid: { beats_per_bar: 4 },
  beats: Array.from({ length: 41 }, (_, i) => ({ t: +(i * 0.5).toFixed(3), downbeat: i % 4 === 0 })),
};
const rig = E.loadRig("arc4-head");
const OFF = rig.lamps.map((f) => f.offset);
const lum = (f, o) => f[o + 1] * 0.299 + f[o + 2] * 0.587 + f[o + 3] * 0.114;

const palette = { red: "#ff0000", blue: "#0000ff", white: "#ffffff" };

{
  const out = R.render({ palette, cues: [
    { at: { bar: 1 }, fade: 0, look: { lamps: { c: "red", l: 1 } } },
  ] }, score, "arc4-head");
  eq("frame count", out.frames.length, 800);
  const f = out.frames[200];
  ok("red is red", f[OFF[0] + 1] === 255 && f[OFF[0] + 2] === 0 && f[OFF[0] + 3] === 0,
    `${f[OFF[0] + 1]},${f[OFF[0] + 2]},${f[OFF[0] + 3]}`);
  let changes = 0;
  for (let i = 1; i < out.frames.length; i++) {
    if (OFF.some((o) => Math.abs(lum(out.frames[i], o) - lum(out.frames[i - 1], o)) > 2)) changes++;
  }
  eq("a single cue never moves after it lands", changes, 0);
}

{
  const out = R.render({ palette, cues: [
    { at: { bar: 1 }, fade: 0, look: { lamps: { c: "red", l: 1 } } },
    { at: { bar: 3 }, fade: 0, look: { lamps: { c: "blue", l: 1 } } },
  ] }, score, "arc4-head");
  let changes = 0;
  for (let i = 1; i < out.frames.length; i++) {
    if (OFF.some((o) => [1, 2, 3].some((c) => Math.abs(out.frames[i][o + c] - out.frames[i - 1][o + c]) > 2))) changes++;
  }
  eq("two snap cues make exactly one visible change", changes, 1);
  const at3 = Math.round(E.makeGrid(score).secondsAt(3, 1) * 40);
  eq("the change lands on the cue", out.frames[at3][OFF[0] + 3], 255);
  eq("and not one frame early", out.frames[at3 - 1][OFF[0] + 1], 255);
}

{
  const out = R.render({ palette, cues: [
    { at: { bar: 1 }, fade: 0, look: { lamps: { c: "red", l: 1 } } },
    { at: { bar: 3 }, fade: 1.0, look: { lamps: { c: "red", l: 0 } } },
  ] }, score, "arc4-head");
  const t3 = E.makeGrid(score).secondsAt(3, 1);
  const a = out.frames[Math.round(t3 * 40) + 1][OFF[0] + 1];
  const mid = out.frames[Math.round((t3 + 0.5) * 40)][OFF[0] + 1];
  const end = out.frames[Math.round((t3 + 1.05) * 40)][OFF[0] + 1];
  ok("a 1s fade is still high just after the trigger", a > 200, String(a));
  ok("half way it is about half", mid > 90 && mid < 165, String(mid));
  eq("and reaches zero", end, 0);
}

{
  const cues = [{ at: { bar: 1 }, fade: 0, look: { lamps: { c: "white", l: 1 } },
    chase: { on: "lamps", figure: "sweep", every: { bars: 1 }, low: 0 } }];
  const out = R.render({ palette, cues }, score, "arc4-head");
  const g = E.makeGrid(score);
  const lit = (t) => OFF.map((o) => lum(out.frames[Math.round(t * 40)], o) > 20).filter(Boolean).length;
  eq("a sweep lights one lamp at a time", lit(g.secondsAt(1, 1) + 0.1), 1);
  eq("still one a bar later", lit(g.secondsAt(2, 1) + 0.1), 1);
  let steps = 0, quiet = 99;
  for (let i = 1; i < out.frames.length; i++) {
    const moved = OFF.some((o) => Math.abs(lum(out.frames[i], o) - lum(out.frames[i - 1], o)) > 20);
    if (moved && quiet >= 4) steps++;
    quiet = moved ? 0 : quiet + 1;
  }
  ok("a 1-bar sweep over 20s steps about 9 times, not 800", steps >= 6 && steps <= 12, String(steps));

  let eased = 0;
  for (let i = 2; i < out.frames.length; i++) {
    const a = lum(out.frames[i - 1], OFF[0]) - lum(out.frames[i - 2], OFF[0]);
    const b = lum(out.frames[i], OFF[0]) - lum(out.frames[i - 1], OFF[0]);
    if (Math.abs(a) > 8 && Math.abs(b) > 8 && a * b > 0) eased++;
  }
  ok("a chase step eases rather than snapping", eased > 0, String(eased));
}

{
  const cues = [{ at: { bar: 1 }, fade: 0, look: { lamps: { c: "white", l: 1 } },
    chase: { on: "lamps", figure: "alternate", every: { beats: 2 }, low: 0 } }];
  const out = R.render({ palette, cues }, score, "arc4-head");
  const g = E.makeGrid(score);
  const at = (t) => OFF.map((o) => lum(out.frames[Math.round(t * 40)], o) > 20);
  const a = at(g.secondsAt(1, 1) + 0.1), b = at(g.secondsAt(1, 3) + 0.1);
  ok("alternate swaps halves", a.join() !== b.join(), a.join() + " vs " + b.join());
  eq("half the rig at a time", a.filter(Boolean).length, 2);
}

{
  const out = R.render({ palette, cues: [
    { at: { bar: 1 }, fade: 0, look: { outer: { c: "red", l: 1 } } },
  ] }, score, "arc4-head");
  const f = out.frames[100];
  const on = OFF.map((o) => lum(f, o) > 20);
  eq("outer lights the ends", on.join(), "true,false,false,true");
}

{
  const out = R.render({ palette, cues: [
    { at: { bar: 1 }, fade: 0, look: { centre: { c: "red", l: 1 } } },
  ] }, score, "arc4-head");
  const on = OFF.map((o) => lum(out.frames[100], o) > 20);
  eq("centre of an even row is the middle pair", on.join(), "false,true,true,false");
}

{
  const out = R.render({ palette, cues: [
    { at: { second: 2 }, fade: 0, look: { lamps: { c: "red", l: 1 } } },
  ] }, score, "arc4-head");
  ok("before the first cue the rig is dark", lum(out.frames[40], OFF[0]) < 1);
  ok("and lit after it", lum(out.frames[100], OFF[0]) > 50);
}

{
  const out = R.render({ palette, cues: [
    { at: { bar: 1 }, fade: 0, look: { heads: { c: "white", l: 1, pan: 0.0, tilt: 0.5 } } },
    { at: { bar: 2 }, fade: 0, look: { heads: { c: "white", l: 1, pan: 1.0, tilt: 0.5 } } },
  ] }, score, "arc4-head");
  const h = rig.movers[0];
  const g = E.makeGrid(score);
  const i0 = Math.round(g.secondsAt(2, 1) * 40);
  const jump = Math.abs(out.frames[i0 + 1][h.offset + h.ch.pan] - out.frames[i0][h.offset + h.ch.pan]);
  ok("the head still cannot teleport across the bar", jump <= 8, String(jump));
}

console.log(fail === 0 ? `  all ${pass} checks pass` : `  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
