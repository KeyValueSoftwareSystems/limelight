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
  planted.curve_tells = { intensity: 2.83, brightness: 0.92, noisy: 1.48, held: 1.81,
                          weight: 3.02, floor: 2.36 };
  planted.bars = Object.assign({}, planted.bars, {
    noisy: (planted.bars.intensity || []).map(() => 0.4),
    held: (planted.bars.intensity || []).map(() => 0.6),
  });
  if (Array.isArray(planted.parts) && planted.parts.length) {
    planted.parts.forEach((q, i) => {
      q.edge = i === 0 ? null : 1.5 + i;
      q.sudden = i === 0 ? null : 0.4 + i * 0.3;
    });
  }
  planted.releases = [{ beat_index: 34, at_s: 19.86, lead_beats: 16, size: 0.82, bar: 8, beat: 3 }];
  planted.motion = {
    per: "bar", from_bar: 1,
    moving: ["steady", "rising", "rising", "falling"],
    winding: [0.1, 0.4, 0.9, 0.2],
    spans: [{ from_bar: 1, to_bar: 1, doing: "steady" },
            { from_bar: 2, to_bar: 3, doing: "rising" },
            { from_bar: 4, to_bar: 4, doing: "falling" }],
    tells: 73.4,
    slams: [{ bar: 3, by: 0.68, big: true }],
    ebbs: [{ bar: 4, by: 0.59, big: true }],
  };

  const js2 = fn(planted);
  const py2 = JSON.parse(execFileSync(
    path.join(root, "work", "allin1", "bin", "python"),
    ["-c", `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(root, "hub"))})
from score_api import format_v1
print(json.dumps(format_v1(json.load(sys.stdin))))
`], { encoding: "utf8", input: JSON.stringify(planted), maxBuffer: 1 << 28 }));

  for (const want of ["mood_axes", "lyrics", "noisy", "held", "motion"]) {
    ok(`${want} survives both formatters when the score has it`,
       js2[want] != null && py2[want] != null,
       `js ${js2[want] != null ? "yes" : "NO"}, py ${py2[want] != null ? "yes" : "NO"}`);
  }
  ok("a curve carries how much it tells you on this song, through both formatters",
     (js2.curves || {}).brightness && js2.curves.brightness.tells === 0.92
       && (py2.curves || {}).brightness && py2.curves.brightness.tells === 0.92,
     `js ${(js2.curves || {}).brightness?.tells}, py ${(py2.curves || {}).brightness?.tells}`);

  /* A lane travels as a bare array for the readers that already read it that
     way, so its reliability rides alongside in `tells` rather than inside. It
     has to reach a reader: on Levels brightness scores 0.99, which is below the
     point where it means anything, and a reader holding the bare array had no
     way to find that out. */
  for (const side of [["js", js2], ["py", py2]]) {
    const [who, doc] = side;
    ok(`${who}: every bare lane it sends has its reliability in tells`,
       !!doc.tells && ["energy", "brightness", "weight", "floor", "noisy", "held"]
         .every(n => doc.tells[n] !== undefined),
       doc.tells ? Object.keys(doc.tells).length + " lanes" : "no tells at all");
  }
  ok("both formatters agree on what each lane tells you",
     JSON.stringify(js2.tells) === JSON.stringify(py2.tells),
     JSON.stringify(js2.tells || {}).slice(0, 60));
  ok("energy carries its own reliability too",
     (js2.energy || {}).tells !== undefined && (py2.energy || {}).tells !== undefined,
     `js ${(js2.energy||{}).tells}, py ${(py2.energy||{}).tells}`);

  ok("a section says how much its boundary is worth, through both formatters",
     (js2.sections || []).some(x => x.edge !== undefined)
       && (py2.sections || []).some(x => x.edge !== undefined)
       && JSON.stringify((js2.sections || []).map(x => x.edge))
          === JSON.stringify((py2.sections || []).map(x => x.edge)),
     `js ${JSON.stringify((js2.sections || []).map(x => x.edge))}`);

  ok("a section says whether its boundary is a step or a ramp, through both formatters",
     (js2.sections || []).some(x => x.sudden !== undefined)
       && JSON.stringify((js2.sections || []).map(x => x.sudden))
          === JSON.stringify((py2.sections || []).map(x => x.sudden)),
     `js ${JSON.stringify((js2.sections || []).map(x => x.sudden))}`);

  ok("a release keeps the beat and the second the score measured, both sides",
     JSON.stringify(js2.releases) === JSON.stringify(py2.releases)
       && (js2.releases || []).every(r => r.at_s !== undefined),
     `js ${JSON.stringify((js2.releases || []).slice(0, 2))}`);

  ok("both formatters send the same motion track",
     JSON.stringify(js2.motion) === JSON.stringify(py2.motion),
     `js ${JSON.stringify(js2.motion || {}).slice(0, 50)}`);
  ok("motion says which way the loudness is going, per bar",
     Array.isArray((js2.motion || {}).moving)
       && js2.motion.moving.length === planted.motion.moving.length
       && js2.motion.moving.every(x => ["rising", "steady", "falling"].includes(x)),
     `${(js2.motion || {}).moving}`);
  ok("motion carries the build and how much it is worth on this song",
     Array.isArray((js2.motion || {}).winding) && typeof js2.motion.tells === "number"
       && Array.isArray(py2.motion.winding) && typeof py2.motion.tells === "number",
     `js tells ${(js2.motion || {}).tells}, py tells ${(py2.motion || {}).tells}`);
  ok("a structural slam and a structural ebb are both marked big",
     (js2.motion.slams || []).some(x => x.big === true)
       && (js2.motion.ebbs || []).some(x => x.big === true),
     `slams ${JSON.stringify(js2.motion.slams)} ebbs ${JSON.stringify(js2.motion.ebbs)}`);

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

  /* Which bar a beat is in, checked against the grid that decides where bars
     start, for every song rather than the one fixture.

     Two rules were shipped and both were wrong. Counting idx/beats_per_bar
     assumes a song opens on a downbeat, and thirteen of twenty-eight open with
     a pickup: on Levels the first downbeat is beat index 2, so every bar began
     two beats early. Walking the tracker's downbeat flags fixed that and
     drifted instead -- the flags are not reliably one in four, and on Cipher
     the walk counted 274 bars where the grid says 337, so the beats and the
     sections stopped agreeing about what bar 200 was.

     pulse.py decides which grid beat a detected beat is by rounding
     (t - first_beat_s) / period, and that is the rule here, read through the
     tempo map. A tracker hears a bar of three or five now and then, so a
     handful of beats land a slot out; a numbering error puts every beat out,
     not five in five hundred. */
  {
    const dir = path.join(root, "scores");
    const songs = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter(x => x.endsWith(".score")).sort() : [];
    let checked = 0, adrift = [], dupes = [], noOne = [], torn = [];
    let allBeats = 0, allBumps = 0;
    const firstOf = sc => (sc.grid.first_bar !== undefined && sc.grid.first_bar !== null)
      ? sc.grid.first_bar : null;
    for (const f of songs) {
      let sc;
      try { sc = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
      if (!Array.isArray(sc.beats) || !sc.beats.length || !sc.grid) continue;
      const got = fn(sc);
      if (!Array.isArray(got.beats)) continue;
      checked++;
      const g = sc.grid, per = g.beats_per_bar || 4;
      const map = (Array.isArray(g.tempo) && g.tempo.length)
        ? g.tempo : [{ from_beat: 0, at_s: g.first_beat_s, bpm: g.bpm }];
      const beatNo = at => {
        let k = 0;
        while (k + 1 < map.length && map[k + 1].at_s <= at) k++;
        const s = map[k];
        return s.from_beat + (at - s.at_s) / (60 / s.bpm);
      };
      let drift = 0, seen = new Set(), prev = -Infinity, bumps = 0;
      got.beats.forEach((e, i) => {
        const key = e.bar + ":" + e.beat, rank = e.bar * 1000 + e.beat;
        if (seen.has(key) || rank < prev) bumps++;
        seen.add(key);
        prev = rank;
        const at = sc.beats[i] && sc.beats[i].t;
        if (at == null) return;
        const n = Math.round(beatNo(at));
        if (n < 0) return;
        const bar = 1 + Math.floor(n / per), beat = 1 + (((n % per) + per) % per);
        if (e.bar !== bar || e.beat !== beat) drift++;
      });
      allBeats += got.beats.length;
      allBumps += bumps;
      if (bumps) dupes.push(`${f.slice(0, -6)} ${bumps}`);
      /* Where the tracker lost the beat entirely there is nothing to number.
         Cipher's list has 238 holes wider than a beat and a's 160; a song whose
         list is unbroken has none, and on those the grid rule has to hold
         exactly. The score already says which is which, in grid.sure and in the
         striping the page draws over the guessed stretches. */
      const period = 60 / (g.bpm || 120);
      let holes = 0;
      for (let i = 1; i < sc.beats.length; i++) {
        if (sc.beats[i].t - sc.beats[i - 1].t > period * 1.5) holes++;
      }
      if (drift) adrift.push(`${f.slice(0, -6)} ${drift}/${got.beats.length}`);
      if (holes > 0) torn.push(`${f.slice(0, -6)} ${holes}`);
      const pickup = firstOf(sc);
      const hasPickup = pickup != null && got.beats.some(e => e.bar === pickup);
      if (hasPickup && !got.beats.some(e => e.bar === pickup && e.beat === 1)) {
        noOne.push(`${f.slice(0, -6)} pickup bar ${pickup} has no beat one`);
      }
    }
    ok("every beat lands in the bar the grid puts it in, wherever the beat was found",
       checked > 0 && adrift.length === 0,
       adrift.length ? adrift.slice(0, 4).join(", ")
         : `${checked} songs, ${torn.length} of them with holes in the beat list`);
    /* Two beats land in one grid slot where the tracker heard an extra, and a
       bar with two of them has two beat ones. That is the recording, not the
       rule: it happens forty-six times in twelve thousand beats, all on songs
       whose grid the score already doubts. A rule that has come loose does it
       thousands of times -- the clamp tried before this one put 394 beats out
       on a single song -- so the guard is the rate across the library, not a
       threshold invented per song. */
    const rate = allBeats ? allBumps / allBeats : 0;
    ok("beats collide only where the recording makes them",
       rate < 0.01,
       `${allBumps} in ${allBeats} beats (${(rate * 100).toFixed(2)}%)`
         + (dupes.length ? ` \u00b7 ${dupes.slice(0, 3).join(", ")}` : ""));
    ok("the pickup bar, where a song has one, is numbered from its first beat",
       noOne.length === 0, noOne.slice(0, 4).join(", ") || "clean");
  }

  const bad = out.filter(r => !r[0]).length;
  for (const [p, n, d] of out) if (!p) console.log(`  FAIL  ${n}   ${d}`);
  console.log(bad ? `\n${bad} of ${out.length} FAILED` : `\nall ${out.length} checks pass`);
  process.exit(bad ? 1 : 0);
})();
