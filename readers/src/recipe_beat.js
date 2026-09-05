/* The beat, and nothing else.
   ----------------------------------------------------------------------------
   Every other recipe in this repo is trying to be a light show, and that is the
   problem with using one to judge timing: a chase, a build, a colour bed and an
   anticipation dip all move the light at once, so when something looks late you
   cannot tell which of them was late. Renjith could not tell whether the lights
   were on the beat because six things were moving and only one of them was the
   beat.

   This recipe removes all of it. There is one rule:

       on a beat, all five pars go to full, then decay.

   No chase, no colour, no sections, no energy, no accents, no moments, no fog.
   Every beat is identical, so a beat that LOOKS different is a fault in the grid
   rather than a choice in the recipe. If this does not read as locked to the
   music, nothing built on top of it will, and there is no point tuning anything
   else until it does.

   The decay is the only free number. Too long and the flashes merge into a glow
   that hides the timing; too short and it strobes. A fixed fraction of the beat
   keeps the gap visible at any tempo. */

const DECAY = Math.max(0.055, PER * 0.22);
const WHITE = [255, 250, 242];

/* Reads the map's beat list, NOT tempo and phase. That is the whole point: the
   file is the control surface, so deleting an entry removes a flash and moving
   one moves it. Deriving the beats from a formula here would silently ignore
   every hand edit. */
function frame(t){
  let lo = 0, hi = BEATS.length - 1, k = -1;
  while(lo <= hi){ const mi = (lo + hi) >> 1; if(BEATS[mi] <= t){ k = mi; lo = mi + 1 } else hi = mi - 1 }
  const lv = k < 0 ? 0 : Math.exp(-(t - BEATS[k]) / DECAY);

  const F = [];
  for(const f of LAYOUT.fixtures){
    if(f.kind !== "par") continue;
    F.push({ id:f.id, level:+lv.toFixed(4),
             r:WHITE[0], g:WHITE[1], b:WHITE[2] });
  }
  return { t:+t.toFixed(3), look:"beat", fixtures:F };
}
