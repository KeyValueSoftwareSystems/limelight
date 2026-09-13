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
  const needed = ["library", "load", "play", "tick", "curves", "sections",
                  "lanes", "tune", "beatGrid", "zoom", "broke"];
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

  const dir = path.join(root, "scores");
  const songs = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => f.endsWith(".score")).sort() : [];
  ok("there are scores to check the timeline against", songs.length > 0,
     songs.length + " songs");

  let mapped = 0, worst = 0, worstAt = "";
  for (const f of songs) {
    let sc;
    try { sc = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
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

{
  const body = src.match(/function motion\(\)\s*\{[\s\S]*?\n\}/);
  ok("the page has a motion row to draw", !!body, body ? "found" : "motion() is gone");
  if (body) {
    let drew = 0, said = "", labels = [];
    const dir = path.join(root, "scores");
    const songs = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter(f => f.endsWith(".score")).sort() : [];
    for (const f of songs) {
      const score = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      if (!score.motion) continue;
      const g = score.grid;
      const ctx = new Proxy({}, { get: (t, k) => {
        if (k === "fillRect") return () => drew++;
        if (k === "fillText") return (x) => labels.push(x);
        if (k === "measureText") return () => ({ width: 10 });
        return () => undefined;
      }, set: () => true });
      const saysEl = { textContent: "", innerHTML: "" };
      const atB = n => { const t = g.tempo || [{ from_beat: 0, at_s: g.first_beat_s, bpm: g.bpm }];
        let k = 0; while (k + 1 < t.length && t[k + 1].from_beat <= n) k++;
        return t[k].at_s + (n - t[k].from_beat) * (60 / t[k].bpm); };
      const env = {
        SCORE: score, FIRSTBAR: g.first_bar, BAR: 60 / g.bpm * g.beats_per_bar,
        VIEW: { a: 0, b: score.song.length_s },
        barTime: b => atB((b - g.first_bar) * g.beats_per_bar),
        frac: t => t / score.song.length_s,
        fit: () => [ctx, 1200],
        $: id => (id === "motionsays" ? saysEl : { height: 0, style: {} }),
      };
      try {
        new Function(...Object.keys(env), body[0] + "; return motion;")(...Object.values(env))();
      } catch (e) {
        ok(`${f.slice(0, -6)}: the motion row draws without throwing`, false, e.message);
      }
      said = saysEl.innerHTML || saysEl.textContent;
    }
    ok("the motion row draws a band for the bars of every song", drew > 0, `${drew} bars`);
    ok("the motion row labels both what it shows",
       labels.includes("DOING") && labels.includes("BUILD"), labels.join(","));
    ok("the motion row says how much its build is worth on this song",
       /percentile|no reliability/.test(said), said.replace(/<[^>]+>/g, "").slice(0, 70));
  }
}

const bad = out.filter(r => !r[0]).length;
for (const [p, n, d] of out) if (!p) console.log(`  FAIL  ${n}   ${d}`);
console.log(bad ? `\n${bad} of ${out.length} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
