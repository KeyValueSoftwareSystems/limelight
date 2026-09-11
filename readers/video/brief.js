// A brief should read like direction, not like a config file.
//
// Briefs grew to twenty keys: coherence radius, subject tolerance, subject
// minimum shots, subject variety, mood weight, five preference ranges, a
// salience floor, effects per minute, reuse caps. Every one of those is a real
// number the policy needs, and not one of them is a thing a person says when
// they are describing a film. "Fast and bright" is.
//
// So a brief now says what it wants in words, and this expands the words into
// the numbers. Anything can still be overridden by naming it directly -- the
// expansion runs first and an explicit key always wins -- so nothing is hidden,
// it is just no longer compulsory.
"use strict";

// The WORDS come from readers/recipe.js, which the lighting and drone readers
// read too. The numbers below stay here, because pixels of camera motion mean
// nothing to a fixture -- but if the two files ever disagree about which words
// exist, a person who learned the vocabulary on one reader is wrong on the
// next, silently. So it is checked at load, once, and loudly.
const RECIPE = require("../recipe.js");

const PACE = {
  slow:     { cuts_per_minute:  8, min_shot_s: 2.4, max_shot_s: 12.0, salience_floor: 0.60 },
  measured: { cuts_per_minute: 16, min_shot_s: 1.4, max_shot_s:  6.0, salience_floor: 0.38 },
  fast:     { cuts_per_minute: 34, min_shot_s: 0.55, max_shot_s: 2.6, salience_floor: 0.14 },
  frantic:  { cuts_per_minute: 52, min_shot_s: 0.35, max_shot_s: 1.6, salience_floor: 0.08 },
};

const LOOK = {
  bright:  { brightness:[0.45,0.98], contrast:[0.03,0.45], saturation:[0.05,0.80] },
  dark:    { brightness:[0.03,0.45], contrast:[0.08,0.50], saturation:[0.00,0.55] },
  neon:    { brightness:[0.08,0.60], contrast:[0.10,0.50], saturation:[0.30,1.00] },
  natural: { brightness:[0.20,0.80], contrast:[0.06,0.45], saturation:[0.10,0.90] },
};

const MOTION = {
  still:   { camera_motion_px_s:[0,  60], subject_motion_px_s:[0, 120] },
  calm:    { camera_motion_px_s:[0, 160], subject_motion_px_s:[0, 260] },
  moving:  { camera_motion_px_s:[10,300], subject_motion_px_s:[20,420] },
  kinetic: { camera_motion_px_s:[40,500], subject_motion_px_s:[60,600] },
};

// How much the picture is allowed to do on top of the cutting.
const EFFECTS = {
  none:       { effects_per_minute:  0 },
  restrained: { effects_per_minute:  4 },
  punchy:     { effects_per_minute:  9 },
  loud:       { effects_per_minute: 16 },
};

const FORMAT = {
  "9:16": { width:1080, height:1920, fps:30 },
  "16:9": { width:1920, height:1080, fps:25 },
  "1:1":  { width:1080, height:1080, fps:30 },
};

(function checkVocabulary() {
  const mine = { pace: PACE, look: LOOK, motion: MOTION, effects: EFFECTS };
  for (const axis of Object.keys(RECIPE.AXES)) {
    const shared = RECIPE.AXES[axis].words.slice().sort();
    const here = Object.keys(mine[axis] || {}).sort();
    if (shared.join("|") !== here.join("|")) {
      throw new Error(
        "recipe vocabulary drift on `" + axis + "`: readers/recipe.js says [" +
        shared.join(", ") + "] and readers/video/brief.js says [" + here.join(", ") +
        "]. One vocabulary, three readers -- add the word to both or to neither.");
    }
  }
})();

function expand(b) {
  const out = Object.assign({}, b);

  if (typeof b.format === "string") {
    out.format = Object.assign({}, FORMAT[b.format] || FORMAT["9:16"]);
    if (b.fps) out.format.fps = b.fps;
  }

  const pace = PACE[b.pace] || PACE.measured;
  out.budgets = Object.assign({}, pace, b.budgets || {});
  if (out.salience_floor === undefined) out.salience_floor = out.budgets.salience_floor;
  delete out.budgets.salience_floor;

  const look = LOOK[b.look] || LOOK.natural;
  const motion = MOTION[b.motion] || MOTION.calm;
  out.prefers = Object.assign({}, look, motion, b.prefers || {});

  const fx = EFFECTS[b.effects] || EFFECTS.restrained;
  out.effects = Object.assign({}, fx, typeof b.effects === "object" ? b.effects : {});

  // Sensible defaults for everything a brief should not have to mention.
  if (out.restraint === undefined) {
    out.restraint = { allow_no_change: true,
                      min_rest_s: Math.max(1.2, out.budgets.max_shot_s * 0.6),
                      hold_before_major_s: out.budgets.min_shot_s * 2,
                      preserve_headroom: true };
  }
  if (out.callbacks === undefined) out.callbacks = {};
  if (out.callbacks.repeat_visual_on_repeated_music === undefined)
    out.callbacks.repeat_visual_on_repeated_music = true;
  // A top-level key wins over the default. The whole promise of this expansion
  // is that naming something directly still works; the first version quietly
  // ignored a top-level max_reuses_per_clip and wrote the default over it,
  // which left a single-file pool with two usable shots.
  if (out.callbacks.max_reuses_per_clip === undefined)
    out.callbacks.max_reuses_per_clip =
      (b.max_reuses_per_clip !== undefined) ? b.max_reuses_per_clip : 2;
  if (out.subject_variety === undefined) out.subject_variety = 0.20;
  if (out.mood_weight === undefined) out.mood_weight = 0.0;
  // Look-clustering is superseded by subject words and is off unless asked for.
  if (out.coherence === undefined) out.coherence = { radius: 0.90, min_shots: 100000 };
  // `story` is a shape, not a level, so it passes through as the word it is.
  if (b.story !== undefined) out.story = b.story;
  if (b.arrival !== undefined) out.arrival = b.arrival;
  if (b.subject_word !== undefined) out.subject_word = b.subject_word;
  return out;
}

module.exports = { expand: expand, PACE: PACE, LOOK: LOOK, MOTION: MOTION,
                   EFFECTS: EFFECTS, FORMAT: FORMAT };
