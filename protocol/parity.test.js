/* The two halves of the protocol must answer identically.
   ---------------------------------------------------------------------------
   session.js and session.py read the same score. If they disagree by a bar,
   the lights and the page are describing different songs and nothing anywhere
   reports a fault -- which is exactly how two scores for Levels stayed 9.89
   beats apart for a week. So this runs both against the same file, at times
   chosen to land on the awkward places (before the first beat, exactly on a
   bar line, a hair either side of one, deep into the song), and fails on the
   first character of difference. */
"use strict";
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const { Session } = require("./session.js");

const scorePath = process.argv[2] || path.join(__dirname, "..", "scores", "levels.score");
const score = JSON.parse(fs.readFileSync(scorePath, "utf8"));

/* the awkward places, not a tidy sweep: a tidy sweep never lands on a boundary */
const s0 = Session(score, { now: () => 0 });
const bar = b => s0.secondsAt(b, 1);
const times = [0, 0.001, 0.5, bar(2) - 1e-4, bar(2), bar(2) + 1e-4,
               bar(5), bar(17), bar(33) - 0.0005, bar(33), bar(33) + 0.0005,
               bar(61), 60, 61.9, 123.456, 200];

function fromJs() {
  return times.map(t => {
    const s = Session(score, { songTime: () => t });
    return { t, now: s.now(), next: s.next(2000), until_form: s.until("form") };
  });
}

const py = `
import json, sys
sys.path.insert(0, ${JSON.stringify(__dirname)})
import session
score = json.load(open(${JSON.stringify(scorePath)}))
out = []
for t in ${JSON.stringify(times)}:
    s = session.Session(score, song_time=lambda t=t: t)
    out.append({"t": t, "now": s.now(), "next": s.next(2000), "until_form": s.until("form")})
json.dump(out, sys.stdout)
`;

const out = [];
const ok = (n, c, d) => out.push([!!c, n, d || ""]);

let a, b;
try {
  a = fromJs();
  b = JSON.parse(execFileSync("python3", ["-c", py], { maxBuffer: 64 << 20 }).toString());
} catch (e) {
  console.log("could not run both halves: " + (e.stderr ? e.stderr.toString() : e.message));
  process.exit(2);
}

ok("both halves answered for every probe time", a.length === b.length && a.length === times.length,
   `${a.length} vs ${b.length}`);

/* Compare as values rather than as JSON text: undefined and null are the same
   absence here, and one language spelling it differently is not a real
   disagreement about the music. */
function diff(x, y, at) {
  if (x === y) return null;
  const nil = v => v === null || v === undefined;
  if (nil(x) && nil(y)) return null;
  if (typeof x === "number" && typeof y === "number")
    return Math.abs(x - y) < 1e-9 ? null : `${at}: ${x} vs ${y}`;
  if (nil(x) || nil(y) || typeof x !== typeof y) return `${at}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`;
  if (typeof x !== "object") return `${at}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`;
  if (Array.isArray(x) !== Array.isArray(y)) return `${at}: array vs object`;
  if (Array.isArray(x) && x.length !== y.length) return `${at}: ${x.length} items vs ${y.length}`;
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
    const d = diff(x[k], y[k], at + "." + k);
    if (d) return d;
  }
  return null;
}

let bad = 0, firstBad = "";
for (let i = 0; i < a.length; i++) {
  const d = diff(a[i], b[i], `t=${times[i]}`);
  if (d) { bad++; if (!firstBad) firstBad = d; }
}
ok("every answer is identical in both languages", bad === 0,
   bad ? `${bad} of ${a.length} probes differ, first: ${firstBad}` : `${a.length} probes`);

/* A parity check passes trivially if it is comparing nothing, so prove it is
   looking at real answers rather than a pair of empty objects. */
const anyBeats = a.some(r => r.next.some(e => e.bar !== undefined && e.what === undefined));
const anySection = a.some(r => r.now.sections && r.now.sections.form);
ok("the probes actually cover beats", anyBeats);
ok("and sections", anySection);

const fails = out.filter(r => !r[0]);
for (const [p, n, d] of out) if (!p) console.log(`  FAIL  ${n}   ${d}`);
console.log(fails.length ? `\n${fails.length} of ${out.length} FAILED`
                         : `\nall ${out.length} checks pass  (${times.length} probes, both languages)`);
process.exit(fails.length ? 1 : 0);
