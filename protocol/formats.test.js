/* Two formatters, one protocol.
   ---------------------------------------------------------------------------
   server/format/v1.js and hub/score_api.py both turn a pipeline score into what
   a reader sees, and they drifted: ticks and melody_phrases were added to the
   JS side and not the Python one, so the same song answered differently
   depending on which door a reader came through. Nothing failed -- a field
   that is absent looks exactly like a field the song does not have.

   This asks both for the same score and fails on any key only one of them
   carries. */
"use strict";
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const scorePath = path.join(root, "scores", "levels.score");
const raw = JSON.parse(fs.readFileSync(scorePath, "utf8"));

const out = [];
const ok = (n, c, d) => out.push([!!c, n, d || ""]);

(async () => {
  const mod = await import(path.join(root, "server", "format", "v1.js"));
  const fn = mod.format || mod.default;
  const js = fn(raw);

  const py = JSON.parse(execFileSync(
    path.join(root, "work", "allin1", "bin", "python"),
    ["-c", `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(root, "hub"))})
from score_api import format_v1
print(json.dumps(format_v1(json.load(open(${JSON.stringify(scorePath)})))))
`], { encoding: "utf8", maxBuffer: 1 << 28 }));

  const a = new Set(Object.keys(js).filter(k => js[k] != null));
  const b = new Set(Object.keys(py).filter(k => py[k] != null));
  const onlyJs = [...a].filter(k => !b.has(k));
  const onlyPy = [...b].filter(k => !a.has(k));

  ok("both formatters carry the same fields", onlyJs.length === 0 && onlyPy.length === 0,
     onlyJs.length || onlyPy.length
       ? `only js: ${onlyJs.join(", ") || "-"} | only py: ${onlyPy.join(", ") || "-"}`
       : `${a.size} fields on both sides`);

  /* Comparing only the top level missed that the Python formatter carried no
     section fields at all -- repeats_as, sure and trades were JS-only and the
     test said both sides agreed. A protocol is not just its outermost keys. */
  const keysOf = list => {
    const k = new Set();
    for (const row of (list || []).slice(0, 40))
      for (const [n, v] of Object.entries(row)) if (v != null) k.add(n);
    return k;
  };
  for (const part of ["sections", "moments", "melody_phrases"]) {
    const ja = keysOf(js[part]), pb = keysOf(py[part]);
    const gapJs = [...ja].filter(k => !pb.has(k));
    const gapPy = [...pb].filter(k => !ja.has(k));
    ok(`every field inside ${part} is on both sides`,
       gapJs.length === 0 && gapPy.length === 0,
       gapJs.length || gapPy.length
         ? `only js: ${gapJs.join(", ") || "-"} | only py: ${gapPy.join(", ") || "-"}`
         : `${ja.size} fields`);
  }

  for (const want of ["ticks", "groove", "melody_phrases", "weight", "floor"]) {
    ok(`${want} reaches a reader from both`, a.has(want) && b.has(want),
       `js ${a.has(want) ? "yes" : "NO"}, py ${b.has(want) ? "yes" : "NO"}`);
  }

  /* The checks above only compare fields the source score happens to carry, so a
     field neither formatter forwards reads as agreement. Every new field went in
     that blind spot at least once. This plants the fields in the score and makes
     both sides prove they carry them out again. */
  const planted = JSON.parse(JSON.stringify(raw));
  planted.mood_axes = { calm_vs_aggressive: 2.49, warm_vs_cold: 1.51 };
  for (const part of planted.parts || [])
    part.mood = { calm_vs_aggressive: -0.31, warm_vs_cold: 0.12 };
  planted.lyrics = {
    language: "English", sung_in: "phrases of the song's own grid",
    checked_twice: true, sure: 0.82,
    words: [{ text: "Once", at_s: 2.88, to_s: 3.1, bar: 1, heard_twice: true }],
    lines: [{ at_s: 2.88, to_s: 6.1, from_bar: 1, to_bar: 2, text: "Once", sure: 1 }],
  };
  planted.bars = Object.assign({}, planted.bars, {
    noisy: (planted.bars.intensity || []).map(() => 0.4),
    held: (planted.bars.intensity || []).map(() => 0.6),
  });

  const js2 = fn(planted);
  const py2 = JSON.parse(execFileSync(
    path.join(root, "work", "allin1", "bin", "python"),
    ["-c", `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(root, "hub"))})
from score_api import format_v1
print(json.dumps(format_v1(json.load(sys.stdin))))
`], { encoding: "utf8", input: JSON.stringify(planted), maxBuffer: 1 << 28 }));

  for (const want of ["mood_axes", "lyrics", "noisy", "held"]) {
    ok(`${want} survives both formatters when the score has it`,
       js2[want] != null && py2[want] != null,
       `js ${js2[want] != null ? "yes" : "NO"}, py ${py2[want] != null ? "yes" : "NO"}`);
  }
  const jsMood = (js2.sections || [])[0] || {}, pyMood = (py2.sections || [])[0] || {};
  ok("a section carries mood through both formatters",
     jsMood.mood != null && pyMood.mood != null,
     `js ${jsMood.mood != null ? "yes" : "NO"}, py ${pyMood.mood != null ? "yes" : "NO"}`);
  ok("both formatters agree on the planted score's fields too",
     JSON.stringify(Object.keys(js2).filter(k => js2[k] != null).sort())
       === JSON.stringify(Object.keys(py2).filter(k => py2[k] != null).sort()),
     `js ${Object.keys(js2).length}, py ${Object.keys(py2).length}`);
  ok("a lyric line keeps its agreement score",
     (js2.lyrics || {}).lines && js2.lyrics.lines[0].sure === 1
       && (py2.lyrics || {}).lines && py2.lyrics.lines[0].sure === 1,
     "sure survives both");

  const bad = out.filter(r => !r[0]).length;
  for (const [p, n, d] of out) if (!p) console.log(`  FAIL  ${n}   ${d}`);
  console.log(bad ? `\n${bad} of ${out.length} FAILED` : `\nall ${out.length} checks pass`);
  process.exit(bad ? 1 : 0);
})();
