#!/usr/bin/env node
"use strict";
/* Bake a show with the creator's placed effects in it.

     node portal/effects.js <score> <seed> <edits.json> --lights <out>

   This is readers/lights/bake.js with one difference: before the frames are
   rendered, the placed effects are added to the arranger's plan as ordinary
   assignments. They go through the same renderer, with the same typed effects
   and the same dials the matrix uses, so a tile a person drops on bar 22 is the
   same object the arranger would have put there had the music asked for it.

   Doing it in the plan rather than as a post-pass over the DMX matters: a hit
   reads the look it lands on (the lamps outside its coverage keep their colour
   at HIT_REST, a swell rides the level the section already had), and none of
   that survives being painted over finished bytes.

   An explicit placement REPLACES the arranger's own punctuation where they
   overlap: frame.js resolves one effect per type per beat, so leaving both in
   would have the machine's choice silently win over the person's. */
const fs = require("fs");
const path = require("path");

const LIGHTS = path.join(__dirname, "..", "readers", "lights");
const { enumerate, baseLibrary } = require(path.join(LIGHTS, "preflight.js"));
const { plan } = require(path.join(LIGHTS, "arranger.js"));
const { frame } = require(path.join(LIGHTS, "frame.js"));
const { Session } = require(path.join(__dirname, "..", "protocol", "session.js"));
const { planFor } = require("./plan.js");

const LAYOUTS = require(path.join(LIGHTS, "layouts.js"));
/* The built-in palette plus anything a creator has built by re-dialling one.
   Both are the same grammar, so the renderer cannot tell them apart. */
const readCat = f => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, f), "utf8")).effects || []; }
                       catch (e) { return []; } };
const CATALOG = readCat("effects.json").concat(readCat("custom-effects.json"));
const BY_ID = Object.fromEntries(CATALOG.map(e => [e.id, e]));

/* frame.js resolves one assignment per type per beat by priority; a person's
   placement outranks the arranger's own at the same type. */
const FX_PRIORITY = { white_blast: 9, blackout: 9, pause: 8, hook: 7, accent_strobe: 5, modulate: 4, whiten: 3 };

/* THE BRIDGE. The catalogue is schema 2: a tile is named by what it DOES to a
   dimension of light (`blackout`, `impact`, `accent`) and carries no `fx`. The
   renderer speaks its own older vocabulary -- the six words below are every
   punctuation type frame.js branches on. Reading `spec.fx` straight off a
   schema-2 tile gave `undefined`, so every placement became an assignment of
   type `undefined`, frame.js matched none of them, and the bake came back
   byte-identical to one with no edits at all -- while `applied` still reported
   each edit as placed, so the page drew the clip and nothing happened in the
   room. A no-op that reports success is the worst kind.

   The page keeps the same table in lib/families.ts as PLAN_FX_TO_EFFECT, read
   the other way round. If one moves, move both. */
const EFFECT_TO_FX = {
  /* the six the page already knew about */
  impact: "white_blast",
  blackout: "blackout",
  accent: "accent_strobe",
  lift: "hook",
  hush: "pause",
  wash: "whiten",

  /* six more that the renderer can already express, once their dials are put in
     its words. `ramp` and `modulate` are spans rather than hits: modulate scales
     the look that is already playing, ramp grows across its own length. */
  stab: "white_blast",     /* a hit, but short and usually on the inner pair    */
  drone: "modulate",       /* a low bed under everything                        */
  strip: "modulate",       /* take the rig back to a fraction of itself         */
  cut: "modulate",         /* gain 0 for a beat -- a hole, not a fade           */
  ramp: "ramp",            /* grow toward full across the span                  */
  swell: "ramp",           /* the same rise, dialled by `rise` instead of `to`  */
};

/* The catalogue names a tile's controls in the language of the DIMENSION it
   changes; the renderer names them in its own. Everything a dial cannot reach
   is left alone rather than invented. */
const clamp01 = v => Math.max(0, Math.min(1, +v));
const PARAMS_FOR = {
  wash: d => ({ amount: d.amount != null ? clamp01(d.amount) : undefined }),
  impact: d => ({ strength: 1, coverage: d.extent, colour: d.colour }),
  stab: d => ({ strength: 0.85, coverage: d.extent || "inner", colour: d.colour }),
  /* a drone sits UNDER the show: it scales what is playing down to its own
     level rather than adding a layer on top of it */
  drone: d => ({ gain: d.amount != null ? clamp01(d.amount) : 0.12 }),
  strip: d => ({ gain: d.to != null ? clamp01(d.to) : 0.1 }),
  cut: () => ({ gain: 0 }),
  ramp: d => ({ weight: d.to != null ? clamp01(d.to) : 0.85 }),
  swell: d => ({ weight: d.rise != null ? clamp01(d.rise) : 0.5 }),
};

/* schema 1 said so outright; schema 2 is looked up; anything else has no
   renderer behind it yet and must say so rather than pretend */
const fxOf = spec => spec.fx || EFFECT_TO_FX[spec.id] || null;

/* schema 2 puts a tile's defaults in `dials`, not in `params` */
const dialDefaults = spec => Object.fromEntries(
  Object.entries(spec.dials || {})
    .map(([k, d]) => [k, d && typeof d === "object" ? d.default : d])
    .filter(([, v]) => v !== undefined && v !== null));

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const scoreFile = args[0];
const seed = +(args[1] || 1);
const editsFile = args[2] && !args[2].startsWith("--") ? args[2] : null;
const fps = +opt("--fps", 40);
const lightsOut = opt("--lights", null);
/* Which rig this show is being rendered for. readers/lights/layouts.js resolves
   the layout and the effect library that fits it; the SHOW is unchanged. */
const RIG = LAYOUTS.fromArgs(args);
if (!scoreFile || !lightsOut) {
  console.error("usage: effects.js <score> <seed> [edits.json] --lights <out>");
  process.exit(2);
}

const score = require(path.join(LIGHTS, "fromscore.js")).load(scoreFile);
const layout = RIG.layout, palette = RIG.palette;
const library = LAYOUTS.libraryOf(palette);

const en = enumerate(layout, { palette });
const p = plan(score, en, seed);
const S = Session(score, { now: () => 0 });
const dur = S.secondsAt((score.grid.bars || 120) + 1, 1);
const bpb = score.grid.beats_per_bar || 4;

/* bake.js's bar correction, kept identical so a bar means the same thing in
   both bakers: scores that state grid.first_bar are renumbered by nothing. */
const barBase = (score.sections && score.sections.length)
  ? Math.min(...score.sections.map(s => s.from.bar)) : 1;
const told = score.grid && score.grid.first_bar !== undefined && score.grid.first_bar !== null;
const shift = (told && score.grid.first_bar === barBase) ? 0 : 1 - barBase;

const keyHue = (p.harmony && p.harmony.key && typeof p.harmony.key.hue === "number")
  ? p.harmony.key.hue : null;

/* How much doing-to this song wants, 0..1 -- the number the "how much" fader
   moves. Taken from the arranger itself rather than mirrored here: a second copy
   of a formula that must agree with the first is a bug waiting for someone to
   edit one of them. */
const { appetite: naturalAppetite } = require("../readers/lights/arranger.js");
const natural = naturalAppetite(score);
const override = process.env.LIMELIGHT_APPETITE
  ? +parseFloat(process.env.LIMELIGHT_APPETITE).toFixed(3) : null;

const fromBeat = n => ({ bar: 1 + Math.floor(n / bpb), beat: 1 + (((n % bpb) + bpb) % bpb) });
const at = q => (q.bar - 1) * bpb + ((q.beat || 1) - 1);

const edits = editsFile ? JSON.parse(fs.readFileSync(editsFile, "utf8")) : [];
const applied = [];

/* snapshot first: the loop below removes the arranger's punctuation wherever a
   placement replaces it, and the page needs to see what was there */
const arrangerPlan = planFor(p, score.sections, bpb, shift);

for (const e of edits) {
  const spec = BY_ID[e.type];
  if (!spec) { applied.push({ ...e, skipped: "no such effect" }); continue; }
  const fx = fxOf(spec);
  if (!fx) {
    /* honest refusal: the tile exists in the catalogue but nothing downstream
       renders it, so placing it would change nothing in the room */
    applied.push({ ...e, skipped: "no renderer for this effect yet" });
    continue;
  }
  /* schema 2 has no `beats`; without the fallback this was NaN whenever the
     placement did not carry its own length */
  const fallback = +spec.beats || +spec.default_beats || 1;
  const beats = Math.max(1, Math.min(256, Math.round(+e.beats || fallback)));
  /* the page numbers bars the way protocol/session.js does; the renderer sees
     bake.js's corrected numbering, so cross the same bridge bake.js crosses */
  /* a placement may begin on any beat of its bar, not only the downbeat */
  const beat = Math.max(1, Math.min(bpb, Math.round(+e.beat || 1)));
  const startBeat = (Math.round(e.bar) - shift - 1) * bpb + (beat - 1);
  /* the tile's dials are its identity; an edit may re-dial its own copy */
  const dials = { ...dialDefaults(spec), ...(e.params || {}) };
  /* the tile's dials, said in the renderer's words; anything with no translation
     passes its dials straight through, which is what schema 1 always did */
  const translate = PARAMS_FOR[spec.id];
  const spoken = translate ? translate(dials) : null;
  const params = { ...spec.params, ...dials,
                   ...(spoken ? Object.fromEntries(
                        Object.entries(spoken).filter(([, v]) => v !== undefined)) : {}) };
  if (params.tone === "key") {
    if (keyHue !== null) params.hue = keyHue;         /* else it stays white, which is honest */
  }
  const a = {
    from: fromBeat(startBeat), to: fromBeat(startBeat + beats),
    type: fx, layer: fx === "modulate" ? "modulate" : "fx",
    priority: (FX_PRIORITY[fx] || 6) + 1,
    params, occupies: [], placed: e.type,
  };
  /* an explicit placement replaces the arranger's punctuation of the same type
     where they overlap -- otherwise frame.js's one-per-type rule could hand the
     beat back to the machine */
  const a0 = at(a.from), a1 = at(a.to);
  p.assignments = p.assignments.filter(x =>
    !(x.type === a.type && x.layer !== "par" && x.layer !== "head"
      && at(x.from) < a1 && a0 < at(x.to)));
  /* `off` clears the arranger's punctuation of this type across the span and
     puts nothing in its place -- the filter above has already done the clearing */
  if (!e.off) p.assignments.push(a);
  applied.push({ type: e.type, bar: Math.round(e.bar), beat, beats,
                 off: e.off ? true : undefined,
                 from_beat: a0, to_beat: a1, hue: params.hue === undefined ? null : params.hue });
}

const ticks = [];
for (let t = 0; t < dur; t += 1 / fps) {
  const pos = S.positionAt(t);
  const bar = pos.bar - shift;
  const F = frame({ bar, beat: pos.beat }, p, { layout, library });
  ticks.push({ t: +t.toFixed(3), bar, beat: +pos.beat.toFixed(3), fixtures: F.fixtures });
}

const beats = [], downbeats = [];
for (let b = 1; b <= (score.grid.bars || 120); b++) for (let bt = 1; bt <= bpb; bt++) {
  const s = +S.secondsAt(b, bt).toFixed(3); beats.push(s); if (bt === 1) downbeats.push(s);
}
/* the moments the score found, in seconds, so a listing can show the show at
   the place the music actually peaks rather than at a window picked at random */
const beatSec = 60 / score.grid.bpm;
const secAt = q => +S.secondsAt(q.bar + shift, q.beat || 1).toFixed(3);
const moments = require(path.join(LIGHTS, "musical.js")).momentsOf(score).map(m => ({
  t: secAt(m), bar: m.bar, kind: m.kind, what: m.what, weight: m.weight,
}));
const secOf = sb => +S.secondsAt(sb + shift, 1).toFixed(3);
const phases = (score.sections || []).map((sec, i) =>
  ({ start: secOf(sec.from.bar), end: secOf(sec.to.bar), phase: p.contexts[i] }));

const wire = require(path.join(LIGHTS, "wire.js"));
const frames = wire.toLightsFrames(ticks, layout);
const fixtures = (layout.fixtures || []).map(f => ({ id: f.id, type: f.type, address: f.address, at: f.at || [0, 0, 0] }));
fs.writeFileSync(lightsOut, JSON.stringify({
  rig: RIG.rig, layout: path.basename(RIG.file), channels: wire.widthOf(layout),
  fixtures, style: "limelight", fps,
  duration: (score.song && score.song.length_s) || +dur.toFixed(3),
  tempo: score.grid.bpm, source: (score.score || "song") + ".wav", wav: (score.score || "song") + ".wav",
  beats, downbeats, sections: phases.map(x => x.start), phases,
  moments, key_hue: keyHue, appetite: override === null ? natural : override,
  appetite_natural: natural,
  plan: arrangerPlan,
  applied, frames,
}));
console.log(`baked ${frames.length} frames on ${RIG.rig} (${fixtures.length} fixtures, ${wire.widthOf(layout)}ch, seed ${seed}, ${applied.length} placed) -> ${lightsOut}`);
