/* The whole of what a lighting application writes.  OWNER: Dheeraj.
   ---------------------------------------------------------------------------
   This file is the answer to "is the protocol too complicated for an app?".
   It is the complete translation from the shared vocabulary into lamps. There
   is no map reading here, no beat tracking, no grid arithmetic, no
   interpolation and no clock -- the session did all of that on our side of the
   wire before we were called.

   What is left is the only part that was ever ours: taste. What does "how much
   is going on" look like when the thing you own is eight lamps in a row.

   A drone reader writes a file this size and this shape, and shares none of it. */
"use strict";

const LIGHTS = {

  /* how much of the song is happening -> how many lamps are lit.
     A row of lamps can show about nine countable states, which is why
     pre-flight puts `amount` on extent and refuses it on a two-unit rig. */
  amount(v, rig) {
    return { lit: Math.max(1, Math.round(v * rig.pars.length)) };
  },

  /* the beat -> brightness inside the beat. Not "on the beat, start a fade":
     brightness is a function of where we are within the beat, which is what
     makes the same instant render the same way twice. */
  pulse(p) {
    /* Before the first beat there is no beat to be inside, so hold the floor.
       And clamp: a level above 1 is a bug somewhere upstream, and a fixture
       will happily accept it and look wrong. */
    if (p.before_grid) return { gain: 0.22, white: false };
    const phase = Math.max(0, Math.min(1, p.phase));
    const fall = Math.pow(1 - phase, 2.2);
    return { gain: Math.min(1, 0.22 + 0.78 * fall), white: p.accent && phase < 0.12 };
  },

  /* the arrival -> everything, white, briefly. A moment, not a curve, so it is
     never smoothed: you either land the drop or you do not. */
  impact() {
    return { all: true, white: true, hold_beats: 1 };
  },

  /* what the section is called -> a floor under the whole room, so a quiet
     part is dim rather than dark and a chorus never has to start from nothing. */
  span(name) {
    return { bed: ({ intro: 0.05, verse: 0.10, break: 0.04, build: 0.12,
                     drop: 0.16, chorus: 0.16, quiet: 0.03, outro: 0.06 })[name] ?? 0.08 };
  },
};

/* Compose the pieces into one instant. Everything above returns an intent;
   this is the only place they are combined, and `max` rather than `sum` is
   deliberate -- a bed added UNDER a pulse raises the floor and eats the
   contrast, which measured 1.44:1 before we changed it and 7.34:1 after. */
function lightsFrame(read, rig) {
  const out = rig.pars.map(() => ({ level: 0, white: false }));
  const bed = read.span ? LIGHTS.span(read.span.name).bed : 0.06;
  const lit = read.amount != null ? LIGHTS.amount(read.amount, rig).lit : rig.pars.length;
  const pulse = read.pulse ? LIGHTS.pulse(read.pulse) : { gain: 1, white: false };

  const mid = (rig.pars.length - 1) / 2;
  const order = rig.pars.map((_, i) => i)
    .sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));   /* fill from the middle out */

  for (let n = 0; n < lit; n++) {
    const i = order[n];
    out[i].level = Math.max(bed, pulse.gain);
    out[i].white = !!pulse.white;
  }
  if (read.impact) {
    const s = LIGHTS.impact();
    for (const o of out) { o.level = 1; o.white = !!s.white; }
  }
  return out;
}

if (typeof module !== "undefined" && module.exports) module.exports = { LIGHTS, lightsFrame };
if (typeof window !== "undefined") window.LimelightLights = { LIGHTS, lightsFrame };
