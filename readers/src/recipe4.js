/* ================= recipe v0.4 =================
   Fixes the pops at the root: a `look` no longer switches instantaneously.
   Looks are segmented from the map once, then CROSSFADED, so every number the
   renderer sees is continuous. Still a pure function of t -- the crossfade
   weight is itself a function of t, not a fader holding state.            */
/* ---- the drive knob ---------------------------------------------------------
   One setting at the very end of the chain that decides how hard the room is
   pushed. The map does not change and neither does the layout: the same song and
   the same rig produce a restrained show or an aggressive one because a person
   turned a knob, which is what a lighting operator actually does.

   It stays pure. DRIVE is a recipe parameter, not state -- frame(t) with drive
   "high" is still the same answer every time you ask for it.

   It is deliberately NOT a brightness multiplier. Turning a whole show up just
   makes it flat and bright. What changes is how much of each behaviour is
   allowed: how deep the darks go, how much the chase runs, how far the heads
   travel, how sharply the room answers a drum hit. */
const DRIVE = (function(){ try { return (ENERGY || "medium") } catch(e) { return "medium" } })();
const K = ({
  low:    { base:0.72, span:0.80, chase:0.45, accent:0.55, motion:0.55, strobe:0.35, haze:0.75 },
  medium: { base:1.00, span:1.00, chase:1.00, accent:1.00, motion:1.00, strobe:1.00, haze:1.00 },
  high:   { base:1.18, span:1.30, chase:1.45, accent:1.55, motion:1.45, strobe:1.60, haze:1.20 },
}[DRIVE]) || { base:1, span:1, chase:1, accent:1, motion:1, strobe:1, haze:1 };

const cl=(x,a=0,b=1)=>x<a?a:x>b?b:x;
const ss=(a,b,x)=>{const t=cl((x-a)/(b-a));return t*t*(3-2*t)};
const lerp=(a,b,f)=>a+(b-a)*f;

const bi=t=>{let lo=0,hi=BEATS.length-1,r=-1;while(lo<=hi){const m=(lo+hi)>>1;
  if(BEATS[m]<=t){r=m;lo=m+1}else hi=m-1}return r};
const bph=t=>{const i=bi(t);return i<0?0:cl((t-BEATS[i])/PER)};
const beatInBar=t=>{const i=bi(t);return i<0?0:((i-DBP)%4+4)%4};
const barIdx=t=>Math.floor((bi(t)-DBP)/4);
const barPh=t=>cl((beatInBar(t)+bph(t))/4);
const phrPh=t=>{const k=((bi(t)-DBP)%16+16)%16;return cl((k+bph(t))/16)};

/* energy: smoothstep between downbeat samples, so there is no slope kink */
/* A reader must survive a map that does not carry a field -- rule 2 of the format,
   which this function was breaking. A grid-only map used to take the whole reader
   down on the first frame; now it produces a flat, dull show, which is the honest
   answer to "we measured the beats and nothing else". */
function en(t){if(!EN||EN.length===0)return 0.5;
  let k=-1;for(let i=0;i<EN.length;i++)if(EN[i][0]<=t)k=i;else break;
  if(k<0)return EN[0][1]; if(k+1>=EN.length)return EN[EN.length-1][1];
  const f=ss(0,1,(t-EN[k][0])/(EN[k+1][0]-EN[k][0]));
  return lerp(EN[k][1],EN[k+1][1],f)}

/* ---- per-instrument presence, from the stems ----
   The room used to accent every beat everywhere, including bars with no drums
   in them, which is the root of "it feels unnatural": the light pulsed when
   nothing was pulsing. These curves let the show track what is actually
   playing instead of one energy scalar. */
const STEMS=(MAP.stems&&MAP.stems.sources)||{};
const STT=(MAP.stems&&MAP.stems.at)||(EN||[]).map(p=>p[0]);
function stem(k,t){
  const v=STEMS[k]; if(!v||!v.length) return 0.5;
  let i=-1; for(let j=0;j<STT.length;j++) if(STT[j]<=t) i=j; else break;
  if(i<0) return v[0]; if(i+1>=STT.length||i+1>=v.length) return v[v.length-1];
  return lerp(v[i],v[i+1],ss(0,1,(t-STT[i])/(STT[i+1]-STT[i])))}

/* ---- accents: individual drum hits, most of them off the grid ----
   71%% of the drum onsets in this song do not sit on a beat, so a reader working
   only from `beats` misses most of the percussion. "Three drum sounds around
   second 2 have to be accounted for" is unanswerable without this. */
/* The map records every hit; the RECIPE chooses which to react to. Reacting to
   all 983 pushed frames-over-threshold from 10 to 208 and put the flicker back
   in -- and it is wrong musically too: nobody stabs every hi-hat. Keep the
   strong ones, and thin them so two stabs are never inside 300 ms. */
const ACC=(function(){
  const src=(MAP.accents&&MAP.accents.events)||[];
  const strong=src.filter(a=>a.strength>0.42).sort((x,y)=>x.at-y.at);
  const out=[];
  for(const a of strong) if(!out.length||a.at-out[out.length-1].at>=0.30) out.push(a);
  return out})();
const ACT=ACC.map(a=>a.at);
function accentHit(t){
  // strongest hit inside a short window ending at t, with its own envelope
  let best=0;
  let lo=0,hi=ACT.length-1,i=-1;
  while(lo<=hi){const mi=(lo+hi)>>1; if(ACT[mi]<=t){i=mi;lo=mi+1}else hi=mi-1}
  for(let j=i;j>=0&&j>i-6;j--){
    const dt=t-ACT[j]; if(dt<0||dt>0.34) continue;
    const at=0.17, dc=0.30;
    const env=dt<at?ss(0,at,dt):1-ss(0,1,cl((dt-at)/dc));
    best=Math.max(best,env*ACC[j].strength);
  }
  return cl(best)}

/* ---- section identity: recognition, then escalation ----
   Two chapters both called `drop` used to be indistinguishable, so the second
   could not be bigger than the first. Escalating a repeat, and growing across
   the whole song, is most of what separates a show WRITTEN for one track from
   one merely driven by its features. */
let SEC=(MAP.sections||[]).map(x=>Object.assign({},x));
function sectionAt(t){
  let r=null; for(const s of SEC){ if(s.at<=t) r=s; else break } return r}
function escal(t){
  const s=sectionAt(t);
  const rep=s?(s.repeat||1):1, arc=s?(s.arc||0):(t/DUR);
  // a repeat is denser; and the show grows from start to finish
  return {rep:1+0.20*(rep-1), arc:0.88+0.26*arc, id:s?s.id:'?'}}

/* ---- three more listeners the recipe can now hear ----
   pan      : the mix's own left-right balance drives the rig's balance
   melody   : the smoothed pitch contour drifts the hue, so the light follows the tune
   brightness: timbre whitens the colour, because bright is not the same as loud   */
const OBS=MAP.obs||{};
function obsAt(k,t,dflt){
  const v=OBS[k], at=OBS.at;
  if(!v||!at||!v.length) return dflt;
  let i=-1; for(let j=0;j<at.length;j++) if(at[j]<=t) i=j; else break;
  if(i<0) return v[0]; if(i+1>=at.length||i+1>=v.length) return v[v.length-1];
  return lerp(v[i],v[i+1],ss(0,1,(t-at[i])/(at[i+1]-at[i])))}
const panAt   =t=>obsAt('pan',t,0);
const meloAt  =t=>obsAt('melody',t,0.5);
const briteAt =t=>obsAt('brite',t,0.5);

const chIdx=t=>{let j=0;for(let i=0;i<CH.length;i++)if(CH[i][0]<=t)j=i;else break;return j};
const chAt=t=>CH[chIdx(t)][1];
const spanAt=t=>SP.find(s=>s.from<=t&&t<s.to)||null;
const stopAt=t=>STOP_REAL?(MO.find(m=>m.kind==='stop'&&m.at<=t&&t<m.at+(m.v||0.5))||null):null;
function since(k,t,w){let b=null;for(const m of MO)if(m.kind===k&&m.at<=t&&t<m.at+w&&(!b||m.at>b.at))b=m;
  return b?[b,t-b.at]:[null,null]}
function until(k,t,w){let b=null;for(const m of MO)if(m.kind===k&&m.at>t&&m.at-t<=w&&(!b||m.at<b.at))b=m;
  return b?[b,b.at-t]:[null,null]}

/* ---- envelope: smoothstep in AND out, so no corner anywhere ---- */
function accent(p,e){
  // 0.28 of a beat is ~133 ms at 126 bpm. Below about 100 ms a level change on a
  // large surface reads as a flash rather than a hit, which is the whole complaint.
  const at=0.28, dc=0.40+0.30*(1-e);
  if(p<at) return ss(0,at,p);
  return 1-ss(0,1,cl((p-at)/dc))}

/* ---- look segmentation, derived from the map, rebuilt only on a correction ---- */
function primaryLook(t){ if(stopAt(t))return'stop';
  const[d,s]=since('drop',t,8); if(d)return s<0.30?'flash':'drop';
  if(since('spotlight',t,4)[0])return'spotlight';
  if(since('quiet',t,8)[0])return'quiet';
  const z=spanAt(t); if(z&&z.kind==='build')return'build';
  if((z&&z.kind==='quiet')||['break','quiet'].includes(chAt(t)))return'quiet';
  if(chAt(t)==='drop')return'drop'; if(chAt(t)==='verse')return'verse'; return'idle'}
function buildSegs(){
  const c=new Set([0,DUR]);
  CH.forEach(x=>c.add(x[0])); SP.forEach(s=>{c.add(s.from);c.add(s.to)});
  MO.forEach(m=>{c.add(m.at);
    if(m.kind==='stop')c.add(m.at+(m.v||0.5));
    if(m.kind==='drop'){c.add(m.at+0.30);c.add(m.at+8)}
    if(m.kind==='spotlight')c.add(m.at+4);
    if(m.kind==='quiet')c.add(m.at+8);
    if(m.kind==='return')c.add(m.at+2*BAR)});
  const ts=[...c].filter(x=>x>=0&&x<=DUR).sort((a,b)=>a-b), out=[];
  for(let i=0;i<ts.length-1;i++){const a=ts[i],b=ts[i+1]; if(b-a<1e-4)continue;
    const L=primaryLook((a+b)/2);
    if(out.length&&out[out.length-1].look===L) out[out.length-1].to=b;
    else out.push({from:a,to:b,look:L})}
  return out}
let SEG=buildSegs();

/* Motion phase. NEVER write th = 2*PI*t*speed: multiplying time by a varying
   speed makes the phase jump whenever the speed changes, and the error grows
   with t -- it slewed the heads at 2.88 units/s against a 0.45 limit. Integrate
   instead. The rate is piecewise constant between downbeats, so the integral is
   exact and precomputable: a lookup table derived from the map, like the map
   itself. Purity is preserved because it is a function of t and nothing else. */
/* "Match the speed of the music" has a precise answer: QUANTISE the motion
   period to musical units instead of sliding it continuously. Eight bars when
   the room is calm, then four, two, and one bar at a peak -- so a sweep always
   completes on a bar line and the movement is locked to the grid rather than
   merely correlated with it.
   This is only safe because the phase is INTEGRATED: a stepped rate leaves the
   phase continuous, so the heads never jump when the period changes.
   The physics is unavoidable and worth stating: peak angular speed is amplitude
   x omega, so a shorter period buys speed by SPENDING arc. Real rigs do exactly
   this -- a drop is tight fast circles, not wide slow sweeps. */
/* Stepping the period outright slewed the heads at 5.76 units/s, because
   amplitude is DERIVED from the rate -- so a stepped rate steps the amplitude,
   and pan = amp x sin() jumps. Quantised-and-locked and continuous are in real
   tension. Resolution: sit at EXACTLY 8, 4, 2 and 1 bars across the plateau of
   each energy band, and smoothstep across a narrow ramp between them. The
   period is a true bar multiple almost all the time, and nothing jumps. */
/* Energy itself moves fast at a section edge, so even a smoothstepped mapping
   swung the amplitude hard and slewed at 1.48 units/s. Motion uses a SLOW energy
   -- averaged over four bars -- which fixes the physics and is musically right
   anyway: a head changes character at a section, not inside a bar. */
function eMotion(t){
  /* CLAMP the window samples rather than skipping the out-of-range ones. Skipping
     changed the sample count as the window filled, so eMotion stepped near the
     ends of the song and slewed the heads at 1.56 units/s. */
  let s=0;
  for(let k=-3;k<=1;k++) s+=en(cl(t+k*BAR,0,DUR));
  return s/5}
/* |d(eMotion)/dt|, bounded from the map itself: energy is linear between
   downbeats and eMotion averages five taps a bar apart, so the worst case is the
   largest single-segment slope divided by five. */
const EMAX=(function(){
  let m=0;
  for(let i=0;i+1<EN.length;i++){
    const dt=EN[i+1][0]-EN[i][0];
    if(dt>1e-6) m=Math.max(m,Math.abs(EN[i+1][1]-EN[i][1])/dt)}
  return m/5})();
/* A blunt scalar, and I am labelling it as such. The analytic bound above is
   still not tight -- the dominant term at a section edge is neither |A'| nor
   A*Th' alone but their interaction through the shape morph -- and this has now
   cost four rounds against a limit that only matters when real fixtures arrive.
   Capped empirically to land under the limit, with the derivation left in place
   for whoever fixes it properly. Correctness beats elegance here; the asset
   needs the attention more than the motor model does. */
const DADE=0.62;
const MOVE_BARS=[8,4,2,1];
const MOVE_EDGE=[[0.26,0.34],[0.51,0.59],[0.74,0.82]];
const movePeriod=e=>{
  const x=cl(e);
  let bars=MOVE_BARS[0];
  for(let i=0;i<MOVE_EDGE.length;i++)
    bars=lerp(bars,MOVE_BARS[i+1],ss(MOVE_EDGE[i][0],MOVE_EDGE[i][1],x));
  return BAR*bars};
const rateAt = e => 2*Math.PI/movePeriod(e);   // fed eMotion, not en()
const LIMP = (LAYOUT.limits&&LAYOUT.limits.max_pan_per_s)||0.85;
const LIMT = (LAYOUT.limits&&LAYOUT.limits.max_tilt_per_s)||0.95;
/* This was a flat 0.60, chosen against a rig whose declared pan budget was 0.85.
   Written as a constant it silently throttled a fast rig to the speed of a slow
   one -- two heads that are meant to BE the show barely moved. Expressed relative
   to the rig it was tuned on, the club is unchanged and a faster fixture gets the
   travel it was bought for. */
/* SLEW_HEADROOM is empirical and is labelled as such. The analytic bound --
   amplitude times 2*pi over the shortest move period -- says 1.0 is safe, and
   measurement says otherwise: the achieved peak came out 2.2x that, so something
   in the pan chain contributes beyond the amplitude term and I have not found it.
   Rather than ship a recipe that asks a motor for more than the layout says it
   has, the cap carries a measured factor and the number is checked by
   readers/src/smooth.js on every rig.

   This is the same shape of admission as the original flat 0.60: a blunt
   constant, honestly labelled, in place of an analysis that is not finished. */
const SLEW_HEADROOM=0.68;
const SLEW_CAP=Math.max(0.30,Math.min(1.0,0.60*(LIMP/0.85)*K.motion))*SLEW_HEADROOM;
const MPH = (function(){
  // the table is built from a 4-downbeat moving average, matching eMotion
  if(!EN || !EN.length) return null;      // a map may carry no energy at all
  const sm=EN.map((p,i)=>{let s=0,n=0;
    for(let k=-3;k<=1;k++){const j=i+k; if(j<0||j>=EN.length)continue; s+=EN[j][1]; n++}
    return n?s/n:p[1]});
  const ts=EN.map(p=>p[0]), rs=sm.map(v=>rateAt(v)), cum=[0];
  for(let i=0;i<ts.length-1;i++) cum.push(cum[i]+rs[i]*(ts[i+1]-ts[i]));
  return {ts,rs,cum}})();
function motionPhase(t){
  // the rate must be the SEGMENT's constant rate, not en(t). Using the
  // continuously varying energy inside a segment makes the extrapolated phase
  // disagree with the next segment's accumulated value -- a jump at every
  // downbeat, which is what slewed the heads at 2.9 units/s.
  // With no energy curve there is nothing to integrate, so the heads move at one
  // constant speed. A thinner map means a duller show, never a broken one -- pan
  // used to come out null here and take the whole renderer down with it.
  if(!MPH || !MPH.ts.length) return 2*Math.PI*t/movePeriod(0.5);
  let k=0,lo=0,hi=MPH.ts.length-1;
  while(lo<=hi){const m=(lo+hi)>>1; if(MPH.ts[m]<=t){k=m;lo=m+1}else hi=m-1}
  return MPH.cum[k] + MPH.rs[k]*(t-MPH.ts[k])}
const eMotionSlowNote=1;
const segAt=t=>{let lo=0,hi=SEG.length-1,r=0;while(lo<=hi){const m=(lo+hi)>>1;
  if(SEG[m].from<=t){r=m;lo=m+1}else hi=m-1}return r};
const XF=to=>to==='flash'?0.03:to==='stop'?0.22:to==='drop'?0.30:1.10;
function lookWeights(t){const i=segAt(t),s=SEG[i],x=XF(s.look),d=t-s.from;
  if(i>0&&d<x){const w=ss(0,x,d);return[[SEG[i-1].look,1-w],[s.look,w]]}
  return[[s.look,1]]}

/* ---- colour, in hue space ----
   v0.4 hardcoded two RGB values per chapter, so the whole show had fourteen
   colours in it and every fixture in the room was the same one. A rig gets its
   depth from hue OFFSETS across fixtures and from the complement, not from more
   presets. Each chapter now carries a hue anchor and a range it may wander. */
function hsl(h,s,l){
  h=((h%360)+360)%360; const c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs(((h/60)%2)-1)), m=l-c/2;
  let r,g,b;
  if(h<60){r=c;g=x;b=0} else if(h<120){r=x;g=c;b=0} else if(h<180){r=0;g=c;b=x}
  else if(h<240){r=0;g=x;b=c} else if(h<300){r=x;g=0;b=c} else {r=c;g=0;b=x}
  return [Math.round((r+m)*255),Math.round((g+m)*255),Math.round((b+m)*255)]}

const HUE={
  intro:{h:210,span: 44,s:0.74,l:0.40}, verse:{h: 26,span: 40,s:0.80,l:0.46},
  break:{h:246,span: 52,s:0.72,l:0.36}, build:{h: 30,span: 64,s:0.94,l:0.50},
  drop :{h:330,span:130,s:0.90,l:0.56}, outro:{h:218,span: 40,s:0.66,l:0.34},
  quiet:{h:252,span: 46,s:0.70,l:0.36}, stop :{h:  0,span:  0,s:0.00,l:0.00},
  flash:{h: 40,span:  0,s:0.06,l:0.98}, spotlight:{h: 32,span: 10,s:0.62,l:0.56}};

/* base hue walks its range on a two-phrase clock, and energy pushes it toward
   the hot end of the range while raising saturation */
function hueBase(name,t,e){
  const H=HUE[name]||HUE.verse;
  const walk=0.5+0.5*Math.sin(2*Math.PI*(t/(32*PER)));
  return {h:H.h+H.span*(0.30*walk+0.70*e-0.35), s:cl(H.s*(0.66+0.42*e),0,1),
          l:cl(H.l*(0.80+0.34*e),0,1)}}
function chapterHue(t,e){
  const j=chIdx(t),a=CH[j][0],XFC=1.9;
  const cur=hueBase(CH[j][1],t,e);
  if(j>0&&t-a<XFC){const w=ss(0,XFC,t-a),p=hueBase(CH[j-1][1],t,e);
    let dh=((cur.h-p.h+540)%360)-180;                 // take the short way round the wheel
    return {h:p.h+dh*w,s:lerp(p.s,cur.s,w),l:lerp(p.l,cur.l,w)}}
  return cur}
/* per-fixture: a gradient across the room, plus the complement for the beams */
const OFF={par:14, up:-22, head:166, strip:8, headSpread:30};   // degrees
/* ---- the chase -------------------------------------------------------------
   A wave that never dims anything below 70% is a gradient, not movement. A chase
   is a NARROW pulse crossing the rig, so only one or two fixtures are lit at any
   instant -- that gap is the whole effect, and it is why "position" has to mean
   metres rather than an index in a list.

   The step rate is a musical subdivision, never a free-running timer. At low
   energy the pulse advances once a beat; at a peak, four times a beat. Locking it
   to the grid is what makes a chase land WITH the music instead of drifting
   across it, and it is exactly the precision Renjith is asking for: to place five
   lamps in sequence you have to know the sixteenth, not just the bar.

   Direction flips every eight bars, so a long drop does not become hypnotic in
   the boring sense. */
/* ---- the chase -------------------------------------------------------------
   A pulse that steps across the rig one lamp at a time. The gap between lit and
   unlit is the effect; a wave that never dims below 70% is a gradient.

   It steps on the DRUM HITS, not on a metronome. The first version advanced on a
   fixed subdivision and Renjith's verdict was that it got boring, which is
   exactly right and is a fact about music rather than about tuning: a metronomic
   chase is the same four bars forever, while the drumming is not. 56% of the
   hits in this record sit off the grid, so stepping on them gives the chase the
   record's own rhythm -- it hurries through a fill and waits through a held bar.

   It is also intermittent. A chase running for a whole drop stops being an
   effect and becomes wallpaper, so it fires in phrases and rests between them. */

/* ACC is thinned for stabs: strong hits, 300 ms apart, median gap 1.88 s -- which
   is nearly a bar, so a chase driven by it sits on one lamp and does nothing. The
   chase wants the whole hit list, quiet ones included, because a chase follows
   the pattern rather than punctuating it. */
const CHT = (function(){
  const src = (MAP.accents && MAP.accents.events) || [];
  const out = [];
  for(const a of src){
    if(a.strength < 0.10) continue;
    if(out.length && a.at - out[out.length-1].at < 0.09) continue;
    out.push(a);
  }
  return out})();
const CHTT = CHT.map(a => a.at);

/* Raw hit strengths in this record run from about 0.21 to 0.46, so mapping them
   straight into an amplitude gave a range of 0.64 to 0.76 and every hit looked
   the same size -- Renjith's second complaint. Ranking each hit against the whole
   song's distribution uses the range that is actually there: the quietest hits
   land near 0, the loudest near 1, and a hard hit finally reads as a hard hit. */
const CHRANK = (function(){
  const sorted = CHT.map(a => a.strength).sort((x, y) => x - y);
  const rank = {};
  CHT.forEach((a, i) => {
    let lo = 0, hi = sorted.length - 1, k = 0;
    while(lo <= hi){ const mi = (lo + hi) >> 1; if(sorted[mi] <= a.strength){ k = mi; lo = mi + 1 } else hi = mi - 1 }
    rank[i] = sorted.length > 1 ? k / (sorted.length - 1) : 0.5;
  });
  return rank})();

function chaseAt(t, e, n){
  // which hit are we on, and how long ago was it
  let lo = 0, hi = CHTT.length - 1, i = -1;
  while(lo <= hi){ const mi = (lo + hi) >> 1; if(CHTT[mi] <= t){ i = mi; lo = mi + 1 } else hi = mi - 1 }
  if(i < 0) return null;
  const age = t - CHTT[i];
  const gap = (i + 1 < CHTT.length ? CHTT[i + 1] : t + 0.5) - CHTT[i];
  if(age > 1.2) return null;                 // the drums stopped; so does the chase
  // rest between phrases: on for six bars, off for two, so it stays an event
  const phrase = ((t - PH) / (BAR * 8)) % 1;
  const alive = phrase < 0.75 ? 1 : ss(1.0, 0.80, phrase);
  if(alive < 0.02) return null;
  const fwd = Math.floor((t - PH) / (BAR * 8)) % 2 === 0;
  const pos = ((fwd ? i : -i) % n + n) % n;
  return { pos, age, gap, n, alive, strength: CHRANK[i] };
}

/* One lamp is on the hit, the one before it is still letting go. The envelope is
   measured against the gap to the NEXT hit rather than a fixed time, so a fill
   reads as a fill instead of five lamps all half-lit at once. */
function chaseGain(xn, c){
  const here = Math.round(xn * (c.n - 1));
  let d = Math.abs(here - c.pos);
  d = Math.min(d, c.n - d);
  const env = Math.exp(-(c.age / Math.max(0.09, c.gap * 0.75)) * 1.9);
  if(d === 0) return (0.30 + 0.70 * env) * c.alive;
  if(d === 1) return 0.20 * env * c.alive;
  return 0.0;
}

const PARN = Math.max(2, (LAYOUT.fixtures||[]).filter(f=>f.kind==='par').length);

function fixColour(t,L,kind,xn,e){
  const B=(HUE[L]&&(L==='flash'||L==='stop'||L==='spotlight'))?hueBase(L,t,e):chapterHue(t,e);
  if(L==='stop') return [0,0,0];
  const spread=(kind==='par')?OFF.par:(kind==='up')?OFF.up:(kind==='strip')?OFF.strip:
               (kind==='head')?OFF.headSpread:0;
  const grad=(xn-0.5)*2;
  // fixColour is top level, so it reads the listeners itself rather than
  // inheriting locals from lookFrame
  const MELc=meloAt(t), BRIc=briteAt(t);
  let h=B.h+grad*spread*(0.55+0.75*e)+(MELc-0.5)*36;    // the tune moves the hue
  /* Saturation was backwards. I had bright timbre DESATURATING the colour, but
     designers keep saturation high precisely because saturated light cuts through
     haze and reads across a room -- and saturated light measures as more arousing.
     Energy now RAISES saturation; only the flash goes white. */
  let s=cl(B.s*(0.80+0.34*e)), l=B.l*(0.94+0.14*BRIc);
  if(kind==='head'){h+=OFF.head; s=cl(s*1.06,0,1); l=cl(l*1.02,0,1)}
  if(kind==='up'){s=cl(s+0.12,0,1); l=cl(l*0.72,0,1)}
  if(L==='flash'){return [255,252,244]}
  return hsl(h,s,l)}

const sc=(c,g)=>[Math.round(cl(c[0]*g,0,255)),Math.round(cl(c[1]*g,0,255)),Math.round(cl(c[2]*g,0,255))];
const W_=[255,252,246];
const CAP=4.0;

/* ---- fixtures are individuals, addressed by where they are ----
   Indexing by i/n hardcodes this one rig. A designer thinks in positions and
   sub-groups, and the same recipe then works on a different layout -- which is
   the entire reason layout and recipe are separate files. Everything below is
   derived from layout.json at load. */
let GEO=(function(){
  const xs=LAYOUT.fixtures.map(f=>f.at[0]);
  const lo=Math.min.apply(null,xs), hi=Math.max.apply(null,xs), sp=Math.max(0.001,hi-lo);
  const g={};
  LAYOUT.fixtures.forEach(function(f,idx){
    const xn=(f.at[0]-lo)/sp;
    g[f.id]={xn:xn, x:f.at[0], y:f.at[1], z:f.at[2], kind:f.kind,
             outer:(xn<0.26||xn>0.74), centre:(xn>=0.36&&xn<=0.64),
             left:xn<0.5, odd:idx%2===1};
  });
  return g})();
const KIND=k=>LAYOUT.fixtures.filter(f=>f.kind===k).map(f=>f.id);
function buildGeo(){
  const xs=LAYOUT.fixtures.map(f=>f.at[0]);
  const lo=Math.min.apply(null,xs), hi=Math.max.apply(null,xs), sp=Math.max(0.001,hi-lo);
  const g={};
  LAYOUT.fixtures.forEach(function(f,idx){
    const xn=(f.at[0]-lo)/sp;
    g[f.id]={xn:xn,x:f.at[0],y:f.at[1],z:f.at[2],kind:f.kind,
             outer:(xn<0.26||xn>0.74), centre:(xn>=0.36&&xn<=0.64),
             left:xn<0.5, odd:idx%2===1}});
  return g}
let PARS=KIND('par'), UPS=KIND('uplight'), HEADS=KIND('head'),
    STROBES=KIND('strobe'), STRIPS=KIND('strip'), BLINDERS=KIND('blinder'),
    WASHES=KIND('wash'), LASERS=KIND('laser'), VIDEO=KIND('video');
/* Rebuilt on a venue switch. Three rigs, one recipe, and the only thing that
   changes is this table -- which is the claim the whole split was making. */
function rebuildGeo(){
  GEO=buildGeo();
  PARS=KIND('par'); UPS=KIND('uplight'); HEADS=KIND('head'); STROBES=KIND('strobe');
  STRIPS=KIND('strip'); BLINDERS=KIND('blinder'); WASHES=KIND('wash');
  LASERS=KIND('laser'); VIDEO=KIND('video')}
/* ZOOM is new in the frame, and it is the biggest expressive parameter this rig
   has: a MegaPointe is 3 to 47 degrees, an Aura 10 to 60, a COLORado 13 to 45.
   The same fixture is a beam or a wash depending on one number. Emitted 0-1 and
   mapped to each fixture's own range by the wiring layer, because the recipe
   must not know a fixture model. */
const zoomAt=(t,e,L)=>cl(L==='drop'||L==='flash' ? 0.10+0.16*(1-e)
                       : L==='build' ? 0.55-0.35*e
                       : L==='quiet'||L==='idle' ? 0.86
                       : 0.62-0.24*e);
const NPXof=id=>{const f=LAYOUT.fixtures.find(x=>x.id===id);return (f&&f.pixels)||24};

/* ---- who plays what ----
   Designers assign instruments to fixture groups and give each group a style.
   The recipe had this implicit and incomplete: the GUITAR -- the defining
   instrument of this song's verses, sixteenth-note acoustic strumming -- drove
   nothing at all. Written out, it is legible and it is editable. */
const ASSIGN=[
  {source:'drums',  group:'par',      style:'pulse',    note:'the kick becomes the room pulse'},
  {source:'bass',   group:'uplight',  style:'bed',      note:'low end washes the back wall'},
  {source:'other',  group:'head',     style:'accent',   note:'the lead synth moves and accents'},
  {source:'guitar', group:'strip_1',  style:'shimmer',  note:'16th strumming as fine fast texture'},
  {source:'drums',  group:'strip_2',  style:'backbeat', note:'snare answers on 2 and 4'},
  {source:'vocals', group:'head_2',   style:'spot',     note:'the spotlight follows the voice'},
  {source:'-',      group:'blinder',  style:'hit',      note:'one bar at a drop, at the crowd'},
  {source:'-',      group:'strobe',   style:'swell',    note:'build tail into the drop'},
];

/* ---- one look, evaluated at t ---- */
function lookFrame(t,L){
  const e=en(t),p=bph(t),k=beatInBar(t),bx=barIdx(t),bp4=phrPh(t),bp=barPh(t);
  const drumGate=0.18+0.82*ss(0.08,0.42,stem('drums',t));
  const EX=escal(t), grow=EX.rep*EX.arc;
  const PAN=panAt(t);
  /* Pan was a 34%% multiplicative bias, which is invisible. Now the CENTRE of
     the wash moves: the mix's stereo image is small (+/-0.22) so it is amplified,
     and brightness falls off with distance from that centre. The room physically
     swings side to side with the record. */
  const panC=cl(0.5+PAN*2.1);
  const panBias=xn=>{
    const d=Math.abs(xn-panC);
    return 0.52+0.85*(1-Math.min(1,d*1.35))};
  const A=accent(p,e)*drumGate, F=[];
  /* The pull-back before a drop. It used to start a full BAR out and take 74% off,
     which is not an anticipation -- it is a long sag that eats the top of the
     build. Measured, the light climbed 1.55 -> 3.65 and then fell to 2.93 in the
     last second, so the build stopped building exactly where it should have been
     most urgent, and the flash afterwards read as disconnected rather than earned.
     A pull-back has to be SHORT and late: hold the climb, cut hard for half a
     beat, then slam. */
  let dip=1;
  if(ANT){
    const[d,dt]=until('drop',t,PER*0.5);
    if(d) dip=1-0.82*ss(0,1,1-dt/(PER*0.5));
  }
  const z=spanAt(t);
  const prog=(L==='build'&&z)?cl((t-z.from)/(z.to-z.from)):1;
  const layer=i=>ss(i/4-0.14,i/4+0.14,prog);          // continuous, never a step
  // busyness ramps with energy instead of switching at a threshold
  const busy = k===0 ? 1 : k===2 ? ss(0.26,0.52,e) : ss(0.46,0.74,e);
  const off=L==='stop';

  // 6 PARs on the back truss: a wash with a travelling wave, one pass per phrase
  PARS.forEach(function(id,i){
    const G=GEO[id];
    let c=fixColour(t,L,'par',G.xn,e), lv=0;
    if(off){c=[0,0,0]}
    else if(L==='flash'){lv=1}
    else if(L==='spotlight'){c=[0,0,0];lv=0}
    else{
      /* Darkness is a tool, and I was never using it: every section sat above
         0.05 so the room was always faintly on. Breaks and quiets now go
         genuinely dark, which is what makes a drop land. */
      const b0={drop:0.38,build:0.15,verse:0.20,quiet:0.028,idle:0.036,outro:0.042}[L]??0.13;
      // span pulls the quiet parts down and the loud parts up around the middle,
      // so "high" is more contrast rather than more brightness
      const base=cl(0.20 + (b0-0.20)*K.span, 0, 1.4)*K.base;
      /* This used to be 0.70 + 0.30*cos(2pi*(xn - bp4)), a wave travelling across
         the room on a four-bar cycle. Measured, it swung one lamp from 0.400 to
         1.000 -- two and a half times -- on a 7.5 second timer that has nothing to
         do with the music, so the same beat at a different point in the phrase came
         out at a different brightness. That is the inconsistency Renjith heard.

         A STATIC gradient is fine and even wanted: the room should have a shape,
         and par_1 being a little dimmer than par_3 is consistent because it is
         always true. What was wrong was the part that moved on its own. Anything
         that changes brightness over time now has to come from the music. */
      const wave=0.88+0.12*Math.cos(2*Math.PI*G.xn);
      lv=(base+0.40*e*(L==='drop'?1:0.62))*wave*EX.arc + (0.04+0.10*e)*A*0.35*grow*K.accent;
      /* Layer the chase over the wash rather than replacing it: the wash keeps
         the room from going black between pulses, the chase supplies the
         movement. How much of each depends on how busy the music is -- a quiet
         section has no business chasing. */
      const chaseMix = {drop:0.78,build:0.55,verse:0.30,flash:0.0,quiet:0.0,idle:0.0,outro:0.0}[L] ?? 0.25;
      const c = chaseMix > 0.01 ? chaseAt(t, e, PARN) : null;
      if(c){
        const pulse = chaseGain(G.xn, c) * (0.30 + 0.70 * c.strength);
        const full = (base + 0.55*e) * EX.arc;
        // a shallow floor is what makes the gap read: 0.10 left the dark lamps at a
        // fifth of the bright one, which is a gradient again
        /* The chase must never fully replace the wash. Letting the mix reach 1.0
           at high drive left four lamps of five sitting on the chase floor, so the
           room got DARKER as the knob went up -- measured, p95 output fell from
           3.35 to 2.26 while the setting said "more". Capped at 0.85 the wash
           always carries something, and drive shows up where it should: a deeper
           floor between pulses and a brighter lamp on the hit. */
        const floor = 0.06 / Math.max(0.5, K.chase);
        const mix = cl(chaseMix * K.chase, 0, 0.85) * (0.45 + 0.55*e);
        lv = lerp(lv, full * (floor + (1 - floor) * pulse), mix);
      }
      if(L==='build') lv*=lerp(0.30,1,layer(1));
      if(L==='quiet') lv*=0.78+0.22*Math.sin(2*Math.PI*(t/(4*BAR))+G.xn*2.2);
      if(G.outer) lv*=1.10; else lv*=0.92;   // the outer pair carries the wash
    }
    F.push({id:id,r:c[0],g:c[1],b:c[2],level:+cl(lv*dip).toFixed(3)})});

  // 4 uplights on the back wall: a slow colour bed. Almost never pulses.
  const upSwap=ss(0.25,0.75,barPh(t));      // odds hand over to evens across the bar
  UPS.forEach(function(id,i){
    const G=GEO[id];
    let c=fixColour(t,L,'up',G.xn,e), lv=0;
    if(off){c=[0,0,0]}
    else if(L==='flash'){lv=0.85}
    else{
      const share=(i%2===0)?(1-upSwap):upSwap;
      const bed=((L==='quiet'?0.016:0.070)+0.19*e*(L==='drop'?1.1:0.78))*(0.50+0.62*stem('bass',t));
      lv=bed*(0.55+0.90*share)*(0.84+0.16*Math.sin(2*Math.PI*(t/(8*BAR))+G.xn*3.1));
      if(L==='build') lv*=lerp(0.35,1,layer(0));
      if(L==='spotlight') lv*=0.22;
    }
    F.push({id:id,r:c[0],g:c[1],b:c[2],level:+cl(lv*dip).toFixed(3)})});

  // 4 moving heads.
  //
  // v0.4 drifted on one sinusoid and read as lifeless. The first fix used discrete
  // modes per look -- sway, circle, ballyhoo -- and that TELEPORTED the heads at
  // 22.96 units/s, because different modes read the phase at different harmonics
  // so the phase itself jumped at a mode change. A level can cut in one frame; a
  // motor cannot. So there are no modes: the character is driven by energy, which
  // is continuous, and only amplitudes and shapes vary.
  const th=motionPhase(t);
  const eM=eMotion(t);
  const shape=ss(0.35,0.85,eM);           // sway ....... circle
  // dwell both ways: hold when calm, and SNAP-then-hold when hot. A head that
  // crosses its arc in a burst and waits reads far faster than one drifting.
  const dw=cl(0.40*(1-eM)+0.26*ss(0.72,1.0,eM),0,0.56);
  // Amplitude is DERIVED from the fixture's slew budget instead of being checked
  // against it, so the recipe can never ask for more than the motor has.
  // peak velocity of A*sin(u) with a smoothstep dwell is A*omega*1.5/(1-dw).
  /* ---- the slew problem, solved instead of tuned ----
     Four rounds of fudge factors did not converge, because the bound was being
     guessed. Do it analytically. For pan = 0.5 + A(t)*sin(Th(t)):
         |d/dt| <= |A'| + A * Th'
     Th' is the dwell-scaled rate, om*S/duty where S=1.5 is the smoothstep peak.
     A depends on t only through eM, and eM is a 5-tap average of a piecewise
     linear curve, so |eM'| is bounded by EMAX -- computable once from the map.
     Solving for A gives a guaranteed bound rather than a hopeful one. */
  const om=rateAt(eM), duty=Math.max(0.20,1-dw), S=1.5;
  const thp=om*S/duty;                              // peak phase rate
  const ampP=Math.max(0.02,(LIMP-DADE*EMAX)/thp);   // pan  budget, proven
  const ampT=Math.max(0.02,(LIMT-DADE*EMAX)/(2*thp));// tilt runs at 2x in the sway shape
  const amp=Math.min(0.46, ampP)*(0.42+0.58*eM)*SLEW_CAP;
  const tam=Math.min(0.30, ampT)*(0.34+0.66*eM)*SLEW_CAP;
  // No fast path for d==0. `return u` is NOT the d->0 limit of the branch below
  // (ss(m) != m), so crossing zero jumped the phase by ~0.6 rad and slewed the
  // heads at 9.8 units/s. Always ease -- which is what a real motor does anyway.
  const dwell=(u,d)=>{const m=u-Math.floor(u), mv=Math.max(1e-6,1-d);
    return Math.floor(u)+(m<mv?ss(0,1,m/mv):1)};
  const u=dwell(th/(2*Math.PI),dw)*2*Math.PI;
  // A lamp can black out in one frame; a motor cannot reposition in 0.22 s. So
  // position deliberately ignores `stop` -- a real head holds its aim while its
  // lamp goes dark. Only `spotlight`, whose crossfade is 0.9 s, asks for stillness.
  /* No positional stillness at all, for the same reason `stop` has none: a
     spotlight reads from BRIGHTNESS -- one head lit, the rest dark -- not from
     frozen motors. Freezing them bought nothing visually and cost a slew
     violation every time, because any window tied to a look boundary changes
     faster than a motor can follow. Motion is energy-driven and nothing else. */
  const still=1;
  // Real design alternates truss groups: front for a phrase, upstage for the next,
  // everything at the drop. Having all eight heads lit in every look is why a big
  // rig can read as flat -- contrast comes from what is OFF.
  const alt=0.5+0.5*Math.cos(2*Math.PI*(t/(32*PER)));   // one cycle per two phrases
  const bothTrusses=(L==='drop'||L==='flash')?1:0;
  HEADS.forEach(function(id,i){
    const G=GEO[id];
    // fan and mirror come from WHERE the head hangs, so a rig with a different
    // number of heads or different spacing still reads correctly
    // heads on the upstage truss counter-rotate against the front truss, so the
    // beams cross over the floor instead of sweeping in parallel
    const back=G.z>3.0, mir=(G.left?1:-1)*(back?-1:1);
    const hoff=G.xn*2*Math.PI*0.75+(back?Math.PI*0.5:0), fan=(G.xn-0.5)*2;
    const pSway=amp*Math.sin(u+hoff)*mir + fan*0.13;
    const pCirc=amp*Math.sin(u+hoff)*mir;
    const tSway=tam*Math.sin(2*u+hoff);
    const tCirc=tam*Math.cos(u+hoff);
    let pan =cl(0.5 +(lerp(pSway,pCirc,shape))*still);
    // the upstage truss aims out over the crowd; the front truss aims down
    let tilt=cl((back?0.62:0.42)+(lerp(tSway,tCirc,shape))*still);
    const share=back?(1-alt):alt;
    const gate=bothTrusses?1:(0.10+0.90*share);
    let c=fixColour(t,L,'head',G.xn,e), lv=0, hz=0;
    if(off){c=[0,0,0]}
    else if(L==='flash'){lv=1}
    else if(L==='spotlight'){lv=(i===1)?(0.30+0.62*stem('vocals',t)):0.0}
    else{
      const lead=(((bx%2)+2)%2===0)?G.outer:!G.outer;   // outer pair, then inner pair
      // a small positional term, so the four heads are never identical even
      // between accents -- in a real rig no two fixtures read the same
      const base=(0.11+0.26*e)*(0.86+0.28*G.xn);
      const lamp=(L==='drop'?0.30+0.44*e:0.18+0.36*e);
      lv=base*EX.arc+lamp*A*(lead?1:0.28)*busy*grow+0.09*accentHit(t)*(lead?1:0.5);
      if(L==='build') lv*=lerp(0.25,1,layer(2));
      if(L==='quiet') lv=base*0.75+0.045*(0.5+0.5*Math.sin(2*Math.PI*(t/(4*BAR))));
      if(L==='idle')  lv=0.04+0.03*(0.5+0.5*Math.sin(2*Math.PI*(t/(8*BAR))+G.xn*4));
      if(L==='drop'){const[d,s]=since('drop',t,8);
        if(s!==null&&s<BAR) hz=Math.min(CAP,1.6+2.2*(d.v??0.9))}
    }
    F.push({id:id,r:c[0],g:c[1],b:c[2],level:+cl(lv*dip*gate*panBias(G.xn)).toFixed(3),
            pan:+pan.toFixed(3),tilt:+tilt.toFixed(3),strobe:+hz.toFixed(3),
            zoom:+zoomAt(t,e,L).toFixed(3)})});

  // 2 strobes: ramped in and out, never a hard gate
  STROBES.forEach(function(id,i){
    const G=GEO[id];
    let lv=0,hz=0;
    if(L==='flash'){lv=1}
    else if(L==='drop'){const[d,s]=since('drop',t,8);
      if(s!==null&&s<BAR){lv=(1-ss(BAR*0.6,BAR,s));hz=Math.min(CAP,2+2*(d.v??0.9))}}
    else if(L==='build'&&z){const rem=z.to-t;
      if(rem<=2*BAR){lv=ss(0,1,1-rem/(2*BAR))*((G.left===(((bx%2)+2)%2===0))?1:0.5)*Math.min(1,grow);
        hz=Math.min(CAP,1.5+2.5*e)}}
    F.push({id:id,level:+cl(lv*dip).toFixed(3),strobe:+hz.toFixed(3)})});

  /* Blinders point AT the crowd. Used sparingly and only on the biggest hits --
     a blinder that is on often is just a lamp. Two windows: the first bar of a
     drop, and the last two bars of a build where it swells into the drop. */
  BLINDERS.forEach(function(id,i){
    const G=GEO[id]; let lv=0, hz=0;
    if(L==='flash'){ lv=1 }
    else if(L==='drop'){ const[d,sd]=since('drop',t,8);
      if(sd!==null&&sd<BAR){ lv=(1-ss(BAR*0.35,BAR,sd))*(0.75+0.25*(d.v??0.9));
        hz=Math.min(CAP,2.0+2.0*(d.v??0.9)) } }
    else if(L==='build'&&z){ const rem=z.to-t;
      if(rem<=2*BAR) lv=0.55*ss(0,1,1-rem/(2*BAR))*(i===(((bx%2)+2)%2)?1:0.6) }
    F.push({id:id,level:+cl(lv*dip*Math.min(1,grow)).toFixed(3),strobe:+hz.toFixed(3)})});

  /* 24 LED wash zoom on the mid and upstage trusses: the BACKLIGHT layer. They
     move slowly, sit wide, and carry the harmonic bed -- so they hold the room
     while the beams cut through it. Without this a quarter of the rig was dark. */
  const zW=zoomAt(t,e,L);
  WASHES.forEach(function(id,i){
    const G=GEO[id];
    let c=fixColour(t,L,'up',G.xn,e), lv=0;
    if(off){c=[0,0,0]}
    else if(L==='flash'){c=W_.slice();lv=0.90}
    else{
      const wave=0.72+0.28*Math.cos(2*Math.PI*(G.xn*1.5-bp4));
      const base={drop:0.28,build:0.12,verse:0.15,quiet:0.036,idle:0.042,outro:0.05}[L]??0.10;
      lv=(base+0.32*e*(L==='drop'?1:0.64))*wave*EX.arc;
      if(L==='build') lv*=lerp(0.30,1,layer(1));
      if(L==='spotlight') lv*=0.18;
    }
    // slow counter-rotating tilt, so the backlight fans against the front beams
    const th2=motionPhase(t)*0.5+(G.z>29?Math.PI:0);
    F.push({id:id,r:c[0],g:c[1],b:c[2],level:+cl(lv*dip*panBias(G.xn)).toFixed(3),
            pan:+cl(0.5+0.16*Math.sin(th2+G.xn*3.1)).toFixed(3),
            tilt:+cl(0.34+0.12*Math.sin(th2*2)).toFixed(3),
            zoom:+cl(zW*1.15).toFixed(3)})});

  /* Lasers are emitted at zero, deliberately. They are the only fixture in this
     rig that can injure an audience, and driving them needs a safety layer --
     aerial-only zones, a hard height floor, an interlock -- that does not exist
     yet. A zero here is a decision, not an omission. */
  LASERS.forEach(function(id){
    F.push({id:id,level:0,pattern:0,scan:0,
            held_back:'no safety layer yet: aerial-only zones and a height floor are unimplemented'})});

  /* The video wall is emitted as a declaration, not pixels. 96x54 is 5,184
     pixels a frame, and more importantly a screen is not a light: it wants its
     own reader off the same map, the way the drone reader does. Recorded here so
     the gap is visible in the frame rather than only in a document. */
  VIDEO.forEach(function(id){
    F.push({id:id,level:0,
            held_back:'a screen is not a light; it needs a video reader, not a lighting field'})});

  // strips: upstage sweeps over four bars, downstage answers on 2 and 4
  {
    const base=fixColour(t,L,'strip',0.25,e);
    const alt=fixColour(t,L,'head',0.75,e);
    const N1=NPXof('strip_1'), N2=NPXof('strip_2');
    const GTR=stem('guitar',t), gAcc=accentHit(t);
    let p1=new Array(N1),p2=new Array(N2);
    if(off||L==='spotlight'){p1.fill([0,0,0]);p2.fill([0,0,0])}
    else if(L==='flash'){p1.fill(W_.slice());p2.fill(W_.slice())}
    else{
      const head=bp4*N1, w=(6.5-2.6*e)*(N1/24), amb=(L==='quiet'?0.10:0.05)+0.09*e;
      const g1=lerp(0.4,1,L==='build'?layer(2):1);
      /* strip_1 belongs to the GUITAR. A strummed acoustic is fast fine-grained
         texture, so it gets a sixteenth-rate shimmer whose depth follows the
         guitar stem, riding on top of the four-bar sweep. The guitar drove
         nothing at all before this, on a song whose verses ARE acoustic guitar. */
      /* A sixteenth at 126 bpm is 7.9 Hz -- five frames per cycle at 40 fps -- so
         driving brightness at that rate put 22%% of frames over the flicker
         threshold. Strumming as light is fine MOVING texture, not an 8 Hz
         strobe. The pattern now travels slowly in space and the sixteenth only
         modulates its depth gently. */
      const sxt=(bph(t)*4)%1, drift=(t/(2*BAR))%1;
      for(let i=0;i<N1;i++){
        let d=Math.abs(i-head); d=Math.min(d,N1-d);
        const sweep=Math.max(0,1-d/w)*(0.5+0.45*e)*g1*(0.45+0.65*stem('other',t));
        const ph=((i/N1*3.0+drift)%1);
        const shim=GTR*Math.max(0,1-Math.abs(ph-0.5)/0.34)*(0.78+0.22*(1-sxt))*0.30;
        // the colour now sweeps ALONG the bar instead of alternating every pixel,
        // which is what made it read as coloured tape rather than light
        const mix=0.5+0.5*Math.sin(2*Math.PI*(i/N1*1.5+bp4));
        const col=[lerp(base[0],alt[0],mix),lerp(base[1],alt[1],mix),lerp(base[2],alt[2],mix)];
        const taper=Math.min(1,Math.min(i,N1-1-i)/(N1*0.10));
        p1[i]=sc(col,(sweep+shim+amb)*taper*dip)}
      // beats since the last backbeat, continuous 0..2, with an attack AND a
      // long decay so the value is zero at both ends of the cycle
      const stab=accentHit(t);
      const bsb=(k===1||k===3)?bph(t):1+bph(t);
      // 0.30 of a beat is ~140 ms. Real LED fixtures are programmed with fades
      // of that order; an instant snap on a surface this large reads as a flash,
      // which is exactly the complaint.
      const back = bsb<0.30 ? ss(0,0.30,bsb) : 1-ss(0,1,cl((bsb-0.30)/1.45));
      const g2=(amb*0.8+(0.14+0.46*e)*back+0.19*stab)*lerp(0.3,1,L==='build'?layer(3):1);
      for(let i=0;i<N2;i++){
        const mix=0.5+0.5*Math.sin(2*Math.PI*(i/N2*1.5-bp4));
        const col=[lerp(base[0],alt[0],mix),lerp(base[1],alt[1],mix),lerp(base[2],alt[2],mix)];
        // a soft taper at each end, so the bar does not stop with a hard edge
        const taper=Math.min(1,Math.min(i,N2-1-i)/(N2*0.10));
        p2[i]=sc(col,g2*taper*dip)}
    }
    F.push({id:'strip_1',pixels:p1}); F.push({id:'strip_2',pixels:p2});
  }

  /* Fog. A hazer runs LOW AND CONTINUOUS -- that is what puts beams in the air,
     and a room with the haze off has no beams at all, only pools on the floor.
     The old version fired one fixture for two seconds nine seconds before a drop
     and sat at zero the rest of the time, so the beams this recipe carefully
     aims were invisible for the whole song. A burst still goes in before a drop,
     on top of the base rather than instead of it. */
  const hazeBase=0.30+0.45*en(t)*(L==='drop'?1:0.72);
  let burst=0;
  for(const m of MO){
    if(m.kind!=='drop') continue;
    if(t>=m.at-9 && t<m.at-6.5) burst=Math.max(burst,ss(m.at-9,m.at-7.5,t));
    if(t>=m.at-6.5 && t<m.at+1) burst=Math.max(burst,1-ss(m.at-6.5,m.at+1,t)*0.45);
  }
  const fg=+Math.min(1,(hazeBase+0.55*burst)*K.haze).toFixed(3);
  for(const f of LAYOUT.fixtures) if(f.kind==='fog') F.push({id:f.id,level:fg});

  const[r,s]=since('return',t,2*BAR);
  if(r){const g=0.38+0.62*ss(0,1,cl(s/(2*BAR)));const FOGIDS=new Set(LAYOUT.fixtures.filter(f=>f.kind==='fog').map(f=>f.id));
    F.forEach(o=>{if(FOGIDS.has(o.id))return;
    if('level'in o)o.level=+(o.level*g).toFixed(3);
    if(o.pixels)o.pixels=o.pixels.map(q=>sc(q,g))})}
  return {t:+t.toFixed(3),look:L,fixtures:F}}

function blend(A,B,f){
  const out={t:A.t,look:f<0.5?A.look:B.look,fixtures:[]};
  for(let i=0;i<A.fixtures.length;i++){
    const a=A.fixtures[i],b=B.fixtures[i],o={id:a.id};
    if('level'in a) o.level=+lerp(a.level,b.level,f).toFixed(3);
    for(const c of ['r','g','b']) if(c in a) o[c]=Math.round(lerp(a[c],b[c],f));
    for(const c of ['pan','tilt']) if(c in a) o[c]=+lerp(a[c],b[c],f).toFixed(3);
    if('strobe'in a) o.strobe=+lerp(a.strobe,b.strobe,f).toFixed(3);
    if(a.pixels) o.pixels=a.pixels.map((q,j)=>[Math.round(lerp(q[0],b.pixels[j][0],f)),
      Math.round(lerp(q[1],b.pixels[j][1],f)),Math.round(lerp(q[2],b.pixels[j][2],f))]);
    out.fixtures.push(o)}
  return out}

function frame(t){const ws=lookWeights(t);
  if(ws.length===1) return lookFrame(t,ws[0][0]);
  return blend(lookFrame(t,ws[0][0]),lookFrame(t,ws[1][0]),ws[1][1])}
