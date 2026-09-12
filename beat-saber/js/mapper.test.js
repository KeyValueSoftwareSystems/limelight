"use strict";
const assert = require("assert");
const { Mapper } = require("./mapper.js");
const out = [];
const ok = (n, c, d) => out.push([!!c, n, d || ""]);

const secondsAt = (bar, beat) => bar * 2 + (beat - 1) * 0.5; // fake grid

// determinism
{
  const b = { bar: 5, beat: 3, accent: false };
  const a1 = Mapper.mapBeat(b, { difficulty: "Normal", secondsAt });
  const a2 = Mapper.mapBeat(b, { difficulty: "Normal", secondsAt });
  ok("same beat maps identically", JSON.stringify(a1) === JSON.stringify(a2), JSON.stringify(a1));
  ok("lane is 0..3", a1.lane >= 0 && a1.lane < 4, "lane " + a1.lane);
  ok("color is red or blue", a1.color === "red" || a1.color === "blue", a1.color);
  ok("direction is known", Mapper.DIRECTIONS.includes(a1.direction), a1.direction);
  ok("key matches hitSec ms", a1.key === Math.round(a1.hitSec * 1000), a1.key + "");
}
// Easy keeps only downbeats
{
  const down = { bar: 5, beat: 1, accent: true };
  const off = { bar: 5, beat: 3, accent: false };
  ok("Easy keeps downbeat", Mapper.mapBeat(down, { difficulty: "Easy", secondsAt }) !== null);
  ok("Easy drops offbeat", Mapper.mapBeat(off, { difficulty: "Easy", secondsAt }) === null);
}
// Normal keeps everything
{
  const off = { bar: 5, beat: 3, accent: false };
  ok("Normal keeps offbeat", Mapper.mapBeat(off, { difficulty: "Normal", secondsAt }) !== null);
}
// Expert mirrored note on downbeats only
{
  const down = { bar: 5, beat: 1, accent: true };
  const off = { bar: 5, beat: 2, accent: false };
  const extra = Mapper.mapExtra(down, { difficulty: "Expert", secondsAt });
  ok("Expert adds a second note on the downbeat", extra !== null && extra.key !== null);
  ok("no extra on offbeats", Mapper.mapExtra(off, { difficulty: "Expert", secondsAt }) === null);
  ok("no extra below Expert", Mapper.mapExtra(down, { difficulty: "Normal", secondsAt }) === null);
}

let failed = 0;
for (const [pass, name, detail] of out) { if (!pass) failed++; console.log(pass ? "pass" : "FAIL", name, detail); }
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
