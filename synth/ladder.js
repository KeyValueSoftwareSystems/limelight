#!/usr/bin/env node
/* Run the whole ladder on every song, with no human in it.
   ----------------------------------------------------------------------------
   Renjith asked whether the ladder can be checked automatically and accurately,
   setting taste aside. It can, for the part of it that is correctness: every rung
   carries a measurement against the RECORDING rather than against the map, and
   those measurements do not need eyes.

   What this does NOT tell you is whether the show is good. It tells you whether
   the show is wrong, which is a different and much more checkable question.

   Uses readers/src/checks.js -- the same file build.html uses -- so a green
   result here means the same thing as a green result on the page.

     node synth/ladder.js                 every song, every rung
     node synth/ladder.js levels          one song
     node synth/ladder.js --parts levels  and each part of the song separately
*/
const fs = require("fs"), path = require("path");
const ROOT = path.dirname(__dirname);
const { makeChecks, RUNGS } = require(path.join(ROOT, "readers/src/checks.js"));

const HZ = 50;
const read = p => JSON.parse(fs.readFileSync(p, "utf8"));

/* the recording's own envelope, which is what the non-circular checks compare to */
function wave(file) {
  const b = fs.readFileSync(file);
  let off = 12, sr = 44100, ch = 1, dataOff = 44, dataLen = b.length - 44;
  while (off < b.length - 8) {
    const id = b.toString("ascii", off, off + 4), sz = b.readUInt32LE(off + 4);
    if (id === "fmt ") { ch = b.readUInt16LE(off + 10); sr = b.readUInt32LE(off + 12) }
    if (id === "data") { dataOff = off + 8; dataLen = sz; break }
    off += 8 + sz + (sz & 1);
  }
  const n = Math.floor(dataLen / 2), hop = Math.max(1, Math.round(sr / 200));
  const al = Math.exp(-2 * Math.PI * 130 / sr);
  const peak = [], low = [];
  let y = 0;
  for (let i = 0; i + hop * ch < n; i += hop * ch) {
    let p = 0, lp = 0;
    for (let j = 0; j < hop * ch; j += ch) {
      const v = b.readInt16LE(dataOff + (i + j) * 2);
      y = (1 - al) * v + al * y;
      const av = Math.abs(v); if (av > p) p = av;
      const ay = Math.abs(y); if (ay > lp) lp = ay;
    }
    peak.push(p); low.push(lp);
  }
  const mx = Math.max(...peak) || 1, mx2 = Math.max(...low) || 1;
  return { dt: hop / sr, peak: peak.map(v => v / mx), low: low.map(v => v / mx2) };
}

function light(F, map) {
  const D = (map.song && map.song.length) || 240, n = Math.floor(D * HZ);
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const o of F(i / HZ).fixtures) if ("level" in o && !/^fog/.test(o.id)) s += o.level;
    v[i] = s;
  }
  return { v, max: Math.max(...v) || 1 };
}

const RECIPE = fs.readFileSync(path.join(ROOT, "readers/src/recipe_steps.js"), "utf8");
const ROOMJS = fs.readFileSync(path.join(ROOT, "synth/room.js"), "utf8");
const RM = new Function("RECIPE", ROOMJS + "\n;return {mkReader,prep};")(RECIPE);

function songs() {
  const out = {};
  for (const [dir, kind] of [["synth/truth", "record"], ["synth/songs", "made up"]]) {
    const d = path.join(ROOT, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (!f.endsWith(".map.json")) continue;
      const slug = f.slice(0, -9);
      const wav = path.join(ROOT, "synth/out", slug + ".wav");
      if (fs.existsSync(wav)) out[slug] = { map: path.join(d, f), wav, kind };
    }
  }
  return out;
}

const args = process.argv.slice(2);
const wantParts = args.includes("--parts");
const only = args.filter(a => !a.startsWith("--"));
const LAY = read(path.join(ROOT, "readers/lights/small/layout.json"));
const LAYB = read(path.join(ROOT, "readers/lights/beat/layout.json"));

let pass = 0, fail = 0, skip = 0;
const rows = [];
for (const [slug, s] of Object.entries(songs())) {
  if (only.length && !only.includes(slug)) continue;
  const map = read(s.map);
  if (!map.beats || map.beats.length < 8) { console.log(`${slug}: no beats`); continue }
  const W = wave(s.wav);
  process.stdout.write(`\n${slug}  (${s.kind})\n`);
  for (const r of RUNGS) {
    const lay = r.n >= 11 ? LAY : LAYB;
    const F = RM.mkReader(map, lay, process.env.ENERGY || "medium", "garrix", r.n);
    const C = makeChecks({ MAP: map, LAY: lay, F, LIGHT: light(F, map), WAVE: W, HZ });
    let res; try { res = C.runCheck(r.n) } catch (e) { res = { ok: false, v: 0, txt: "threw: " + e.message } }
    if (res.na) skip++; else res.ok ? pass++ : fail++;
    rows.push({ slug, n: r.n, name: r.name, ok: res.ok, na: !!res.na, v: res.v, txt: res.txt });
    console.log(`  ${r.n} ${r.name.padEnd(15)} ${res.na ? "--  " : res.ok ? "ok  " : "FAIL"}  ${res.txt}`);
    if (wantParts && map.chapters) {
      const chs = map.chapters, D = (map.song && map.song.length) || 240;
      for (let i = 0; i < chs.length; i++) {
        const t0 = chs[i].at, t1 = (i + 1 < chs.length) ? chs[i + 1].at : D;
        if (t1 - t0 < 2) continue;
        let p; try { p = C.runCheck(r.n, t0, t1) } catch (e) { p = { ok: false, txt: "threw" } }
        if (!p.ok && !p.na) console.log(`        ${chs[i].name.padEnd(10)} ${t0.toFixed(0)}s  ${p.txt}`);
      }
    }
  }
}
console.log(`\n${pass} ok, ${fail} failed, ${skip} with nothing to measure, across `
  + `${new Set(rows.map(r => r.slug)).size} songs`);
fs.writeFileSync(path.join(ROOT, "synth/learning/ladder-check.json"),
  JSON.stringify({ when: new Date().toISOString(), pass, fail, skip, rows }, null, 1) + "\n");
process.exit(fail ? 1 : 0);
