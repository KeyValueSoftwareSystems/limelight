// The recipe: the words a person says, shared by every reader.
//
// The map is one file that three readers turn into three art forms. The recipe
// had not followed: the video lane grew `pace / look / motion / effects`, the
// lighting recipe grew `ENERGY: low | medium | high`, and the drone reader grew
// its own thing again. Three vocabularies for one job means a person who has
// described the show they want has to describe it twice more, and the words
// they learn for one reader are worthless for the next.
//
// So the vocabulary lives here, once, and each reader expands it its own way.
// The same sentence -- "fast, dark, punchy" -- is a cut rate to the video
// reader, a chase rate to the lighting reader, and a formation rate to the
// drones. That is the same argument the map itself makes, one level up: the
// description is universal, the interpretation is the reader's.
//
// WHAT DOES NOT BELONG HERE. Numbers a reader needs and no other reader has a
// use for -- pixels of camera motion, DMX channels, metres of altitude. Those
// stay in the reader. This file holds only what a PERSON said, plus the table
// of what the words mean on a 0..1 scale, which is the one thing all three can
// agree on.
//
// SAFETY IS NOT HERE EITHER. AGENTS.md rule 5: safety lives in the layout,
// never in the recipe. "loud" is a request for more effect, and the layout's
// max_strobe_hz still refuses it. Nothing in this file can raise a limit.
"use strict";

// Each axis, its words in order, and where each word sits on 0..1. The
// POSITION is the shared meaning: a reader turns 0..1 into its own units, so
// adding a word here works everywhere at once, and "fast" can never mean
// something different to the lights than it does to the cut.
const AXES = {
  pace:    { words: ["slow", "measured", "fast", "frantic"],
             at: [0.15, 0.40, 0.72, 1.00],
             means: "how often the show is allowed to change" },
  look:    { words: ["dark", "natural", "bright", "neon"],
             at: [0.15, 0.45, 0.75, 0.95],
             means: "how much light is in the picture, and how saturated" },
  motion:  { words: ["still", "calm", "moving", "kinetic"],
             at: [0.05, 0.30, 0.65, 1.00],
             means: "how much the frame or the fixture travels" },
  effects: { words: ["none", "restrained", "punchy", "loud"],
             at: [0.00, 0.30, 0.65, 1.00],
             means: "how much is done ON TOP of the basic change" },
};

// STORY is the one axis that is not a level, because a film is not one value --
// it is a shape over its own length. Everything else in this file answers "how
// much"; this answers "how much, WHEN".
//
// It exists because the video reader had no notion of a film going anywhere.
// Every shot was chosen by the same local fit -- right brightness, right mood,
// same world as the last one -- at every point in the piece, so the result was
// a montage that landed on the beat. A person asked to rank six of them could
// not, and was right not to.
//
// The numbers are measured, not invented. The 5C spot, which is the reference
// this lane keeps being judged against, runs its first half at 1.96 s and 391
// px/s of subject motion and its last half at 2.88 s and 177 -- 47% longer and
// 55% stiller. A film decelerates into its payoff. `settles` is that shape.
//
// `energy` here is what the PICTURE should be doing, 0..1, as a function of how
// far through the piece we are. A reader turns it into whatever it has: the
// video reader prefers shots whose measured motion matches it, the lighting
// reader can push the room, the drones can slow the sky.
const STORY = {
  flat:    { at: [1.00, 1.00, 1.00, 1.00, 1.00],
             means: "no shape. every moment is the same moment" },
  settles: { at: [1.00, 0.92, 0.74, 0.45, 0.18],
             means: "busy, then it calms into the thing it was for" },
  builds:  { at: [0.22, 0.42, 0.66, 0.88, 1.00],
             means: "quiet, then it arrives" },
  swells:  { at: [0.35, 0.75, 1.00, 0.70, 0.30],
             means: "arrives in the middle and lets go" },
};

// WHERE THE SUBJECT IS. The other half of story, and the half that makes a
// montage a film.
//
// An ad has a thing it is about. It does not show that thing uniformly from the
// first frame to the last: it opens on something else, arrives, and ends on it.
// The video reader had no notion of a subject at all -- every shot was chosen by
// the same local fit, so the product appeared at random and the piece had
// nothing to resolve. Asked to rank six of those, a person correctly said they
// could not be judged.
//
// 0 means "this shot need not contain the subject", 1 means "it should".
const ARRIVAL = {
  late:    { at: [0.15, 0.30, 0.55, 0.85, 1.00],
             means: "open elsewhere, arrive at it, end on it" },
  early:   { at: [1.00, 0.85, 0.55, 0.35, 0.25],
             means: "state it immediately, then explore around it" },
  present: { at: [0.80, 0.80, 0.80, 0.80, 0.80],
             means: "it is in almost every shot" },
  absent:  { at: [0.00, 0.00, 0.00, 0.00, 0.00],
             means: "no subject. a mood piece" },
};

function curveAt(c, p) {
  if (!(p >= 0)) p = 0;
  if (p > 1) p = 1;
  const x = p * (c.length - 1), i = Math.min(c.length - 2, Math.floor(x));
  return c[i] + (c[i + 1] - c[i]) * (x - i);
}

function arrivalAt(name, p) {
  return curveAt((ARRIVAL[name] || ARRIVAL.late).at, p);
}

// The wanted picture energy at position p (0..1 through the piece).
function storyAt(name, p) {
  const c = (STORY[name] || STORY.flat).at;
  if (!(p >= 0)) p = 0;
  if (p > 1) p = 1;
  const x = p * (c.length - 1), i = Math.min(c.length - 2, Math.floor(x));
  return c[i] + (c[i + 1] - c[i]) * (x - i);
}

function level(axis, word) {
  const a = AXES[axis];
  if (!a) return null;
  const i = a.words.indexOf(word);
  return i < 0 ? null : a.at[i];
}

// A word for a position, so a reader that computes a level can say it back in
// the shared vocabulary rather than printing a number nobody asked for.
function word(axis, x) {
  const a = AXES[axis];
  if (!a) return null;
  let best = 0;
  for (let i = 1; i < a.at.length; i++)
    if (Math.abs(a.at[i] - x) < Math.abs(a.at[best] - x)) best = i;
  return a.words[best];
}

// `energy` is the lighting desk's one-knob shorthand and it stays, because an
// operator on a show does not want four words at 2am. It sets every axis that
// the recipe did not name itself.
const ENERGY_AS = {
  low:    { pace: "slow",     motion: "calm",   effects: "restrained" },
  medium: { pace: "measured", motion: "moving", effects: "punchy" },
  high:   { pace: "fast",     motion: "kinetic", effects: "loud" },
};

function normalise(recipe) {
  const r = Object.assign({}, recipe || {});
  const e = ENERGY_AS[r.energy];
  if (e) for (const k of Object.keys(e)) if (r[k] === undefined) r[k] = e[k];
  return r;
}

// ---- what each reader does with the same words ----------------------------

// The lighting reader's knobs, which were reachable only through low/medium/
// high. Four words is strictly more than one knob: "fast and restrained" -- a
// room that changes often without being hit -- had no way to be asked for.
function forLights(recipe) {
  const r = normalise(recipe);
  const p = level("pace", r.pace), l = level("look", r.look);
  const m = level("motion", r.motion), f = level("effects", r.effects);
  const lerp = function (a, b, x) { return a + (b - a) * (x === null ? 0.5 : x); };
  return {
    // How bright the room sits, and how far the darks are allowed to fall.
    base:   +lerp(0.72, 1.18, l).toFixed(3),
    span:   +lerp(0.80, 1.30, l).toFixed(3),
    // How much the chase runs, which is the lighting word for pace.
    chase:  +lerp(0.45, 1.45, p).toFixed(3),
    // How sharply the room answers a drum hit.
    accent: +lerp(0.55, 1.55, f).toFixed(3),
    // How far the heads travel. Still capped by the layout's slew limit.
    motion: +lerp(0.55, 1.45, m).toFixed(3),
    // A request, not a permission. layout.limits.max_strobe_hz still decides.
    strobe: +lerp(0.00, 1.60, f).toFixed(3),
    haze:   +lerp(0.75, 1.20, l).toFixed(3),
  };
}

// The drone reader. Same words, and they have to mean the drone equivalent or
// the vocabulary is a lie: pace is how often the sky re-forms, motion is how
// far a drone travels to get there, effects is colour and flash on top.
function forDrones(recipe) {
  const r = normalise(recipe);
  const p = level("pace", r.pace), m = level("motion", r.motion);
  const f = level("effects", r.effects), l = level("look", r.look);
  const lerp = function (a, b, x) { return a + (b - a) * (x === null ? 0.5 : x); };
  return {
    formations_per_minute: +lerp(1.5, 9.0, p).toFixed(2),
    travel:                +lerp(0.25, 1.00, m).toFixed(3),
    colour_change:         +lerp(0.10, 1.00, f).toFixed(3),
    brightness:            +lerp(0.35, 1.00, l).toFixed(3),
  };
}

module.exports = { AXES: AXES, STORY: STORY, storyAt: storyAt,
                   ARRIVAL: ARRIVAL, arrivalAt: arrivalAt,
                   level: level, word: word,
                   normalise: normalise, ENERGY_AS: ENERGY_AS,
                   forLights: forLights, forDrones: forDrones };
