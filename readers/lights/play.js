#!/usr/bin/env node
"use strict";
/* play.js -- pick an effect from the computed library by number and play it.
   ---------------------------------------------------------------------------
   Lists every sequence the enumeration produced for this layout (the cache
   arc4-head.matrix.json: base looks, the LLM palette, the one-shots), renders the
   chosen one for a few bars through the real renderer and wire (frame.js ->
   wire.js: drivers, gamma, the head's aim and slew), writes it beside the panel
   as preview.lights.json, and asks the running panel to load and play it. The
   same ticks are written as preview.frames.json for bridge.py.

     node readers/lights/play.js                 interactive: list, then type a number
     node readers/lights/play.js 42              play #42 and exit
     node readers/lights/play.js impact          by id
     node readers/lights/play.js --list          just the list
   Options: --bpm 128  --bars 8  --panel http://127.0.0.1:8766  --no-play  --out DIR

   In the loop: a number or an id plays; `s` stops; `l` lists again; `q` quits. */
const fs = require("fs"), path = require("path"), http = require("http"), readline = require("readline");
const { frame } = require("./frame.js");
const { toLightsFrames } = require("./wire.js");

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const flag = k => args.includes(k);
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && !["--list", "--no-play"].includes(args[i - 1])));

const HERE = __dirname;
const layout = JSON.parse(fs.readFileSync(path.join(HERE, "arc4-head.layout.json"), "utf8"));
const cache = JSON.parse(fs.readFileSync(path.join(HERE, "arc4-head.matrix.json"), "utf8"));
let palette = [];
try { palette = JSON.parse(fs.readFileSync(path.join(HERE, "arc4-head.palette.json"), "utf8")); } catch (e) { /* base only */ }
const library = Object.fromEntries(palette.map(s => [s.id, s]));
const bpm = +opt("--bpm", 128), bars = +opt("--bars", 8), fps = 40, bpb = 4;
const panel = opt("--panel", "http://127.0.0.1:8766");
/* where to write: an explicit --out, else the folder the running panel scans (its
   status reports `dirs`), else synth/out if it exists (the README's example), else
   the panel folder (the panel's default when started with no folder) */
let outDir = opt("--out", null);

/* the library, numbered: looks first (pars, head, combinations), then one-shots */
const order = { individual: 0, compound: 1, combination: 2, oneshot: 3 };
const isHeadSeq = s => (s.occupies || []).some(o => String(o).startsWith("head:")) &&
                       !(s.occupies || []).some(o => String(o).startsWith("pars:"));
const list = cache.sequences.slice().sort((a, b) => (order[a.kind] - order[b.kind]) || a.id.localeCompare(b.id));
const describe = s => (library[s.id] && library[s.id].description) ||
  (s.kind === "oneshot" ? `one-shot: ${s.gesture.fx} (${s.gesture.slot}, ${s.duration_beats} beats)` : "");
function printList() {
  let lastKind = null;
  list.forEach((s, i) => {
    if (s.kind !== lastKind) { console.log(`\n-- ${s.kind}${s.kind === "individual" ? " looks" : ""} --`); lastKind = s.kind; }
    const where = s.kind === "combination" ? "par+head" : isHeadSeq(s) ? "head" : s.kind === "oneshot" ? "fx" : "pars";
    console.log(`${String(i + 1).padStart(4)}. ${s.id.padEnd(28)} ${where.padEnd(8)} ${s.boldness.padEnd(8)} ${describe(s).slice(0, 70)}`);
  });
  console.log(`\n${list.length} effects. bpm ${bpm}, ${bars} bars.`);
}

/* a plan that shows ONE effect in its own character for `bars` bars */
function planFor(s) {
  const span = { from: { bar: 1, beat: 1 }, to: { bar: bars + 1, beat: 1 } };
  const lib = library[s.id] || {};
  const bold = s.boldness || "accent";
  const dyn = /^hold_/.test(s.id) ? { floor: 0.6, peak: 0.6, mode: "breathe" }
            : bold === "ambient" ? { floor: 0.25, peak: 0.7, mode: "breathe" }
            : { floor: 0.12, peak: 1.0, mode: "hit" };
  const par = { ...span, seq_id: s.id, layer: "par", priority: 0, occupies: s.occupies || [],
    params: { ...dyn, intensity: 1, hue: 0.5, headDim: 0.9, motion: 0.85 } };
  const head = { ...span, seq_id: s.id, layer: "head", priority: 1, occupies: s.occupies || [],
    params: { headDim: 0.9, motion: bold === "ambient" ? 0.4 : 0.85, intensity: 0.9 } };
  const a = [];
  if (s.kind === "oneshot") {
    /* a quiet base so the punctuation reads, and the one-shot every two bars */
    a.push({ ...span, seq_id: "hold_deep_blue", layer: "par", priority: 0, params: { floor: 0.15, peak: 0.3, mode: "breathe", intensity: 1 }, occupies: ["pars:level", "pars:colour"] });
    a.push({ ...span, seq_id: "head_roam_soft", layer: "head", priority: 1, params: { headDim: 0.6, motion: 0.4 }, occupies: ["head:move"] });
    const g = s.gesture || {}, dur = s.duration_beats || 1;
    for (let bar = 2; bar <= bars; bar += 2) {
      const B = (bar - 1) * bpb, len = g.slot === "span" ? Math.min(dur, 2 * bpb) : dur, start = g.slot === "before" ? B - len : B;
      const from = { bar: Math.floor(start / bpb) + 1, beat: (start % bpb) + 1 }, to = { bar: Math.floor((start + len) / bpb) + 1, beat: ((start + len) % bpb) + 1 };
      const params = { strength: 1, ...(g.params || {}) };      /* a demo shows the effect at full */
      if (g.fx === "pause") params.still = [];
      if (g.fx === "whiten") params.amount = 0.6;
      a.push({ from, to, type: g.fx, seq_id: s.id, layer: g.fx === "modulate" ? "modulate" : "fx", priority: 9, params, occupies: s.occupies || [] });
    }
  } else if (s.kind === "combination") a.push(par, head);
  else if (isHeadSeq(s)) a.push(head);
  else a.push(par);
  return { grid: { beats_per_bar: bpb }, contexts: ["drop"], assignments: a };
}

function render(s) {
  const plan = planFor(s), barSec = bpb * 60 / bpm, dur = bars * barSec, ticks = [];
  for (let i = 0; i < Math.round(dur * fps); i++) {           /* whole frames: no float creep */
    const t = i / fps, B = t / barSec * bpb, bar = Math.floor(B / bpb) + 1, beat = (B % bpb) + 1;
    const F = frame({ bar, beat }, plan, { layout, library, fps });
    ticks.push({ t: +t.toFixed(3), bar, beat: +beat.toFixed(3), fixtures: F.fixtures });
  }
  const frames = toLightsFrames(ticks, layout);
  const beats = [], downbeats = [];
  for (let b = 1; b <= bars; b++) for (let bt = 1; bt <= bpb; bt++) { const t = +(((b - 1) * bpb + bt - 1) * 60 / bpm).toFixed(3); beats.push(t); if (bt === 1) downbeats.push(t); }
  fs.mkdirSync(outDir, { recursive: true });
  const lights = path.join(outDir, "preview.lights.json"), framesOut = path.join(outDir, "preview.frames.json");
  fs.writeFileSync(lights, JSON.stringify({ rig: layout.rig || "arc4-head", style: "limelight", fps, duration: +dur.toFixed(3), tempo: bpm,
    source: "preview.wav", wav: "preview.wav", beats, downbeats, sections: [0], phases: [{ start: 0, end: +dur.toFixed(3), phase: "preview" }],
    looks: [{ start: 0, end: +dur.toFixed(3), seq_id: s.id, layer: s.kind }], moments: [], frames }));
  fs.writeFileSync(framesOut, JSON.stringify({ score: "preview:" + s.id, seed: 0, fps, from: 0, to: +dur.toFixed(3), duration: +dur.toFixed(3),
    beats, downbeats, phases: [], fixtures: (layout.fixtures || []).map(f => ({ id: f.id, type: f.type, address: f.address, universe: f.universe })), ticks }));
  return { lights, framesOut, frames: frames.length };
}

/* the panel: load the file by name from its scan folders, then play */
function getJson(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: "GET", timeout: 3000 },
      res => { let s = ""; res.on("data", d => s += d); res.on("end", () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } }); });
    req.on("error", reject); req.on("timeout", () => { req.destroy(new Error("timeout")); }); req.end();
  });
}
async function resolveOutDir() {
  if (outDir) return outDir;
  for (const base of [panel, panel.replace(":8766", ":8765")]) {
    try { const st = await getJson(base + "/api/status"); if (Array.isArray(st.dirs) && st.dirs[0]) return (outDir = st.dirs[0]); } catch (e) { /* next */ }
  }
  const synth = path.join(HERE, "..", "..", "synth", "out");
  return (outDir = fs.existsSync(synth) ? synth : path.join(HERE, "panel"));
}
function post(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), data = JSON.stringify(body || {});
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }, timeout: 4000 },
      res => { let s = ""; res.on("data", d => s += d); res.on("end", () => resolve({ status: res.statusCode, body: s })); });
    req.on("error", reject); req.on("timeout", () => { req.destroy(new Error("timeout")); });
    req.write(data); req.end();
  });
}
async function playOnPanel(lightsPath) {
  const name = path.basename(lightsPath);
  for (const base of [panel, panel.replace(":8766", ":8765")]) {
    try {
      const shown = await post(base + "/api/show", { name, force: true });
      if (shown.status !== 200) { console.log(`panel at ${base} could not load ${name}: ${shown.body.slice(0, 120)}`); continue; }
      await post(base + "/api/play", { position: 0 });
      console.log(`playing on the panel at ${base}`);
      return base;
    } catch (e) { /* try the next port */ }
  }
  console.log(`no panel answered at ${panel} (or :8765). Start it:\n  experimentation/music_sync/.venv/bin/python readers/lights/panel/server.py --no-net --port 8766\nor play on the rig directly:\n  python3 readers/lights/bridge.py ${path.join(outDir, "preview.frames.json")} --full`);
  return null;
}
async function stopOnPanel() {
  for (const base of [panel, panel.replace(":8766", ":8765")]) {
    try { await post(base + "/api/stop", {}); console.log("stopped"); return; } catch (e) { /* next */ }
  }
}

function pick(token) {
  const n = parseInt(token, 10);
  if (!isNaN(n) && n >= 1 && n <= list.length) return list[n - 1];
  return list.find(s => s.id === token) || null;
}
async function playToken(token) {
  const s = pick(token);
  if (!s) { console.log(`no effect "${token}" (1..${list.length} or an id)`); return; }
  await resolveOutDir();
  const r = render(s);
  console.log(`rendered #${list.indexOf(s) + 1} ${s.id} (${s.kind}, ${s.boldness}): ${r.frames} frames, ${bars} bars @ ${bpm} bpm -> ${path.relative(process.cwd(), r.lights)}`);
  if (!flag("--no-play")) await playOnPanel(r.lights);
}

(async () => {
  if (flag("--list")) { printList(); return; }
  if (positional.length) { await playToken(positional[0]); return; }
  printList();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = () => rl.question("\neffect number (or id; s stop, l list, q quit) > ", async ans => {
    const t = ans.trim();
    if (t === "q") { rl.close(); return; }
    if (t === "l") printList();
    else if (t === "s") await stopOnPanel();
    else if (t) await playToken(t);
    ask();
  });
  ask();
})();
