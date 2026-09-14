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

   5. A score that carries a `personality` -- pulled with `limelight pull --personality`
      -- gets it back in every response, asked for or not. The consumer who
      pulled with a personality meant it to apply to everything they render.
*/
"use strict";
const fs = require("fs"),
  path = require("path");

const ALWAYS = ["grid"];
const KNOWN = [
  "grid",
  "beats",
  "downbeats",
  "sections",
  "energy",
  "moments",
  "layers",
  "song",
  "phrases",
  "chords",
  "key",
  "loudness",
  "feel",
  "curves",
  "harmony",
  "chord_changes",
  "chord_summary",
  "tension",
  "releases",
  "melody",
  "made_by",
  "voice",
  "lead",
  "moss",
  "moss_sections",
  "moss_caption",
  "btc_chords_raw",
  "stems_53",
];

/* The pipeline writes parts and bars.intensity; the protocol says sections and
   energy. server/format/v1.js does the same mapping for the HTTP path, which is
   ESM and cannot be required from here. */
function adapt(s) {
  if (Array.isArray(s.sections)) return s;
  const out = { ...s };
  if (Array.isArray(s.parts)) {
    out.sections = s.parts.map((p) => ({
      from: { bar: p.from_bar, beat: 1 },
      to: { bar: p.to_bar + 1, beat: 1 },
      name: p.role,
      nth: p.nth,
      repeat: p.like,
      playing: p.playing,
      stems: p.stems,
    }));
  }
  /* The pipeline lists beats as objects with a time; the protocol lists them as
     [bar, beat] pairs. Bars advance on the detected downbeat rather than on a
     count, so a pickup bar stays a pickup bar. */
  if (Array.isArray(s.beats) && s.grid) {
    /* Bar 1 is the first downbeat, matching session.js. Numbering from
       grid.first_bar put a pickup score's beats a bar out. */
    const per = s.grid.beats_per_bar || 4;
    const base =
      s.grid.first_bar !== undefined && s.grid.first_bar !== null
        ? s.grid.first_bar
        : 1;
    const map =
      Array.isArray(s.grid.tempo) && s.grid.tempo.length
        ? s.grid.tempo
        : [{ from_beat: 0, at_s: s.grid.first_beat_s, bpm: s.grid.bpm }];
    const beatNo = (at) => {
      let k = 0;
      while (k + 1 < map.length && map[k + 1].at_s <= at) k++;
      const seg = map[k];
      return seg.from_beat + (at - seg.at_s) / (60 / seg.bpm);
    };
    let lead = 0;
    const pairs = s.beats.map((b, i) => {
      const n = b.t != null ? Math.round(beatNo(b.t)) : i;
      if (n < 0) {
        lead += 1;
        return [base, lead];
      }
      return [
        Math.max(base, 1 + Math.floor(n / per)),
        1 + (((n % per) + per) % per),
      ];
    });
    out.beats = {
      derived_from: "grid",
      as: "[bar, beat]",
      count: pairs.length,
      list: pairs,
    };
    const down = pairs.filter((p) => p[1] === 1);
    out.downbeats = {
      derived_from: "grid",
      as: "[bar, beat]",
      count: down.length,
      list: down,
    };
  }
  /* form is a partition of the song; subsection partitions each section. Other
     things -- a hook carrying into the next section -- cross those boundaries,
     which is the whole reason these are layers and not one list. */
  if (out.sections) {
    out.layers = {
      form: { kind: "partition", spans: out.sections },
      ...(Array.isArray(s.phrases)
        ? {
            subsection: {
              kind: "partition",
              spans: s.phrases.map((q) => ({
                from: { bar: q.from_bar, beat: 1 },
                to: { bar: q.to_bar + 1, beat: 1 },
                name: q.doing,
                says: q.says,
              })),
            },
          }
        : {}),
      /* presence crosses form boundaries -- a voice runs through a section
         change -- which is why it is a layer and not a column of the section. */
      /* One writer per fact: the voice has its own layer, so presence covers
         the instruments and nothing describes the voice twice. */
      ...(s.presence
        ? {
            presence: {
              kind: "sparse",
              spans: Object.keys(s.presence)
                .filter((k) => k !== "vocals")
                .flatMap((stem) =>
                  s.presence[stem]
                    .filter((sp) => sp.is !== "out")
                    .map((sp) => ({
                      from: { bar: sp.from_bar, beat: 1 },
                      to: { bar: sp.to_bar + 1, beat: 1 },
                      name: stem,
                      is: sp.is,
                    })),
                ),
            },
          }
        : {}),
      ...(s.presence && s.presence.vocals
        ? {
            voice: {
              kind: "sparse",
              spans: s.presence.vocals
                .filter((sp) => sp.is !== "out")
                .map((sp) => ({
                  from: { bar: sp.from_bar, beat: 1 },
                  to: { bar: sp.to_bar + 1, beat: 1 },
                  name: "voice",
                  is: sp.is,
                })),
            },
          }
        : {}),
      ...(s.phrase_grid
        ? {
            phrase: {
              kind: "rule",
              every_bars: s.phrase_grid.every_bars,
              from_bar: s.phrase_grid.from_bar,
            },
          }
        : {}),
    };
  }
  if (Array.isArray(s.bars && s.bars.intensity)) {
    out.energy = {
      per: "bar",
      from_bar: s.grid && s.grid.first_bar !== undefined ? s.grid.first_bar : 1,
      values: s.bars.intensity,
    };
  }
  return out;
}

function respond(req) {
  const name = String(req.score || "").replace(/[^A-Za-z0-9_-]/g, "");
  /* The repo settled on <name>.score while this was reading score.<name>.json,
     and nothing that read it was updated, so the suite broke on a rename rather
     than on a change of meaning. Both names are accepted; the new one wins. */
  /* Scores are read live from scores/, never from a copy kept beside this file.
     A committed sample goes stale the first time the pipeline changes, and then
     the protocol is tested against something nothing produces any more. */
  const dir =
    process.env.LIMELIGHT_SCORES || path.join(__dirname, "..", "scores");
  /* scores/ is the live source; __dirname lets a test write one beside this
     file without reaching into the pipeline's output directory. */
  const tries = [
    path.join(dir, `${name}.score`),
    path.join(__dirname, `${name}.score`),
  ];
  const file = name ? tries.find((f) => fs.existsSync(f)) || null : null;
  if (!file) {
    return {
      error: `no score for ${req.score}`,
      have: (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
        .filter((f) => f.endsWith(".score"))
        .map((f) => f.slice(0, -6)),
    };
  }
  const s = adapt(JSON.parse(fs.readFileSync(file, "utf8")));

  if (req.version !== undefined && req.version !== s.version) {
    return {
      error: `asked for ${name}@${req.version}, have ${name}@${s.version}`,
      note: "a score is immutable once published; a correction is a new version",
    };
  }

  const want = new Set([...(req.fields || KNOWN), ...ALWAYS]);
  const unknown = (req.fields || []).filter((f) => !KNOWN.includes(f));

  const w = req.window || null;
  const bpb = s.grid.beats_per_bar || 4;
  const lo = w ? w.from_bar : -Infinity;
  const hi = w ? w.from_bar + (w.bars || 0) : Infinity;
  const inWin = (bar) => bar >= lo && bar < hi;
  /* a section counts if any part of it is inside the window -- a consumer
     asking for eight bars still needs to know it is inside a sixteen-bar drop */
  const spanTouches = (sp) => sp.to.bar > lo && sp.from.bar < hi;

  const out = {
    score: s.score,
    version: s.version,
    window: w ? { from_bar: w.from_bar, bars: w.bars } : "whole song",
  };

  if (want.has("grid")) out.grid = s.grid;

  for (const k of ["beats", "downbeats"]) {
    if (!want.has(k) || !s[k]) continue;
    const list = w ? s[k].list.filter((b) => inWin(b[0])) : s[k].list;
    out[k] = {
      derived_from: "grid",
      as: "[bar, beat]",
      count: list.length,
      list,
    };
  }

  if (want.has("sections") && Array.isArray(s.sections)) {
    out.sections = s.sections
      .filter((sp) => !w || spanTouches(sp))
      .map((sp) => ({
        from: sp.from,
        to: sp.to,
        name: sp.name,
        repeat: sp.repeat,
      }));
  }

  if (want.has("energy") && s.energy) {
    const E = s.energy;
    if (!w) out.energy = E;
    else {
      const start = Math.max(0, lo - E.from_bar);
      const end = Math.max(start, hi - E.from_bar);
      out.energy = {
        per: E.per,
        from_bar: E.from_bar + start,
        values: E.values.slice(start, end),
      };
    }
  }

  if (want.has("moments") && s.moments) {
    out.moments = w ? s.moments.filter((m) => inWin(m.at.bar)) : s.moments;
  }
  if (want.has("layers") && s.layers) out.layers = s.layers;

  const person = s.personality || s.profile;
  if (person) {
    out.personality = person;
    out.profile = person;
  }
  if (unknown.length) out.ignored = { fields: unknown, known: KNOWN };
  return out;
}

module.exports = { respond, adapt, KNOWN };

if (require.main === module) {
  const f = process.argv[2] || path.join(__dirname, "request.example.json");
  const req = JSON.parse(fs.readFileSync(f, "utf8"));
  console.log(JSON.stringify(respond(req), null, 1));
}
