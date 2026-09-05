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

function frame(t){
  const k = Math.floor((t - PH) / PER);
  const age = t - (PH + k * PER);
  const lv = (k < 0 || age < 0) ? 0 : Math.exp(-age / DECAY);

  const F = [];
  for(const f of LAYOUT.fixtures){
    if(f.kind !== "par") continue;
    F.push({ id:f.id, level:+lv.toFixed(4),
             r:WHITE[0], g:WHITE[1], b:WHITE[2] });
  }
  return { t:+t.toFixed(3), look:"beat", fixtures:F };
}
