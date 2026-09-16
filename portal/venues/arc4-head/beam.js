"use strict";
const H = require("./helpers");
const { kick } = require("./beat");

/* beam — the moving head as an INSTRUMENT. Drives only the head; the pars keep
   whatever state is underneath, so this layers over a bed.

   pattern
     stations  the soloist move: on every downbeat the head SNAPS to the next of
               four wall positions, then drifts across the bar with a tilt that
               kicks on each beat. Four bars = four places = a phrase.
     snap      wall-to-wall on alternate beats. The drop move.
     sweep     one pass across the room per bar.
     figure8   the old default, a slow loop.
   amount      how bright (0..1); the editor's intensity slider writes this.
   prism       0 = clean beam, 100 = six-facet prism. Default 0: a prism that is
               always on is what makes a cheap head look cheap. Spend it.
   strobe      hz, 0 = off. Fires for the first part of each downbeat (strobe_on
               "downbeat"), each beat ("beat"), or continuously ("always"). */
module.exports = function beam(params, ctx) {
  const pattern = params.pattern || "figure8";
  const colour = H.parseColour(params.colour, [1, 1, 1]);
  const amount = H.clamp(params.amount != null ? params.amount : 0.85, 0, 1);
  const prism = params.prism != null ? params.prism : 0;
  const strobeHz = params.strobe != null ? Math.min(25, Math.max(0, params.strobe)) : 0;
  const strobeOn = params.strobe_on || "downbeat";
  /* accents: where the MUSIC punches inside the bar, as beat positions (1 = the
     downbeat, 2.5 = the "and" of two). On each one the head kicks its tilt and
     fires its strobe -- the two things it can do instantly. Turning is slow on
     this fixture (7 units a frame, a full beat wall to wall), so rhythm has to
     live in the nod and the flash, not in the turn. */
  const accents = Array.isArray(params.accents) ? params.accents.map(Number) : [];
  const anticipate = params.anticipate !== false;     // start a turn a beat early so the ARRIVAL lands on the beat
  const prismOn = params.prism_on || "always";         // "always" | "beat": pulse it on the front of each beat
  const STATIONS = [[0.12, 0.30], [0.86, 0.34], [0.30, 0.70], [0.70, 0.66]];   // pan, tilt

  function render(bx) {
    /* The baker says which beats are DOWNBEATS and which bar we are in; do not
       re-derive either from beatIndex % 4. The beat index is not bar-aligned on
       every score, and guessing from it put the downbeat strobe on a beat that
       never came. */
    const { beat, bphase, beatIndex, energy } = bx;
    const isDown = !!bx.downbeat;
    const barIdx = bx.bar != null ? bx.bar : Math.floor(beatIndex / 4);
    const bi = isDown ? 0 : (((beatIndex % 4) + 4) % 4 || 1);
    const beatInBar = bi + bphase;
    let pan, tilt;
    /* how close are we to an accent? 1 on it, falling to 0 over a third of a beat */
    const hit = accents.reduce((m, a) => { const d = beatInBar + 1 - a; return (d >= 0 && d < 0.34) ? Math.max(m, 1 - d / 0.34) : m; }, 0);
    if (pattern === "hold") {
      /* a still pin on the wall. Where it points is the cue's to say (pan, tilt
         0..1); it does not move, does not kick, does not flash. The head at rest
         is what makes its first movement an event. */
      pan = params.pan != null ? params.pan : 0.66; tilt = params.tilt != null ? params.tilt : 0.42;
    } else if (pattern === "stations") {
      /* the station for THIS bar -- or, from beat 4, for the NEXT bar, so the
         head is already travelling and arrives on the downbeat instead of
         leaving on it */
      const which = (anticipate && beatInBar >= 3.0) ? barIdx + 1 : barIdx;
      const [p0, t0] = STATIONS[((which % 4) + 4) % 4];
      const drift = 0.10 * (beatInBar / 4) * (barIdx % 2 ? -1 : 1);          // the bar-long drift
      pan = p0 + drift; tilt = t0 + 0.06 * kick(bphase) + 0.24 * hit;        // small nod each beat, a big one on the accents
    } else if (pattern === "snap") {
      /* Every TWO beats, 0.15 to 0.85. Wall to wall on every beat asked this head
         to cross 255 pan units in half a second, and its slew limit is 7 units a
         frame -- so it never arrived anywhere and hovered at mid-pan through the
         whole drop. 180 units in a second lands with room to spare and reads as
         a decision, not a shiver. */
      const side = Math.floor((beatIndex + (anticipate ? 1 : 0)) / 2) % 2;   // leave a beat early, arrive on the beat
      pan = side ? 0.80 : 0.20; tilt = 0.30 + 0.30 * (Math.floor(beatIndex / 4) % 2) + 0.10 * kick(bphase) + 0.22 * hit;
    } else if (pattern === "sweep") {
      const s = 1 - Math.abs(2 * (beatInBar / 4) - 1); pan = 0.02 + 0.96 * s; tilt = 0.16 + 0.72 * kick(bphase);
    } else {
      const w = 2 * Math.PI * beat / 4; pan = 0.498 + 0.47 * Math.sin(w); tilt = 0.498 + 0.4 * Math.sin(2 * w);
    }
    const fire = strobeHz > 0 &&   /* a pin with strobe 0 never fires; one asked to flash, flashes */
      (strobeOn === "always" || (strobeOn === "beat" && bphase < 0.35) || (strobeOn === "downbeat" && isDown && bphase < 0.5) || hit > 0.4);
    const prismNow = prismOn === "beat" ? (bphase < 0.4 ? prism : 0) : prism;
    const f = H.emptyFrame();
    H.setHead(f, H.HEADS[0], {
      level: amount * (0.85 + 0.15 * energy), colour,
      pan: H.clamp(pan, 0, 1), tilt: H.clamp(tilt, 0, 1),
      gobo: params.gobo != null ? params.gobo : 0, prism: prismNow,
      strobe: fire ? strobeHz : 0,
    });
    return f;
  }
  return { beat: true, render, per_fixture: H.HEAD_IDS };
};
