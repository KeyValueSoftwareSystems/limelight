/* The page draws everything by bar, and for a long time it turned a bar into a
   second by multiplying one bpm by the bar number. That is right only when a
   song holds one tempo, and thirteen of twenty-eight do not. raga-of-revenge
   runs at 89 until 17.9s and 120 after it, so the chorus the score puts at
   47.90s was drawn at 43.75s, and Amal heard the change with nothing marked
   under it. On entharo-mahanu the far end of the song was twenty seconds out.

   This lifts the page's own helpers out of the file and asks them where each
   bar falls, against the tempo map in the score. It does not reimplement them;
   a copy would have agreed with itself. */
"use strict";
const fs = require("fs"), path = require("path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "page", "ear.html"), "utf8");
const src = (html.match(/<script>([\s\S]*)<\/script>/) || [])[1] || "";

const out = [];
const ok = (n, c, d) => out.push([!!c, n, d || ""]);

/* The page can parse and still be gutted. A careless edit once removed the word
   tables, library(), load() and play() in one go; the file was still valid
   JavaScript and the browser answered "library is not defined" on a blank page.
   Anything the page calls at the bottom of the file has to exist by then. */
{
  /* The list is what the page loads through, not a frozen snapshot of its
     shape. `curves` and `lanes` were one function each drawing every lane;
     the page now draws a named row per lane, and a list naming the old two
     reported the richer page as gutted. */
  const needed = ["library", "load", "play", "tick", "sections", "zoom",
                  "broke", "wire", "draw"];
  const missing = needed.filter(n =>
    !new RegExp(`(async\\s+)?function\\s+${n}\\s*\\(`).test(src));
  ok("every function the page calls is still defined", missing.length === 0,
     missing.length ? "missing " + missing.join(", ") : `${needed.length} present`);
  const calls = [...src.matchAll(/^([a-zA-Z_$][\w$]*)\(\);$/gm)].map(m => m[1]);
  const unbound = calls.filter(n =>
    !new RegExp(`(async\\s+)?function\\s+${n}\\s*\\(`).test(src));
  ok("nothing is called at the end of the file that was never defined",
     unbound.length === 0, unbound.join(", ") || calls.join(", "));
}

const block = src.match(/let TEMPO = \[\];[\s\S]*?const barAtTime = [^\n]*\n/);
ok("the page's timeline helpers can be found", !!block,
   block ? "" : "ear.html no longer defines TEMPO/atBeat/barTime as expected");

if (block) {
  const make = score => {
    const tempo = (score.grid.tempo && score.grid.tempo.length)
      ? score.grid.tempo
      : [{ from_beat: 0, at_s: score.grid.first_beat_s, bpm: score.grid.bpm }];
    const fn = new Function("SCORE", "SHIFT", "BASE", "aud",
      block[0] + "\nTEMPO = SCORE.grid.tempo;\nreturn { barTime, barAtTime, atBeat, beatAt };");
    const scored = Object.assign({}, score,
      { grid: Object.assign({}, score.grid, { tempo }) });
    return fn(scored, 0, 0, { currentTime: 0 });
  };

  const songs = require("../protocol/fixture.js").scores();
  ok("there are scores to check the timeline against", songs.length > 0,
     songs.length + " songs");

  let mapped = 0, worst = 0, worstAt = "";
  for (const f of songs) {
    let sc;
    try { sc = JSON.parse(fs.readFileSync(f, "utf8")); } catch { continue; }
    const g = sc.grid;
    if (!Array.isArray(sc.beats) || !g) continue;
    if ((g.tempo || []).length > 1) mapped++;
    const api = make(sc);
    const per = g.beats_per_bar;
    const tempo = (g.tempo && g.tempo.length)
      ? g.tempo : [{ from_beat: 0, at_s: g.first_beat_s, bpm: g.bpm }];
    const segAt = n => {
      let k = 0;
      while (k + 1 < tempo.length && tempo[k + 1].from_beat <= n) k++;
      return tempo[k];
    };
    const truth = b => {
      const s = segAt((b - 1) * per);
      return s.at_s + ((b - 1) * per - s.from_beat) * (60 / s.bpm);
    };
    for (let b = 1; b <= g.bars; b++) {
      const gap = Math.abs(api.barTime(b) - truth(b));
      if (gap > worst) { worst = gap; worstAt = `${f.slice(0, -6)} bar ${b}`; }
    }
    const back = api.barAtTime(truth(Math.max(1, Math.floor(g.bars / 2))));
    const want = Math.max(1, Math.floor(g.bars / 2));
    if (Math.abs(back - want) > 1) {
      ok(`${f.slice(0, -6)}: the page turns a time back into the bar it came from`,
         false, `bar ${want} -> ${truth(want).toFixed(2)}s -> bar ${back}`);
    }
  }
  ok("every bar the page draws lands where the score's tempo map puts it",
     worst < 0.05, worst ? `worst ${worst.toFixed(3)}s at ${worstAt}` : "exact");
  ok("the library still contains songs that change tempo, so this can fail",
     mapped > 0, `${mapped} songs carry a tempo map`);
}

/* Every lane the scores carry has a row on the page, and every row the page
   draws is reachable. motion() used to be the one row checked here, against a
   `motion` field the pipeline stopped writing -- so the check reported the
   page as broken for not drawing data that no longer exists. */
{
  const songs = require("../protocol/fixture.js").scores();
  const carried = new Set();
  for (const f of songs) {
    let sc;
    try { sc = JSON.parse(fs.readFileSync(f, "utf8")); } catch { continue; }
    for (const k of ["sections", "moments", "emotion", "melody", "rhythm",
                     "btc_chords_raw", "stems_temporal", "lyrics"])
      if (sc[k] != null) carried.add(k);
  }
  const ROW = {
    sections: /function (sections|sectionsCanvas)\s*\(/,
    moments: /function (moments|momentsCanvas|momentsDisplay)\s*\(/,
    emotion: /function emotionTimeline\s*\(/,
    melody: /function melodyTimeline\s*\(/,
    rhythm: /function rhythmTimeline\s*\(/,
    btc_chords_raw: /function chordsCanvas\s*\(/,
    stems_temporal: /function stemsTimeline\s*\(/,
    lyrics: /function (sungWords|nowSinging|indicLyrics)\s*\(/,
  };
  const noRow = [...carried].filter(k => ROW[k] && !ROW[k].test(src));
  ok("every lane the scores carry has a row on the page", noRow.length === 0,
     noRow.length ? "no row for " + noRow.join(", ")
       : `${carried.size} lanes, all drawn`);
  ok("the library has scores to check this against", songs.length > 0,
     `${songs.length} scores`);

  /* A row that names a canvas the page never creates draws nothing and says
     nothing about it. */
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  const asked = [...src.matchAll(/\$\("([a-zA-Z0-9_-]+)"\)/g)].map(m => m[1]);
  const absent = [...new Set(asked)].filter(id => !ids.has(id));
  ok("every element the script reaches for exists in the page",
     absent.length === 0, absent.length ? "missing " + absent.slice(0, 6).join(", ")
       : `${new Set(asked).size} ids`);
}

const bad = out.filter(r => !r[0]).length;
for (const [p, n, d] of out) if (!p) console.log(`  FAIL  ${n}   ${d}`);
console.log(bad ? `\n${bad} of ${out.length} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
