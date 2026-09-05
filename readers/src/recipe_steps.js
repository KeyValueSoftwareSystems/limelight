/* The learning ladder.
   ----------------------------------------------------------------------------
   recipe4.js is 800 lines that all run at once, which is why nobody could say
   which part was wrong. This file does the same job as a ladder: STEP says how
   many rungs are switched on, each rung adds exactly ONE element, and everything
   above STEP is off.

   The point is not that this is a smaller show. The point is that a fault at
   rung n cannot be caused by rung n+1, so "it looks wrong" becomes a question
   with one answer instead of six.

     1 beats       every beat, all five pars, flat
     2 bar         beat 1 brighter than beats 2-4
     3 position    which par, rather than all of them
     4 sections    the rig gets bigger and smaller with the song
     5 colour      a profile, two colours at a time
     6 accents     the drum hits between the beats
     7 heads       the two moving heads come back

   Each rung is judged by a check in build.html that can FAIL, not by whether it
   looks nice. Rungs are accepted one at a time and written to
   synth/learning/<song>.json, which is what makes this a learning phase rather
   than a tuning session: the accepted settings are the starting point for a song
   nobody has mapped yet. */

const STEP = (function(){ try { return Math.max(1, Math.min(7, +LADDER || 1)) } catch(e) { return 1 } })();

const DECAY    = Math.max(0.055, PER * 0.22);
/* One number per rung, set on the page and written into the learning file, so the
   value that survives is the one a human chose while watching -- not one I picked
   while writing this. */
const K = (function(){ try { return (KNOB===null||KNOB===undefined) ? null : +KNOB } catch(e){ return null } })();
const OFFBEAT  = K!==null && STEP===2 ? K : 0.5;   // rung 2: beats 2-4 against the downbeat
const WHITE    = [255, 250, 242];
const PARS     = LAYOUT.fixtures.filter(f => f.kind === "par");
const HEADS    = LAYOUT.fixtures.filter(f => f.kind === "head");
const NP       = Math.max(1, PARS.length);
const DOWNSET  = new Set(DOWN.map(t => +t.toFixed(3)));

/* rung 5: colour, from a fixed profile. Two on stage at a time, never a hue
   between them -- the whole reason the old show looked random. */
const PROFILES = {
  sunset: { a:[ 24,.90,.50], b:[196,.86,.44] },
  ice:    { a:[202,.88,.48], b:[318,.86,.50] },
  neon:   { a:[316,.92,.52], b:[ 42,.94,.54] },
  amber:  { a:[ 34,.84,.52], b:[ 16,.92,.50] },
};
const PAL = PROFILES[(function(){ try { return COLOUR } catch(e){ return "sunset" } })()] || PROFILES.sunset;
function hsl(h,s,l){
  h=((h%360)+360)%360; const c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs(((h/60)%2)-1)), m=l-c/2;
  let r,g,b;
  if(h<60){r=c;g=x;b=0} else if(h<120){r=x;g=c;b=0} else if(h<180){r=0;g=c;b=x}
  else if(h<240){r=0;g=x;b=c} else if(h<300){r=x;g=0;b=c} else {r=c;g=0;b=x}
  return [Math.round((r+m)*255),Math.round((g+m)*255),Math.round((b+m)*255)]}

const cl=(v,a,b)=>v<a?a:v>b?b:v;
const chIdx=t=>{ let j=0; for(let i=0;i<CH.length;i++) if(CH[i][0]<=t) j=i; else break; return j };

/* rung 4: the song's own energy curve, held between its samples rather than
   interpolated -- energy is measured per downbeat, so a bar has one value */
function energyAt(t){
  if(!EN || !EN.length) return 0.5;
  let lo=0, hi=EN.length-1, k=0;
  while(lo<=hi){ const mi=(lo+hi)>>1; if(EN[mi][0]<=t){ k=mi; lo=mi+1 } else hi=mi-1 }
  return EN[k][1];
}

/* rung 6: the hits that are NOT on a beat. Rung 1 already covers the beats, so
   this rung adds only what the grid cannot express. */
const OFFGRID = (function(){
  if(STEP < 6) return [];
  const src = (MAP.accents && MAP.accents.events) || [];
  const out = [];
  for(const a of src){
    if(a.strength < 0.24) continue;
    let d = Infinity;
    for(const b of BEATS){ const x=Math.abs(b-a.at); if(x<d) d=x; if(b>a.at+1) break }
    if(d < 0.06) continue;                       // already lit by rung 1
    if(out.length && a.at - out[out.length-1].at < 0.14) continue;
    out.push(a);
  }
  return out })();

function beatIndex(t){
  let lo=0, hi=BEATS.length-1, k=-1;
  while(lo<=hi){ const mi=(lo+hi)>>1; if(BEATS[mi]<=t){ k=mi; lo=mi+1 } else hi=mi-1 }
  return k;
}

function frame(t){
  const k  = beatIndex(t);
  const bt = k < 0 ? -99 : BEATS[k];
  const isDown = k >= 0 && DOWNSET.has(+bt.toFixed(3));
  const env = k < 0 ? 0 : Math.exp(-(t - bt) / DECAY);

  // ---- rung 1: every beat, flat -------------------------------------------
  let amp = 1;
  // ---- rung 2: the bar ----------------------------------------------------
  if(STEP >= 2 && !isDown) amp = OFFBEAT;
  // ---- rung 4: the song gets bigger and smaller ---------------------------
  let size = 1;
  if(STEP >= 4) size = 0.34 + 0.66 * cl(energyAt(t), 0, 1);

  /* ---- rung 3: WHICH par, not all of them --------------------------------
     The bar walks across the rig, one par per beat, and the downbeat opens all
     five. That is the smallest use of the fact that a rig has positions, and it
     is the reason position has to be in the layout at all. */
  let lit = null;                                    // null = every par
  if(STEP >= 3 && k >= 0 && !isDown){
    let d = 0; for(let j=k; j>=0 && !DOWNSET.has(+BEATS[j].toFixed(3)); j--) d++;
    lit = d % NP;
  }

  const F = [];
  PARS.forEach((f, i) => {
    let lv = (lit === null || lit === i) ? amp * env * size : 0;
    let col = WHITE;
    // ---- rung 5: colour ---------------------------------------------------
    if(STEP >= 5){
      const c = (i % 2 === 0) ? PAL.a : PAL.b;
      const e = energyAt(t);
      col = isDown ? WHITE : hsl(c[0], cl(c[1]*(0.86+0.20*e),0,1), cl(c[2]*(0.84+0.28*e),0,1));
    }
    F.push({ id:f.id, level:+cl(lv,0,1).toFixed(4), r:col[0], g:col[1], b:col[2] });
  });

  // ---- rung 6: the hits between the beats ---------------------------------
  if(STEP >= 6 && OFFGRID.length){
    let lo=0, hi=OFFGRID.length-1, j=-1;
    while(lo<=hi){ const mi=(lo+hi)>>1; if(OFFGRID[mi].at<=t){ j=mi; lo=mi+1 } else hi=mi-1 }
    if(j >= 0){
      const a = OFFGRID[j], ae = Math.exp(-(t - a.at) / (DECAY * 0.55));
      const add = 0.55 * ae * cl(a.strength / 0.45, 0, 1) * (STEP >= 4 ? (0.34+0.66*energyAt(t)) : 1);
      if(add > 0.004){
        const p = Math.abs(Math.round(a.at * 1000)) % NP;   // deterministic, not random
        F[p].level = +cl(F[p].level + add, 0, 1).toFixed(4);
      }
    }
  }

  // ---- rung 7: the heads --------------------------------------------------
  if(STEP >= 7){
    const e = energyAt(t), sweep = Math.sin(2*Math.PI * t / (BAR*2));
    HEADS.forEach((f, i) => {
      const s = i === 0 ? sweep : -sweep;
      F.push({ id:f.id, level:+cl((0.30+0.55*e) * (0.55+0.45*env), 0, 1).toFixed(4),
               pan:+(0.5 + 0.34*s).toFixed(4), tilt:+(0.42 + 0.16*s*e).toFixed(4),
               r:PAL.b ? hsl(PAL.b[0],0.86,0.48)[0] : 255,
               g:hsl(PAL.b[0],0.86,0.48)[1], b:hsl(PAL.b[0],0.86,0.48)[2] });
    });
  }

  return { t:+t.toFixed(3), look:"step"+STEP, step:STEP, fixtures:F };
}
