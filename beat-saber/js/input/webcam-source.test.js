"use strict";
const { mapPoint, DEFAULT_CAL } = require("./webcam-source.js");
const out = [];
const ok = (n, c, d) => out.push([!!c, n, d || ""]);
const near = (a, b) => Math.abs(a - b) < 1e-6;

// Centre of the calibrated box maps to screen centre.
{
  const m = mapPoint({ x: 0.5, y: 0.5 }, DEFAULT_CAL);
  ok("box centre -> screen centre", near(m.x, 0.5) && near(m.y, 0.5), JSON.stringify(m));
}
// Sweeping the learned x-range reaches both screen edges (the whole point).
{
  const left = mapPoint({ x: 0.70, y: 0.5 }, DEFAULT_CAL);   // flipX: rx=0.30 = box min
  const right = mapPoint({ x: 0.30, y: 0.5 }, DEFAULT_CAL);  // flipX: rx=0.70 = box max
  ok("hand at box min reaches one edge", near(left.x, 0), "x=" + left.x);
  ok("hand at box max reaches other edge", near(right.x, 1), "x=" + right.x);
}
// Beyond the box, values clamp to [0,1] rather than shooting off-screen.
{
  const past = mapPoint({ x: 0.05, y: 0.05 }, DEFAULT_CAL);
  ok("out-of-box clamps to 0..1", past.x >= 0 && past.x <= 1 && past.y >= 0 && past.y <= 1, JSON.stringify(past));
}
// A learned (narrow) box still spans the full screen across its own range.
{
  const cal = { minX: 0.4, maxX: 0.6, minY: 0.45, maxY: 0.65, flipX: false, flipY: false };
  ok("narrow box min -> 0", near(mapPoint({ x: 0.4, y: 0.45 }, cal).x, 0));
  ok("narrow box max -> 1", near(mapPoint({ x: 0.6, y: 0.45 }, cal).x, 1));
  ok("narrow box mid -> 0.5", near(mapPoint({ x: 0.5, y: 0.45 }, cal).x, 0.5));
}
// flipX inverts horizontal direction.
{
  const noflip = { minX: 0, maxX: 1, minY: 0, maxY: 1, flipX: false, flipY: false };
  const flip = { minX: 0, maxX: 1, minY: 0, maxY: 1, flipX: true, flipY: false };
  ok("flipX mirrors x", near(mapPoint({ x: 0.2, y: 0.5 }, noflip).x, 0.2) &&
                        near(mapPoint({ x: 0.2, y: 0.5 }, flip).x, 0.8));
}

let failed = 0;
for (const [pass, name, detail] of out) { if (!pass) failed++; console.log(pass ? "pass" : "FAIL", name, detail); }
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
