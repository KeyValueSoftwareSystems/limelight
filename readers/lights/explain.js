#!/usr/bin/env node
"use strict";
/* explain.js -- what the arranger thinks about one stretch of one song.
   ---------------------------------------------------------------------------
   A preset names a song and a passage in it. This reads the score the way
   bake.js does (enumerate -> plan), asks the plan to explain itself, and keeps
   only the window: which musical facts the arranger read per bar, which
   sequences it drew from the matrix for each look and one-shot there, the pool
   each draw came from with its odds, the fixed effects that ride on top without
   a draw, and -- across all of it -- how likely each sequence is to appear in
   this window at all. Same code path as the bake, so at the same seed the picks
   here are the picks that play.

     node readers/lights/explain.js presets/<recipe>.json [--seed N] [--json]
     node readers/lights/explain.js --score <file> --from N --bars N [--seed N] [--json]
     node readers/lights/explain.js --list --json      every recipe, and where its score is

   Positions are bars and beats; seconds come from the protocol clock, shifted
   exactly as bake.js shifts them, so `starts_at_s` is where the panel's timeline
   has the same bar. No I/O in explain() itself. */
const fs = require("fs"), path = require("path");
const { enumerate } = require("./preflight.js");
const { plan, clashes, sectionEnergyMean, energyReader } = require("./arranger.js");
const { shape } = require("./fromscore.js");
const { Session } = require("../../protocol/session.js");
const { findScore, locate } = require("../../tools/preset.js");
const { EFFECTS } = require("../../tools/measure.js");

const R = path.join(__dirname, "..", "..");
const PRESETS = path.join(R, "presets");
const DEFAULT_SEED = 3;   /* the panel's import default, so the tab explains the show it bakes */

/* which fixtures a sequence drives, as play.js names them */
const whereOf = s => {
  const occ = s.occupies || [];
  const head = occ.some(o => String(o).startsWith("head:")), pars = occ.some(o => String(o).startsWith("pars:") || String(o).startsWith("all_pars"));
  return s.kind === "combination" ? "par+head" : s.kind === "oneshot" ? "fx" : head && !pars ? "head" : head && pars ? "par+head" : "pars";
};

/* the effects a recipe says it tests, each with the measurement that judges it */
function effectsOf(recipe) {
  const names = Array.isArray(recipe.effects) ? recipe.effects : recipe.effect ? [recipe.effect] : [];
  return names.map(n => ({ name: n, ...(EFFECTS[n] ? { measure: EFFECTS[n].measure, check: EFFECTS[n].check } : { measure: null, check: null }) }));
}

/* the doc: everything the page shows, for one (score, window, seed) */
function explain(scoreIn, opts) {
  const o = opts || {};
  const layout = o.layout || JSON.parse(fs.readFileSync(path.join(__dirname, "arc4-head.layout.json"), "utf8"));
  let palette = o.palette;
  if (palette === undefined) { try { palette = JSON.parse(fs.readFileSync(path.join(__dirname, "arc4-head.palette.json"), "utf8")); } catch (e) { palette = []; } }
  const seed = (o.seed === undefined || o.seed === null) ? DEFAULT_SEED : (+o.seed >>> 0);
  const score = shape(scoreIn);
  const en = enumerate(layout, { palette });
  const p = plan(score, en, seed, { explain: true });
  const library = Object.fromEntries((palette || []).map(s => [s.id, s]));
  const seqOf = Object.fromEntries(en.sequences.map(s => [s.id, s]));
  const describe = id => { const s = seqOf[id] || {}; return { id, kind: s.kind || null, boldness: s.boldness || null, where: s.id ? whereOf(s) : null,
    description: (library[id] && library[id].description) || (s.kind === "oneshot" && s.gesture ? `one-shot: ${s.gesture.fx} (${s.gesture.slot || "on"}, ${s.duration_beats} beats)` : null) }; };

  const g = score.grid || {}, bpb = g.beats_per_bar || 4;
  const sections = score.sections || [];
  const atBeat = q => (q.bar - 1) * bpb + ((q.beat || 1) - 1);
  const from = +o.from, bars = Math.max(1, +o.bars || 1), to = from + bars;
  const wf = (from - 1) * bpb, wt = (to - 1) * bpb;
  const overlaps = a => atBeat(a.from) < wt && atBeat(a.to) > wf;

  /* seconds as bake.js lays them on the panel's timeline */
  const S = Session(score, { now: () => 0 });
  const barBase = sections.length ? Math.min(...sections.map(s => s.from.bar)) : 1;
  const told = g.first_bar !== undefined && g.first_bar !== null;
  const shift = (told && g.first_bar === barBase) ? 0 : 1 - barBase;
  const secAt = q => +S.secondsAt(q.bar + shift, q.beat || 1).toFixed(3);

  /* the sections the window touches, with the context the arranger gave each */
  const energyAt = energyReader(score);
  const secIndexAt = B => sections.findIndex(s => atBeat(s.from) <= B && B < atBeat(s.to));
  const secs = sections.map((s, i) => ({ index: i, name: s.name || null, from_bar: s.from.bar, to_bar: s.to.bar, context: p.contexts[i],
      like: s.like || s.repeat || null, rise: typeof s.rise === "number" ? s.rise : null, energy: +sectionEnergyMean(s, energyAt).toFixed(3),
      starts_at_s: secAt(s.from), ends_at_s: secAt(s.to) }))
    .filter(s => (s.from_bar - 1) * bpb < wt && (s.to_bar - 1) * bpb > wf);

  /* the facts per bar, as the plan recorded them */
  const barsOut = [];
  for (let bar = from; bar < to; bar++) {
    const v = p.facts ? p.facts.vectors[bar - p.facts.from_bar] : null;
    barsOut.push({ bar, ...(v || { form: null }), at_s: secAt({ bar, beat: 1 }) });
  }

  /* the draws: each look, variation, head look and one-shot the window touches */
  const span = a => ({ from: a.from, to: a.to, from_bar: a.from.bar, to_bar: a.to.bar, starts_at_s: secAt(a.from), ends_at_s: secAt(a.to) });
  const pool = a => (a.pool || []).map(c => ({ ...describe(c.id), score: c.score, odds: c.odds }));
  const draws = [];
  const baseSeen = {};
  for (const a of p.assignments) {
    if (!a.seq_id || !overlaps(a)) continue;
    const si = secIndexAt(atBeat(a.from));
    const common = { layer: a.layer, section: a.section || null, section_index: si, context: a.context || null, facts: a.facts || null,
      chosen: describe(a.seq_id), ...(a.remembered ? { remembered: a.remembered } : {}), pool: pool(a) };
    if (a.layer === "par" && !a.variation) {
      /* a base look carved around its variations is one draw in several pieces */
      const key = `${si}|${a.seq_id}`;
      if (baseSeen[key]) { const d = baseSeen[key]; if (atBeat(a.to) > atBeat(d.to)) Object.assign(d, { to: a.to, to_bar: a.to.bar, ends_at_s: secAt(a.to) }); if (atBeat(a.from) < atBeat(d.from)) Object.assign(d, { from: a.from, from_bar: a.from.bar, starts_at_s: secAt(a.from) }); d.pieces++; continue; }
      baseSeen[key] = { kind: "par", ...span(a), ...common, pieces: 1 };
      draws.push(baseSeen[key]);
    } else if (a.layer === "par") {
      draws.push({ kind: "variation", ...span(a), ...common, doing: a.doing || null });
    } else if (a.layer === "head") {
      draws.push({ kind: "head", ...span(a), ...common });
    } else {
      const s = seqOf[a.seq_id] || {};
      draws.push({ kind: "oneshot", ...span(a), ...common, moment: a.moment || null, what: a.what || null,
        slot: (s.gesture && s.gesture.slot) || "on", fx: a.type || (s.gesture && s.gesture.fx) || null,
        weight: a.params && typeof a.params.strength === "number" ? a.params.strength : null });
    }
  }
  const beatOf = q => atBeat(q);
  draws.sort((a, b) => (beatOf(a.from) - beatOf(b.from)) || (a.kind === "par" ? -1 : b.kind === "par" ? 1 : 0));

  /* the effects that ride on top without a draw: the arranger's fixed rules */
  const fixed = p.assignments.filter(a => !a.seq_id && overlaps(a)).map(a => ({
    type: a.type || a.layer, layer: a.layer, ...span(a), section: a.section || null, context: a.context || null,
    ...(a.moment ? { moment: a.moment, what: a.what || null } : {}), ...(a.signal ? { signal: a.signal, what: a.what || null } : {}),
    params: a.params || {} }));

  /* how likely each sequence is to appear in the window at all: one minus the
     chance every draw whose pool holds it went elsewhere. A remembered look is
     not drawn, so it counts as certain -- the show's rule already chose it. */
  const miss = {}, count = {}, best = {}, drawn = new Set();
  for (const d of draws) {
    drawn.add(d.chosen.id);
    if (d.remembered) { miss[d.chosen.id] = 0; count[d.chosen.id] = (count[d.chosen.id] || 0) + 1; best[d.chosen.id] = 1; continue; }
    for (const c of d.pool) {
      miss[c.id] = (miss[c.id] === undefined ? 1 : miss[c.id]) * (1 - c.odds);
      count[c.id] = (count[c.id] || 0) + 1;
      best[c.id] = Math.max(best[c.id] || 0, c.odds);
    }
  }
  const likely = Object.keys(miss).map(id => ({ ...describe(id), p: +(1 - miss[id]).toFixed(4), best: +best[id].toFixed(4), draws: count[id], drawn: drawn.has(id) }))
    .sort((a, b) => (b.p - a.p) || (b.best - a.best) || (a.id < b.id ? -1 : 1));

  return {
    song: score.score || o.song || null, score_version: score.version === undefined ? null : score.version, seed,
    grid: { bpm: g.bpm || null, beats_per_bar: bpb, first_bar: told ? g.first_bar : null, bars: g.bars || null },
    window: { from_bar: from, bars, to_bar: to, starts_at_s: secAt({ bar: from, beat: 1 }), ends_at_s: secAt({ bar: to, beat: 1 }),
              why: o.why || null, find: o.find || null, pad_bars: o.pad_bars || 0 },
    palette_size: en.sequences.length, clashes: clashes(p),
    sections: secs, bars: barsOut, draws, fixed, likely,
  };
}

/* a recipe file -> the doc, or a doc-shaped error the page can show */
function explainRecipe(recipe, opts) {
  const scorePath = (opts && opts.scorePath) || findScore(recipe.song);
  if (!scorePath) return { error: `no score for ${recipe.song} on this machine`, hint: `import it from the hub (Settings & tools), or: limelight pull ${recipe.song}.score`, recipe: recipeSummary(recipe) };
  const raw = JSON.parse(fs.readFileSync(scorePath, "utf8"));
  let where;
  try { where = locate(recipe, raw); } catch (e) { return { error: e.message, recipe: recipeSummary(recipe) }; }
  if (!where) return { error: `could not find "${recipe.find}" in ${recipe.song}: the score does not carry what it needs`, recipe: recipeSummary(recipe) };
  const doc = explain(raw, { ...(opts || {}), from: where.from, bars: where.bars, why: where.why, find: recipe.find, pad_bars: where.pad, song: recipe.song });
  doc.recipe = recipeSummary(recipe);
  doc.score_path = scorePath;
  return doc;
}
const recipeSummary = r => ({ name: r.name, song: r.song, tests: r.tests || null, note: r.note || null, find: r.find || null, pad_bars: r.pad_bars || 0, effects: effectsOf(r) });

/* every recipe in presets/, and whether its score is here */
function listRecipes(dir) {
  const d = dir || PRESETS;
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => f.endsWith(".json")).sort().map(f => {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(d, f), "utf8"));
      return { file: f, ...recipeSummary(r), name: r.name || f.replace(/\.json$/, ""), score_path: findScore(r.song) };
    } catch (e) { return { file: f, name: f.replace(/\.json$/, ""), error: `unreadable recipe: ${e.message}` }; }
  });
}

module.exports = { explain, explainRecipe, listRecipes, effectsOf, whereOf, DEFAULT_SEED };

/* ---- CLI ------------------------------------------------------------------ */
if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const flag = k => args.includes(k);
  const json = flag("--json");
  const seed = opt("--seed", null) !== null ? +opt("--seed") : DEFAULT_SEED;

  /* stdout to a pipe is asynchronous: process.exit() straight after console.log
     truncates a large doc, so JSON is written and the exit code is left to the
     event loop */
  const emit = (obj, code) => { process.stdout.write(JSON.stringify(obj) + "\n"); process.exitCode = code; };

  if (flag("--list")) {
    const rows = listRecipes(opt("--dir", null) || undefined);
    if (json) { emit(rows, 0); return; }
    for (const r of rows) console.log(`${r.name.padEnd(28)} ${String(r.song || "").padEnd(18)} ${r.find || ""}${r.error ? "  " + r.error : r.score_path ? "" : "  (no score here)"}`);
    return;
  }

  let doc;
  if (opt("--score", null)) {
    const raw = JSON.parse(fs.readFileSync(opt("--score"), "utf8"));
    doc = explain(raw, { from: +opt("--from", 1), bars: +opt("--bars", 8), seed });
  } else {
    const recipePath = args.find(a => !a.startsWith("--") && a.endsWith(".json") && a !== opt("--score"));
    if (!recipePath) { console.error("usage: node readers/lights/explain.js presets/<recipe>.json [--seed N] [--json]\n       node readers/lights/explain.js --score <file> --from N --bars N [--seed N] [--json]\n       node readers/lights/explain.js --list [--json]"); process.exit(2); }
    doc = explainRecipe(JSON.parse(fs.readFileSync(recipePath, "utf8")), { seed });
  }
  if (json) { emit(doc, doc.error ? 3 : 0); return; }
  if (doc.error) { console.error(doc.error); if (doc.hint) console.error(doc.hint); process.exitCode = 3; return; }

  const pos = q => q.bar + (q.beat && q.beat !== 1 ? "." + q.beat : "");
  const vec = f => f ? "[" + [f.form, f.doing, (f.presence || []).join("+"), (f.texture || []).join("+"), (f.harmony || []).join("+"), (f.moment || []).join("+")].filter(Boolean).join("|") + "]" : "";
  const pct = x => (x * 100).toFixed(0).padStart(3) + "%";
  const w = doc.window;
  console.log(`\n${doc.song} — bars ${w.from_bar}-${w.to_bar - 1} (${w.starts_at_s}s-${w.ends_at_s}s) @ seed ${doc.seed}, ${doc.palette_size}-sequence palette`);
  if (w.why) console.log(`  ${w.why}${w.pad_bars ? ` (+${w.pad_bars} bar${w.pad_bars > 1 ? "s" : ""} either side)` : ""}`);
  if (doc.recipe) {
    if (doc.recipe.tests) console.log(`  tests: ${doc.recipe.tests}`);
    if (doc.recipe.effects.length) console.log(`  effects: ${doc.recipe.effects.map(e => e.name + (e.measure ? ` (${e.measure})` : " (no measurement yet)")).join(", ")}`);
  }
  console.log(`\n  sections: ${doc.sections.map(s => `${s.name} ${s.from_bar}-${s.to_bar - 1} -> ${s.context}${s.like ? " [" + s.like + "]" : ""}`).join(";  ")}`);
  console.log("\n  DRAWS");
  for (const d of doc.draws) {
    const tag = d.kind === "variation" ? ` [var ${d.doing}]` : d.kind === "oneshot" ? ` [${d.moment}${d.what ? ": " + d.what : ""} · ${d.slot}]` : "";
    console.log(`  ${(pos(d.from) + "-" + pos(d.to)).padEnd(12)} ${String(d.section || "").padEnd(11)} ${d.kind.padEnd(9)} -> ${d.chosen.id}${d.remembered ? " (remembered " + d.remembered + ")" : ""}${tag}  ${vec(d.facts)}`);
    const top = d.pool.slice(0, 6);
    console.log("      " + top.map(c => `${c.id === d.chosen.id ? "*" : " "}${c.id} ${pct(c.odds)}`).join("   ") + (d.pool.length > 6 ? `   … +${d.pool.length - 6}` : ""));
  }
  if (doc.fixed.length) console.log(`\n  also, not drawn (fixed rules): ${[...new Set(doc.fixed.map(f => f.type))].join(", ")}`);
  console.log("\n  LIKELY IN THIS WINDOW");
  for (const l of doc.likely.slice(0, 15)) console.log(`  ${pct(l.p)}  ${l.id.padEnd(28)} ${(l.where || "").padEnd(8)} ${(l.kind || "").padEnd(11)} ${l.drawn ? "drawn at this seed" : ""}`);
  if (doc.likely.length > 15) console.log(`  … ${doc.likely.length - 15} more`);
}
