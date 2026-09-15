"use strict";
/* compare.js -- the same show on two rigs, measured and drawn.
   ---------------------------------------------------------------------------
   The claim this exists to test: a show made on a small rig plays correctly at
   any venue, and a bigger rig gives a bigger show -- SAME FILE, no edits. A show
   is {score, seed, edits}; the venue re-derives the plan against its own layout.
   So: bake the same score at the same seed against two layouts, put the two
   bakes beside each other, and count.

     node readers/lights/compare.js [score] [seed] [--layout FILE] [--against FILE]
                                    [--out FILE] [--json]

   --layout is the reference rig (default arc4-head), --against the other one.
   Writes a self-contained HTML page -- both shows animated side by side at the
   bake's own frame rate, plus the numbers -- and prints the numbers to stdout.

   Everything measured here comes from the two bakes, not from reasoning about
   what the code should do: bake.js is shelled out to twice, exactly as a venue
   would run it. */
const fs = require("fs"), path = require("path"), os = require("os");
const { execFileSync } = require("child_process");
const { enumerate, validateSequence } = require("./preflight.js");
const layouts = require("./layouts.js");

const LIT = 0.01;                    /* a lamp is "lit" above this level */

/* ---- colour helpers (the same hue/sat reading frame.js palettises with) ---- */
function rgb2hsv(c) {
  const r = c[0], g = c[1], b = c[2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-9) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h /= 6; if (h < 0) h += 1;
  }
  return [h, mx > 0 ? d / mx : 0, mx];
}
/* is this colour one of the artist's, at any brightness? palettise() keeps the
   value and takes the palette entry's hue and saturation, so the test is on
   those two and not on rgb distance. */
const inPalette = (c, pal) => pal.some(p => {
  const [ph, ps] = rgb2hsv(p.rgb), [h, s] = rgb2hsv(c);
  let dh = Math.abs(ph - h); if (dh > 0.5) dh = 1 - dh;
  return Math.abs(ps - s) < 0.06 && (ps < 0.06 || dh < 0.03);
});

/* ---- the two bakes ---------------------------------------------------------- */
function bake(scoreFile, seed, rig, dir) {
  const out = path.join(dir, rig.base + ".frames.json");
  const args = [path.join(__dirname, "bake.js")];
  if (scoreFile) args.push(scoreFile, String(seed)); else args.push(String(seed));
  if (!rig.isDefault) args.push("--layout", rig.file);
  args.push("--out", out);
  execFileSync("node", args, { stdio: "pipe" });
  return JSON.parse(fs.readFileSync(out, "utf8"));
}

/* ---- what each bake did, tick by tick --------------------------------------- */
function measure(show, palette) {
  const q = v => Math.round((v || 0) * 20);
  const lit = [], distinct = [], headNames = new Set(), offPalette = [];
  let headsInUnison = 0, headTicks = 0;
  for (const tk of show.ticks) {
    let n = 0;
    const states = new Set(), heads = [];
    for (const fx of tk.fixtures) {
      const it = fx.intent || {}, lv = it.level || 0;
      if (fx.type === "head13") heads.push(JSON.stringify(it));
      if (lv > LIT) {
        n++;
        if (Array.isArray(it.colour)) {
          if (rgb2hsv(it.colour)[2] > 0.02 && palette.length && !inPalette(it.colour, palette))
            offPalette.push({ t: tk.t, id: fx.id, colour: it.colour });
        } else if (typeof it.colour === "string") headNames.add(it.colour);
      }
      if (fx.type === "par7")
        states.add(JSON.stringify([Array.isArray(it.colour) ? it.colour.map(q) : it.colour, q(it.level), q(it.strobe)]));
    }
    if (heads.length > 1) { headTicks++; if (heads.every(h => h === heads[0])) headsInUnison++; }
    lit.push(n); distinct.push(states.size);
  }
  const mean = a => +(a.reduce((s, v) => s + v, 0) / (a.length || 1)).toFixed(2);
  return { lit, distinct, headNames: [...headNames].sort(), offPalette,
           headsInUnison, headTicks,
           fixtures: show.fixtures.length,
           pars: show.fixtures.filter(f => f.type === "par7").length,
           maxLit: Math.max(...lit), meanLit: mean(lit),
           maxDistinct: Math.max(...distinct), meanDistinct: mean(distinct),
           allSame: distinct.filter(v => v <= 1).length };
}

/* the peak of the window a moment occupies -- a hit is a few frames long, and
   the frame where it is widest is the one worth drawing */
const peakAt = (show, m, lit) => {
  const i = show.ticks.findIndex(t => t.t >= m.t);
  if (i < 0) return { lit: 0, frame: 0 };
  let best = 0, at = i;
  for (let k = Math.max(0, i - 2); k < Math.min(lit.length, i + 8); k++)
    if (lit[k] > best) { best = lit[k]; at = k; }
  return { lit: best, frame: at };
};

/* ---- the page's frame data: 7 bytes per fixture per tick -------------------- */
const WHEEL = Object.fromEntries(
  (require("./drivers/profiles/head13.profile.json").colour_wheel || []).map(s => [s.name, s.rgb]));
function pack(show) {
  const n = show.ticks.length, m = show.fixtures.length;
  const buf = Buffer.alloc(n * m * 7);
  const idx = Object.fromEntries(show.fixtures.map((f, i) => [f.id, i]));
  const b = v => Math.max(0, Math.min(255, Math.round(v * 255)));
  show.ticks.forEach((tk, ti) => {
    for (const fx of tk.fixtures) {
      const it = fx.intent || {}, o = (ti * m + idx[fx.id]) * 7;
      const c = Array.isArray(it.colour) ? it.colour
              : (typeof it.colour === "string" ? (WHEEL[it.colour] || [1, 1, 1]) : [0, 0, 0]);
      buf[o] = b(c[0]); buf[o + 1] = b(c[1]); buf[o + 2] = b(c[2]);
      buf[o + 3] = b(it.level || 0);
      buf[o + 4] = b(it.pan != null ? it.pan : 0.5);
      buf[o + 5] = b(it.tilt != null ? it.tilt : 0.5);
      buf[o + 6] = b(it.strobe || 0);
    }
  });
  return buf.toString("base64");
}

/* ---------------------------------------------------------------------------- */
function compare(opts) {
  const A = layouts.resolve(opts.layout || null), B = layouts.resolve(opts.against);
  const dir = opts.dir || fs.mkdtempSync(path.join(os.tmpdir(), "compare-"));
  fs.mkdirSync(dir, { recursive: true });

  const enA = enumerate(A.layout, { palette: A.palette }), enB = enumerate(B.layout, { palette: B.palette });
  const refused = rig => rig.palette
    .map(s => ({ id: s.id, v: validateSequence(s, rig.layout) }))
    .filter(x => !x.v.ok).map(x => ({ id: x.id, why: x.v.reason }));

  const showA = bake(opts.score, opts.seed, A, dir), showB = bake(opts.score, opts.seed, B, dir);
  const palette = require("./arranger.js").paletteOf(
    require("./fromscore.js").load(opts.score)) || [];

  const mA = measure(showA, palette), mB = measure(showB, palette);

  /* the show's SHAPE: does the same music land at the same wall time on both? */
  const j = x => JSON.stringify(x);
  const spans = s => s.looks.map(l => [l.start, l.end, l.layer].join("/"));
  const lookDiff = showA.looks.map((l, i) => ({ start: l.start, bar: l.bar, to_bar: l.to_bar, layer: l.layer,
    a: l.seq_id, b: (showB.looks[i] || {}).seq_id }))
    .filter(d => d.a !== d.b);

  /* the failure mode that would break the pitch: the bigger rig going dark where
     the small one was lit, because nothing in the library fitted */
  let darkOnB = 0, firstDark = null, fewerOnB = 0, darkOnBoth = 0;
  for (let i = 0; i < mA.lit.length; i++) {
    if (mA.lit[i] > 0 && mB.lit[i] === 0) { darkOnB++; if (firstDark === null) firstDark = showA.ticks[i].t; }
    if (mB.lit[i] < mA.lit[i]) fewerOnB++;
    if (mA.lit[i] === 0 && mB.lit[i] === 0) darkOnBoth++;
  }

  const fitDiff = Object.keys(enA.fit).filter(k => enA.fit[k] !== enB.fit[k])
    .map(k => ({ id: k, a: enA.fit[k], b: enB.fit[k] }));

  /* One seed is one draw. Sweep a run of them so the answer is not an accident
     of the seed the demo happens to use: how often does the rig change what the
     arranger picks, and does it ever change WHERE. */
  const sweep = seeds => {
    const score = require("./fromscore.js").load(opts.score);
    const { plan } = require("./arranger.js");
    const sp = a => [a.from.bar, a.from.beat, a.to.bar, a.to.beat, a.layer].join("/");
    const id = a => a.seq_id || a.type;
    let identical = 0, movedSpans = 0, picks = 0, changed = 0;
    for (let s = 1; s <= seeds; s++) {
      const pa = plan(score, enA, s), pb = plan(score, enB, s);
      if (j(pa.assignments.map(sp)) !== j(pb.assignments.map(sp))) movedSpans++;
      const d = pa.assignments.filter((a, i) => id(a) !== id(pb.assignments[i] || {})).length;
      picks += pa.assignments.length; changed += d;
      if (d === 0) identical++;
    }
    return { seeds, identical, movedSpans, picks, changed };
  };

  return { dir, A, B, enA, enB, showA, showB, mA, mB, palette,
    refusedA: refused(A), refusedB: refused(B), fitDiff,
    sweep: sweep(opts.seeds || 40),
    timing: {
      moments: j(showA.moments) === j(showB.moments),
      phases: j(showA.phases) === j(showB.phases),
      facts: j(showA.facts) === j(showB.facts),
      spans: j(spans(showA)) === j(spans(showB)),
      looks: showA.looks.length, sameSeq: showA.looks.length - lookDiff.length, lookDiff,
    },
    darkness: { darkOnB, firstDark, fewerOnB, darkOnBoth, ticks: mA.lit.length },
    peaks: showA.moments.map(m => {
      const pa = peakAt(showA, m, mA.lit), pb = peakAt(showB, m, mB.lit);
      return { t: m.t, kind: m.kind, weight: m.weight, a: pa.lit, b: pb.lit, frameA: pa.frame, frameB: pb.frame };
    }),
  };
}

/* ---- the page --------------------------------------------------------------- */
function page(r) {
  /* positions come from the LAYOUT, which is where they live; the bake carries
     only the patch (id, type, address). */
  const rigJSON = (rig, show) => {
    const at = Object.fromEntries(rig.layout.fixtures.map(f => [f.id, f.at || [0, 0, 0]]));
    return JSON.stringify({
      rig: rig.rig, base: rig.base, fps: show.fps, count: show.ticks.length,
      duration: show.duration,
      fixtures: show.fixtures.map(f => ({ id: f.id, type: f.type,
        x: at[f.id][0], y: at[f.id][1] || 0, z: at[f.id][2] || 0 })),
      data: pack(show),
    });
  };
  const meta = JSON.stringify({
    score: r.showA.score, seed: r.showA.seed,
    palette: r.palette.map(p => ({ name: p.name, rgb: p.rgb })),
    phases: r.showA.phases, moments: r.showA.moments,
    looksA: r.showA.looks, looksB: r.showB.looks,
    timing: r.timing, darkness: r.darkness, peaks: r.peaks,
    fitDiff: r.fitDiff, sweep: r.sweep,
    enum: {
      a: { rig: r.A.rig, library: r.A.palette.length, total: r.enA.sequences.length,
           base: r.enA.report.sources.base, llm: r.enA.report.sources.llm,
           rejected: r.enA.report.rejected, refused: r.refusedA, impossible: r.enA.report.impossible },
      b: { rig: r.B.rig, library: r.B.palette.length, total: r.enB.sequences.length,
           base: r.enB.report.sources.base, llm: r.enB.report.sources.llm,
           rejected: r.enB.report.rejected, refused: r.refusedB, impossible: r.enB.report.impossible },
    },
    use: {
      a: { fixtures: r.mA.fixtures, pars: r.mA.pars, maxLit: r.mA.maxLit, meanLit: r.mA.meanLit,
           maxDistinct: r.mA.maxDistinct, meanDistinct: r.mA.meanDistinct, allSame: r.mA.allSame,
           headNames: r.mA.headNames, offPalette: r.mA.offPalette.length,
           headsInUnison: r.mA.headsInUnison, headTicks: r.mA.headTicks },
      b: { fixtures: r.mB.fixtures, pars: r.mB.pars, maxLit: r.mB.maxLit, meanLit: r.mB.meanLit,
           maxDistinct: r.mB.maxDistinct, meanDistinct: r.mB.meanDistinct, allSame: r.mB.allSame,
           headNames: r.mB.headNames, offPalette: r.mB.offPalette.length,
           headsInUnison: r.mB.headsInUnison, headTicks: r.mB.headTicks },
    },
  });
  return TEMPLATE
    .replace("/*__META__*/", "const META = " + meta + ";")
    .replace("/*__RIG_A__*/", "const RIG_A = " + rigJSON(r.A, r.showA) + ";")
    .replace("/*__RIG_B__*/", "const RIG_B = " + rigJSON(r.B, r.showB) + ";");
}

const TEMPLATE = fs.readFileSync(path.join(__dirname, "compare.page.html"), "utf8");

module.exports = { compare, page, measure, inPalette, pack, LIT };

/* ---- CLI -------------------------------------------------------------------- */
if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const bare = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
  const r = compare({
    score: bare[0] || null, seed: +(bare[1] || 1),
    layout: opt("--layout", null),
    against: opt("--against", path.join(__dirname, "club12-2head.layout.json")),
    seeds: +opt("--seeds", 40), dir: opt("--dir", null),
  });
  const out = opt("--out", path.join(__dirname, "..", "..", "work", "shows",
    (r.showA.score || "show") + ".compare.html"));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, page(r));

  const pc = (n, d) => (d ? (100 * n / d).toFixed(1) + "%" : "-");
  const L = (k, v) => console.log("  " + (k + " ").padEnd(52) + v);
  console.log(`\n${r.showA.score} @ seed ${r.showA.seed}:  ${r.A.rig} (${r.mA.fixtures} fixtures)  vs  ${r.B.rig} (${r.mB.fixtures} fixtures)`);
  console.log("\nTHE EFFECT LIBRARY ACROSS RIGS");
  L("looks in the library", r.A.palette.length);
  L("enumerated on " + r.A.rig, `${r.enA.report.sources.llm}  (+${r.enA.report.sources.base} base = ${r.enA.sequences.length})`);
  L("enumerated on " + r.B.rig, `${r.enB.report.sources.llm}  (+${r.enB.report.sources.base} base = ${r.enB.sequences.length})`);
  L("refused on " + r.B.rig, r.refusedB.length + (r.refusedB.length ? ": " + r.refusedB.map(x => x.id + " (" + x.why + ")").join("; ") : ""));
  L("impossible on " + r.B.rig + " (base vocabulary)", r.enB.report.impossible.join(", ") || "-");
  L("fit scores that changed with the rig", r.fitDiff.length + (r.fitDiff.length ? ": " + r.fitDiff.map(f => `${f.id} ${f.a}->${f.b}`).join(", ") : ""));
  console.log("\nDOES THE SAME MUSIC LAND AT THE SAME TIME");
  L("moments identical", r.timing.moments);
  L("section phases identical", r.timing.phases);
  L("per-bar facts identical", r.timing.facts);
  L("every look's span identical", r.timing.spans);
  L("looks filled by the same sequence", `${r.timing.sameSeq}/${r.timing.looks}`);
  for (const d of r.timing.lookDiff)
    console.log("      bar " + d.bar + "-" + d.to_bar + " " + d.layer + ": " + d.a + "  ->  " + d.b);
  const S = r.sweep;
  L(`over ${S.seeds} seeds: plans identical on both rigs`, `${S.identical}/${S.seeds}`);
  L("over those seeds: assignments that moved in TIME", S.movedSpans === 0 ? "0 (none, on any seed)" : S.movedSpans);
  L("over those seeds: picks the rig changed", `${S.changed}/${S.picks} (${pc(S.changed, S.picks)})`);
  console.log("\nDOES THE BIGGER RIG USE MORE OF ITSELF");
  L("lamps lit at the peak", `${r.mA.maxLit}/${r.mA.fixtures}  vs  ${r.mB.maxLit}/${r.mB.fixtures}`);
  L("mean lamps lit", `${r.mA.meanLit}/${r.mA.fixtures} (${pc(r.mA.meanLit, r.mA.fixtures)})  vs  ${r.mB.meanLit}/${r.mB.fixtures} (${pc(r.mB.meanLit, r.mB.fixtures)})`);
  L("distinct PAR states at once (mean / max)", `${r.mA.meanDistinct} / ${r.mA.maxDistinct}  vs  ${r.mB.meanDistinct} / ${r.mB.maxDistinct}`);
  L("ticks with every PAR identical", `${pc(r.mA.allSame, r.darkness.ticks)}  vs  ${pc(r.mB.allSame, r.darkness.ticks)}`);
  if (r.mB.headTicks) L("ticks with every head in unison", `${r.mB.headsInUnison}/${r.mB.headTicks} on ${r.B.rig}`);
  console.log("\nIS ANYTHING DROPPED TO DARKNESS");
  L("ticks lit on " + r.A.rig + " but DARK on " + r.B.rig, r.darkness.darkOnB + (r.darkness.firstDark !== null ? "  (first at " + r.darkness.firstDark + "s)" : ""));
  L("ticks lighting FEWER lamps on " + r.B.rig, r.darkness.fewerOnB);
  L("ticks dark on both (the show's own holes)", `${r.darkness.darkOnBoth} (${pc(r.darkness.darkOnBoth, r.darkness.ticks)})`);
  console.log("\nDOES THE ARTIST'S PALETTE HOLD");
  L("allowed colours", r.palette.map(p => p.name).join(" + ") || "unconstrained");
  L("lit PAR colours outside it", `${r.mA.offPalette.length} on ${r.A.rig},  ${r.mB.offPalette.length} on ${r.B.rig}`);
  L("head wheel slots used", `${r.mA.headNames.join("/") || "-"}  vs  ${r.mB.headNames.join("/") || "-"}`);
  console.log("\nAT EACH MOMENT (lamps lit at the peak)");
  for (const p of r.peaks)
    console.log("  " + String(p.t).padStart(8) + "s  " + String(p.kind).padEnd(11) + " w=" + String(p.weight).padEnd(6) +
      "  " + String(p.a + "/" + r.mA.fixtures).padStart(6) + "   " + String(p.b + "/" + r.mB.fixtures).padStart(6));
  console.log(`\n-> ${out}`);
  if (args.includes("--json")) console.log(JSON.stringify({ timing: r.timing, darkness: r.darkness, peaks: r.peaks }, null, 1));
}
