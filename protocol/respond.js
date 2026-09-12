#!/usr/bin/env node
/* request in, response out. The reference implementation of the contract.
   ---------------------------------------------------------------------------
   Sebastian writes the real one; this is here so that "what exactly do I get
   and what exactly do I return" is a file you can run rather than a paragraph
   somebody has to interpret.

     node protocol/respond.js protocol/request.example.json

   Four rules the reference obeys, and the real one should too.

   1. `grid` is always returned, asked for or not. Every position in every other
      field is meaningless without it, and a consumer that forgot to ask should
      get a usable answer rather than a puzzle.

   2. A field nobody asked for is not sent. Alnas wanting downbeats should not
      have to receive 506 beats to get 127 of them.

   3. The response always says which version it actually gave. A consumer that
      asked for `levels` and got v2 yesterday and v3 today has no way to know
      the show it rendered last night is not the one it would render now.

   4. A window clips, it does not re-anchor. Bar 33 is still called bar 33 in a
      window that starts there, because renumbering is how you lose the ability
      to compare two windows of the same song.

   5. A score that carries a `profile` -- pulled with `limelight pull --profile`
      -- gets it back in every response, asked for or not. The consumer who
      pulled with a profile meant it to apply to everything they render.
*/
"use strict";
const fs = require("fs"), path = require("path");

const ALWAYS = ["grid"];
const KNOWN = ["grid", "beats", "downbeats", "sections", "energy", "moments", "layers"];

function respond(req) {
  const name = String(req.score || "").replace(/[^A-Za-z0-9_-]/g, "");
  const file = path.join(__dirname, `score.${name}.json`);
  if (!name || !fs.existsSync(file)) {
    return { error: `no score for ${req.score}`,
             have: fs.readdirSync(__dirname)
                     .filter(f => f.startsWith("score."))
                     .map(f => f.slice(6, -5)) };
  }
  const s = JSON.parse(fs.readFileSync(file, "utf8"));

  if (req.version !== undefined && req.version !== s.version) {
    return { error: `asked for ${name}@${req.version}, have ${name}@${s.version}`,
             note: "a score is immutable once published; a correction is a new version" };
  }

  const want = new Set([...(req.fields || KNOWN), ...ALWAYS]);
  const unknown = (req.fields || []).filter(f => !KNOWN.includes(f));

  const w = req.window || null;
  const bpb = s.grid.beats_per_bar || 4;
  const lo = w ? w.from_bar : -Infinity;
  const hi = w ? w.from_bar + (w.bars || 0) : Infinity;
  const inWin = bar => bar >= lo && bar < hi;
  /* a section counts if any part of it is inside the window -- a consumer
     asking for eight bars still needs to know it is inside a sixteen-bar drop */
  const spanTouches = sp => sp.to.bar > lo && sp.from.bar < hi;

  const out = { score: s.score, version: s.version,
                window: w ? { from_bar: w.from_bar, bars: w.bars } : "whole song" };

  if (want.has("grid")) out.grid = s.grid;

  for (const k of ["beats", "downbeats"]) {
    if (!want.has(k) || !s[k]) continue;
    const list = w ? s[k].list.filter(b => inWin(b[0])) : s[k].list;
    out[k] = { derived_from: "grid", as: "[bar, beat]", count: list.length, list };
  }

  if (want.has("sections") && s.layers && s.layers.form) {
    out.sections = s.layers.form.spans
      .filter(sp => !w || spanTouches(sp))
      .map(sp => ({ from: sp.from, to: sp.to, name: sp.name, repeat: sp.repeat }));
  }

  if (want.has("energy") && s.energy) {
    const E = s.energy;
    if (!w) out.energy = E;
    else {
      const start = Math.max(0, lo - E.from_bar);
      const end = Math.max(start, hi - E.from_bar);
      out.energy = { per: E.per, from_bar: E.from_bar + start,
                     values: E.values.slice(start, end) };
    }
  }

  if (want.has("moments") && s.moments) {
    out.moments = w ? s.moments.filter(m => inWin(m.at.bar)) : s.moments;
  }
  if (want.has("layers") && s.layers) out.layers = s.layers;

  if (s.profile) out.profile = s.profile;
  if (unknown.length) out.ignored = { fields: unknown, known: KNOWN };
  return out;
}

module.exports = { respond, KNOWN };

if (require.main === module) {
  const f = process.argv[2] || path.join(__dirname, "request.example.json");
  const req = JSON.parse(fs.readFileSync(f, "utf8"));
  console.log(JSON.stringify(respond(req), null, 1));
}
