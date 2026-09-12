"use strict";
const assert = require("assert");
const { Judge } = require("./judge.js");
const out = [];
const ok = (n, c, d) => out.push([!!c, n, d || ""]);

const note = { key: 1000, hitSec: 10.0, lane: 1, color: "blue", direction: "down" };
const down = { color: "blue", vel: { x: 0, y: 1 } };   // swinging downward

// on time, right color, right direction
{
  const r = Judge.judge(note, down, 10.0, {});
  ok("on-time down-swing hits", r.hit === true, JSON.stringify(r));
  ok("dead-on is perfect", r.grade === "perfect", r.grade);
}
// too early
{
  const r = Judge.judge(note, down, 9.7, {}); // 300ms early > 180 window
  ok("far-early swing misses on timing", r.hit === false && r.reason === "timing", JSON.stringify(r));
}
// wrong color
{
  const red = { color: "red", vel: { x: 0, y: 1 } };
  const r = Judge.judge(note, red, 10.0, {});
  ok("wrong color misses", r.hit === false && r.reason === "color", JSON.stringify(r));
}
// wrong direction (swinging up at a down note)
{
  const up = { color: "blue", vel: { x: 0, y: -1 } };
  const r = Judge.judge(note, up, 10.0, {});
  ok("wrong direction misses", r.hit === false && r.reason === "direction", JSON.stringify(r));
}
// latency offset shifts the judged time
{
  const r = Judge.judge(note, down, 9.9, { latency_ms: 100 }); // 9.9 + .1 = 10.0
  ok("latency offset is applied to judging", r.hit === true, JSON.stringify(r));
}

let failed = 0;
for (const [pass, name, detail] of out) { if (!pass) failed++; console.log(pass ? "pass" : "FAIL", name, detail); }
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
