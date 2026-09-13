"use strict";
/* Measure an effect in the baked output.
   ---------------------------------------------------------------------------
   Everything here reads frames -- the bytes that would go to the lamps. None of
   it looks at the source, because the question is whether the rig DOES the
   thing, not whether somebody wrote code intending to. */
const fs = require("fs"), path = require("path"), os = require("os");
const { execFileSync } = require("child_process");
const R = path.join(__dirname, "..");

function bakeFrames(scorePath, seed) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "measure-"));
  const out = path.join(tmp, "show.lights.json");
  execFileSync("node", [path.join(R, "readers/lights/bake.js"), scorePath, String(seed),
                        "--lights", out], { stdio: "pipe" });
  const show = JSON.parse(fs.readFileSync(out, "utf8"));
  fs.rmSync(tmp, { recursive: true, force: true });
  return show;
}

/* Where each PAR's channels sit in the frame, from the layout and the driver.
   Counting raw frame differences saturates -- at 40 frames a second something is
   always moving, so every bar scores ~73 out of 75 and nothing can be compared.
   What "busier" actually means is more HITS: more moments where a lamp jumps up. */
function parBlocks() {
  const layout = JSON.parse(fs.readFileSync(
    path.join(R, "readers/lights/arc4-head.layout.json"), "utf8"));
  const drivers = require(path.join(R, "readers/lights/drivers/index.js"));
  return (layout.fixtures || [])
    .filter(f => f.type !== "head13")
    .map(f => {
      const d = drivers.forType(f.type);
      const width = (d && (d.footprint || (d.profile && d.profile.footprint))) || 7;
      return { id: f.id, at: (f.address || 1) - 1, width };
    })
    .sort((a, b) => a.at - b.at);
}

/* a hit is a rise in a lamp's total output big enough to be seen */
function hitsPerBar(show, score, from, bars, rise = 25) {
  const g = score.grid, bpb = g.beats_per_bar || 4;
  const barSec = (60 / g.bpm) * bpb;
  const at = bar => g.first_beat_s + (bar - 1) * barSec;
  const blocks = parBlocks();
  const sum = (f, b) => {
    let t = 0;
    for (let k = b.at; k < Math.min(f.length, b.at + b.width); k++) t += f[k];
    return t;
  };
  const out = [];
  for (let b = from; b < from + bars; b++) {
    const i0 = Math.max(1, Math.round(at(b) * show.fps));
    const i1 = Math.min(show.frames.length, Math.round(at(b + 1) * show.fps));
    let n = 0;
    for (const blk of blocks) {
      for (let i = i0; i < i1; i++) {
        const prev = sum(show.frames[i - 1], blk), now = sum(show.frames[i], blk);
        if (now - prev > rise) n++;
      }
    }
    out.push({ bar: b, changes: n, frames: Math.max(0, i1 - i0) });
  }
  return out;
}

/* how many times the lamps changed during each bar of the window */
function changesPerBar(show, score, from, bars) {
  const g = score.grid, bpb = g.beats_per_bar || 4;
  const barSec = (60 / g.bpm) * bpb;
  const firstBar = g.first_bar === undefined || g.first_bar === null ? 1 : g.first_bar;
  const at = bar => g.first_beat_s + (bar - 1) * barSec;   /* bar 1 on the first downbeat */
  const out = [];
  for (let b = from; b < from + bars; b++) {
    const i0 = Math.max(0, Math.round(at(b) * show.fps));
    const i1 = Math.min(show.frames.length, Math.round(at(b + 1) * show.fps));
    let n = 0;
    for (let i = i0 + 1; i < i1; i++) {
      const a = show.frames[i - 1], c = show.frames[i];
      for (let k = 0; k < a.length; k++) if (a[k] !== c[k]) { n++; break; }
    }
    out.push({ bar: b, changes: n, frames: Math.max(0, i1 - i0) });
  }
  return out;
}


/* all four lamps identical, as a share of the instants sampled */
function unison(show, score, from, bars) {
  const blocks = parBlocks();
  const g = score.grid, bpb = g.beats_per_bar || 4;
  const barSec = (60 / g.bpm) * bpb;
  const at = bar => g.first_beat_s + (bar - 1) * barSec;
  const i0 = Math.max(0, Math.round(at(from) * show.fps));
  const i1 = Math.min(show.frames.length, Math.round(at(from + bars) * show.fps));
  const sum = (f, b) => { let t = 0;
    for (let k = b.at; k < Math.min(f.length, b.at + b.width); k++) t += f[k]; return t; };
  /* "Not identical" is too weak a test. An alternating look splits the rig into
     two halves and flips between them, which gives two distinct values and would
     pass -- but a flip is not a ripple. A wave across four lamps shows four
     different values most of the time, because the same curve reaches each lamp
     at a different point. So count how many distinct values there are. */
  let together = 0, n = 0, distinct = 0;
  for (let i = i0; i < i1; i++) {
    const v = blocks.map(b => sum(show.frames[i], b));
    const k = new Set(v).size;
    if (k === 1) together++;
    distinct += k;
    n++;
  }
  return { together, n, share: n ? together / n : 1,
           avgDistinct: n ? distinct / n : 1, lamps: blocks.length };
}

/* the longest stretch a lamp holds one level, as a share of a bar */
function motionless(show, score, from, bars) {
  const blocks = parBlocks();
  const g = score.grid, bpb = g.beats_per_bar || 4;
  const barSec = (60 / g.bpm) * bpb;
  const at = bar => g.first_beat_s + (bar - 1) * barSec;
  const sum = (f, b) => { let t = 0;
    for (let k = b.at; k < Math.min(f.length, b.at + b.width); k++) t += f[k]; return t; };
  const perBar = Math.max(1, Math.round(barSec * show.fps));
  let worst = 0;
  for (const b of blocks) {
    const i0 = Math.max(0, Math.round(at(from) * show.fps));
    const i1 = Math.min(show.frames.length, Math.round(at(from + bars) * show.fps));
    let run = 1, prev = null;
    for (let i = i0; i < i1; i++) {
      const v = sum(show.frames[i], b);
      run = v === prev ? run + 1 : 1;
      prev = v;
      if (run > worst) worst = run;
    }
  }
  return { worst, perBar, share: worst / perBar };
}

/* does a lamp move within a short window of a marked beat? */
function landsOn(show, score, marks) {
  const blocks = parBlocks();
  const g = score.grid, bpb = g.beats_per_bar || 4;
  const beatSec = 60 / g.bpm, barSec = beatSec * bpb;
  const sum = (f, b) => { let t = 0;
    for (let k = b.at; k < Math.min(f.length, b.at + b.width); k++) t += f[k]; return t; };
  const out = [];
  for (const m of marks) {
    const t = g.first_beat_s + (m.bar - 1) * barSec + ((m.beat || 1) - 1) * beatSec;
    const c = Math.round(t * show.fps), w = Math.round(0.1 * show.fps);
    let biggest = 0;
    for (let i = Math.max(1, c - w); i < Math.min(show.frames.length, c + w); i++)
      for (const b of blocks)
        biggest = Math.max(biggest, Math.abs(sum(show.frames[i], b) - sum(show.frames[i - 1], b)));
    out.push({ ...m, jump: biggest });
  }
  return out;
}

function judge(opts, print) {
  const score = JSON.parse(fs.readFileSync(opts.score, "utf8"));
  const show = bakeFrames(opts.score, opts.seed || 7);
  const rows = hitsPerBar(show, score, opts.from, opts.bars);

  if (print) {
    console.log(`\n${opts.song}, bars ${opts.from}-${opts.from + opts.bars - 1} — ${opts.effect}`);
    console.log(`measuring: ${opts.measure}\n`);
    const most = Math.max(1, ...rows.map(r => r.changes));
    for (const r of rows) {
      const bar = "#".repeat(Math.round((r.changes / most) * 40));
      console.log(`  bar ${String(r.bar).padStart(3)}  ${String(r.changes).padStart(4)}  ${bar}`);
    }
  }

  let ok = false, verdict = "";
  if (opts.check === "rising") {
    /* A build has to climb, not jump. Everything at zero until the last bar and
       then a spike is a step, and a step is what a rig does when it notices the
       drop rather than the approach -- which is the thing being tested. So the
       middle has to be above the start as well as the end above the middle. */
    const third = Math.max(1, Math.floor(rows.length / 3));
    const mean = a => a.reduce((s, r) => s + r.changes, 0) / Math.max(1, a.length);
    const a = mean(rows.slice(0, third));
    const b = mean(rows.slice(third, rows.length - third));
    const c = mean(rows.slice(-third));
    const climbs = b > a + 0.5 && c > b;
    ok = climbs && c > a * 1.25;
    verdict = `start ${a.toFixed(1)}, middle ${b.toFixed(1)}, end ${c.toFixed(1)} hits a bar`
            + (ok ? " — it climbs"
                  : b <= a + 0.5 && c > b
                    ? " — nothing until the end, so this is a step at the drop, not a build"
                    : " — flat, the build does not read");
  } else if (opts.check === "below-half") {
    const u = unison(show, score, opts.from, opts.bars);
    /* more than half the lamps distinct, on average, is a wave rather than a flip */
    ok = u.avgDistinct > u.lamps / 2;
    verdict = `${u.avgDistinct.toFixed(1)} of ${u.lamps} lamps differ at a typical instant`
            + ` (identical at ${(u.share * 100).toFixed(0)}%)`
            + (ok ? " — a wave across the rig"
                  : u.avgDistinct > 1.2 ? " — the rig flips between halves, it does not ripple"
                                        : " — they move as one");
  } else if (opts.check === "never-still") {
    const m = motionless(show, score, opts.from, opts.bars);
    ok = m.share < 0.25;
    verdict = `longest motionless stretch is ${(m.share * 100).toFixed(0)}% of a bar`
            + (ok ? " — it glides" : " — it holds and then snaps");
  } else if (opts.check === "hits") {
    const marks = ((score.signals || []).concat(score.moments || []))
      .filter(x => x.bar >= opts.from && x.bar < opts.from + opts.bars)
      .filter(x => (x.weight || 0) >= 0.6)
      .map(x => ({ bar: x.bar, beat: x.beat || 1, what: x.what || x.is, weight: x.weight }));
    const got = landsOn(show, score, marks);
    const landed = got.filter(x => x.jump >= 25);
    ok = marks.length > 0 && landed.length === marks.length;
    verdict = marks.length
      ? `${landed.length} of ${marks.length} weighted moments have a visible change within 100 ms`
        + (ok ? "" : " — " + got.filter(x => x.jump < 25)
             .map(x => `bar ${x.bar} beat ${x.beat} (${x.what})`).join(", "))
      : "no moments above weight 0.6 in this window";
  } else {
    verdict = "no automatic verdict for this effect yet";
  }
  if (print) console.log(`\n  ${ok ? "PASS" : "not yet"}  ${verdict}\n`);
  return { ok, verdict, rows };
}

function measure(opts) {
  const r = judge(opts, true);
  process.exitCode = r.ok ? 0 : 1;
  return r;
}

module.exports = { measure, judge, bakeFrames, changesPerBar, hitsPerBar, unison, motionless, landsOn };
