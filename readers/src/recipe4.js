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

/* ---- fixture families ----------------------------------------------------
   A rig calls a light a Sharpy, a MegaPointe or a beam; the recipe only needs
   to know it is a hard narrow mover. Layouts are written in real fixture names
   and this table is the one place they meet the recipe, so a new layout adds a
   row here rather than a branch everywhere. Legacy names map in too: a rig
   written before the redesign still reads correctly (rule 7). */
const FAMILY = {
  beam:'head', spot:'head', head:'head', sky:'head',
  wash:'wash', par:'par', bar:'strip', strip:'strip', uplight:'uplight',
  blinder:'blinder', strobe:'strobe', wall:'video', video:'video',
  laser:'laser', co2:'co2', pyro:'pyro', confetti:'confetti', fog:'fog',
};
const fam = f => FAMILY[f && f.kind] || (f && f.kind);
const canMove = f => !((f.can||[]).indexOf('move') < 0);


const cl=(x,a=0,b=1)=>x<a?a:x>b?b:x;
CH = (CH && CH.length) ? CH : [[0, 'verse']];
EN = EN || [];
MO = MO || [];
SP = SP || [];
const ss=(a,b,x)=>{const t=cl((x-a)/(b-a));return t*t*(3-2*t)};
const lerp=(a,b,f)=>a+(b-a)*f;
const NOV_W = 0.35;
const AMP_CAP = 0.80;
const HEADROOM_K = 0.90;
const MELODY_DEG_K = 4;
const CHORD_LEAN = 0.18;
const GATE_GROUPS = 0;
const CYC_VERSE = 1.6;
const CYC_BUILD = 0.5;
const NOV_FROM = 0.45;
const CYC_DROP = 0.5;
const MOOD_W = 1.00;
const WARM_AT = 0.55;
const LONG_LIFT = 1.60;
const QUIET_GAIN = 2.4;
const QUIET_COV = 0.26;
const BED_HOLD = 1.00;
const MOVE_LEAD = 0.50;
const LONG_FROM = 6;
const LONG_TO = 20;
const KILL_DEPTH=0.97;
const KILL_BEATS=0.5;
const CUT_DEPTH=0.00;
const CUT_PHRASE=99;
const CUT_BARS=0.5;
const CUT_RISE=0.03;

const SONG_DRIVE = (function(){
  const bpm = 60/Math.max(0.05, PER);
  const ev = (MAP.accents && MAP.accents.events) || [];
  const rate = DUR>0 ? ev.length/DUR : 0;
  return cl(Math.sqrt(ss(84,128,bpm) * ss(3.4,7.0,rate)));
})();
const HOT_OK = SONG_DRIVE > 0.45;
const STROBE_GAIN = ss(0.25, 0.60, SONG_DRIVE);
const STROBE_HZ   = lerp(0.40, 1.0, SONG_DRIVE);
const BANG = ss(0.25, 0.60, SONG_DRIVE);
const SLOWXF = lerp(1.9, 1.0, SONG_DRIVE);

const bi=t=>{let lo=0,hi=BEATS.length-1,r=-1;while(lo<=hi){const m=(lo+hi)>>1;
  if(BEATS[m]<=t){r=m;lo=m+1}else hi=m-1}return r};
const bph=t=>{const i=bi(t);return i<0?0:cl((t-BEATS[i])/PER)};
const beatInBar=t=>{const i=bi(t);return i<0?0:((i-DBP)%4+4)%4};
const barIdx=t=>Math.floor((bi(t)-DBP)/4);
const barPh=t=>cl((beatInBar(t)+bph(t))/4);
const phrPh=t=>{const k=((bi(t)-DBP)%16+16)%16;return cl((k+bph(t))/16)};
const mpos=t=>Math.max(0, barIdx(t)+barPh(t));
function chBars(t){
  if(!CH.length) return 0;
  const j=chIdx(t), a=CH[j][0], b=(j+1<CH.length?CH[j+1][0]:DUR);
  return (b-a)/Math.max(1e-6, BAR);
}
function longLift(t, L){
  if(L!=='quiet' && L!=='idle' && L!=='build') return 1;
  return lerp(1, LONG_LIFT, ss(LONG_FROM, LONG_TO, chBars(t)));
}
function chProg(t){
  if(!CH.length) return 0;
  const j=chIdx(t), a=CH[j][0], b=(j+1<CH.length?CH[j+1][0]:DUR);
  return (b>a) ? cl((t-a)/(b-a)) : 0;
}

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
const STEM_FALLBACK={vocals:'other', guitar:'other', piano:'other', drums:'drums', bass:'bass'};
function stem(k,t){
  let v=STEMS[k];
  if((!v||!v.length) && STEM_FALLBACK[k]) v=STEMS[STEM_FALLBACK[k]];
  if(!v||!v.length) return 0.5;
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
/* Onset detection carries its own jitter, roughly +-40 ms, and that jitter is
   what Renjith hears as "not in sync": a hit the drummer played ON the beat gets
   stamped 30 ms late, the chase steps 30 ms late, and the flash misses.
   Syncopation is NOT that -- a hit deliberately played off the grid belongs off
   the grid, and quantising it would flatten the groove into a drum machine.
   The two are separable by distance. A hit within SNAP_TOL of a sixteenth was
   almost certainly meant to be on it, so it gets pulled exactly on. A hit
   further out was meant to be there, so it is left alone. */
const SNAP_TOL = 0.045;
const SNAP_SUB = PER / 4;
function snapT(t){
  const g = PH + Math.round((t - PH) / SNAP_SUB) * SNAP_SUB;
  return Math.abs(g - t) <= SNAP_TOL ? +g.toFixed(4) : t;
}
const ACC=(function(){
  const src=((MAP.accents&&MAP.accents.events)||[]).map(a=>({...a, at:snapT(a.at)}));
  const strong=src.filter(a=>a.strength>0.42).sort((x,y)=>x.at-y.at);
  const out=[];
  for(const a of strong) if(!out.length||a.at-out[out.length-1].at>=0.30) out.push(a);
  return out})();
const ACT=ACC.map(a=>a.at);
/* Per-instrument accents are thinned per instrument, never against each other.

   ACC above is a deliberately sparse stream -- the strong, well-separated hits
   that a stab reads from -- and building the per-instrument index out of it was
   a mistake with a very large blast radius. One global "keep one hit per 300 ms"
   pass over eight merged instruments means whichever instrument is loudest in
   each slot deletes the rest. Levels carries 633 kicks and 33 of them reached a
   fixture; Don't Look Down carries 500 and 4 survived. The map had measured the
   song correctly the whole time and the reader was discarding it.

   A kick is not deleted by a guitar. Each instrument gets its own timeline,
   thinned at a sixteenth so a real drum pattern survives intact. */
const ACC_BY = (function(){
  const out = {};
  const gap = Math.max(0.09, (typeof PER === 'number' ? PER : 0.5) * 0.24);
  for(const a of ((MAP.accents && MAP.accents.events) || [])){
    if((a.strength === undefined ? 0.5 : a.strength) < 0.15) continue;
    (out[a.of] = out[a.of] || []).push({...a, at: snapT(a.at)});
  }
  for(const k in out){
    out[k].sort((x,y)=>x.at-y.at);
    const keep=[];
    for(const a of out[k]) if(!keep.length || a.at-keep[keep.length-1].at >= gap) keep.push(a);
    out[k]=keep;
  }
  return out;
})();
function accentOf(band, t){
  const arr = ACC_BY[band];
  if(!arr || !arr.length) return 0;
  let lo=0, hi=arr.length-1, i=-1;
  while(lo<=hi){ const m=(lo+hi)>>1; if(arr[m].at<=t){i=m;lo=m+1} else hi=m-1 }
  let best=0;
  const at = 0.014 + 0.060*(1-SONG_DRIVE), dc = 0.26;
  for(let j=i; j>=0 && j>i-4; j--){
    const dt = t - arr[j].at;
    if(dt < 0 || dt > 0.40) continue;
    const env = dt<at ? ss(0,at,dt) : 1-ss(0,1,cl((dt-at)/dc));
    best = Math.max(best, env*(arr[j].strength===undefined?0.5:arr[j].strength));
  }
  return cl(best);
}
function accentHit(t){
  // strongest hit inside a short window ending at t, with its own envelope
  let best=0;
  let lo=0,hi=ACT.length-1,i=-1;
  while(lo<=hi){const mi=(lo+hi)>>1; if(ACT[mi]<=t){i=mi;lo=mi+1}else hi=mi-1}
  for(let j=i;j>=0&&j>i-6;j--){
    const dt=t-ACT[j]; if(dt<0||dt>0.34) continue;
    const at=0.014+0.060*(1-SONG_DRIVE), dc=0.26;
    const env=dt<at?ss(0,at,dt):1-ss(0,1,cl((dt-at)/dc));
    best=Math.max(best,env*ACC[j].strength);
  }
  return cl(best)}

/* ---- section identity: recognition, then escalation ----
   Two chapters both called `drop` used to be indistinguishable, so the second
   could not be bigger than the first. Escalating a repeat, and growing across
   the whole song, is most of what separates a show WRITTEN for one track from
   one merely driven by its features. */
let SEC=(function(x){const a=Array.isArray(x)?x:(x&&x.entries)||[];return a.map(y=>Object.assign({},y))})(MAP.sections);
function sectionAt(t){
  let r=null; for(const s of SEC){ if(s.at<=t) r=s; else break } return r}
function escal(t){
  const s=sectionAt(t);
  const rep=s?(s.repeat||1):1, arc=s?(s.arc||0):(t/DUR);
  // a repeat is denser; and the show grows from start to finish
  return {rep:1+0.42*(rep-1), arc:0.54+0.78*arc, id:s?s.id:'?'}}

/* ---- three more listeners the recipe can now hear ----
   pan      : the mix's own left-right balance drives the rig's balance
   melody   : the smoothed pitch contour drifts the hue, so the light follows the tune
   brightness: timbre whitens the colour, because bright is not the same as loud   */
const OBS=(function(){
  const out={}, num=v=>typeof v==='number'&&isFinite(v);
  const put=(k,at,val)=>{ if(at&&val&&at.length&&val.length&&at.length===val.length) out[k]={at:at,value:val} };
  function fill(vals){
    const f=vals.slice(); let seen=null;
    for(let i=0;i<f.length;i++){ if(num(f[i])) seen=f[i]; else f[i]=seen }
    if(seen===null) return null;
    let first=null; for(let i=0;i<f.length;i++) if(num(f[i])){first=f[i];break}
    for(let i=0;i<f.length;i++) if(!num(f[i])) f[i]=first;
    return f;
  }
  function norm(vals){
    const f=fill(vals); if(!f) return null;
    let lo=Infinity,hi=-Infinity; for(const v of f){ if(v<lo)lo=v; if(v>hi)hi=v }
    return (hi>lo) ? f.map(v=>(v-lo)/(hi-lo)) : f.map(()=>0.5);
  }
  function gridFor(rate,n){
    const bar=4*PER;
    if((rate==='per_bar'||rate==='per_downbeat') && EN && EN.length===n) return EN.map(p=>p[0]);
    const per = rate==='per_sixteenth'?PER/4 : rate==='per_eighth'?PER/2
              : rate==='per_beat'?PER : (rate==='per_bar'||rate==='per_downbeat')?bar : PER;
    const a=new Array(n); for(let i=0;i<n;i++) a[i]=PH+i*per; return a;
  }
  const legacy=MAP.obs||{};
  for(const k in legacy) if(k!=='at') put(k, legacy.at||[], legacy[k]);
  const n=MAP.observations||{};
  for(const k in n){
    const c=n[k]; if(!c||typeof c!=='object'||Array.isArray(c)) continue;
    if(Array.isArray(c.at)&&Array.isArray(c.value)){ put(k,c.at,c.value); continue }
    if(Array.isArray(c.notes)){ const v=norm(c.notes); if(v) put(k, gridFor(c.rate,v.length), v); continue }
    if(c.mix){
      if(Array.isArray(c.mix.pan)){ const v=fill(c.mix.pan); if(v) put('pan', gridFor(c.rate,v.length), v) }
      if(Array.isArray(c.mix.width)){ const v=norm(c.mix.width); if(v) put('width', gridFor(c.rate,v.length), v) }
    }
    if(c.sources&&typeof c.sources==='object'){
      let len=0;
      for(const q in c.sources) if(Array.isArray(c.sources[q])) len=Math.max(len,c.sources[q].length);
      if(!len) continue;
      const acc=new Array(len).fill(0), cnt=new Array(len).fill(0);
      for(const q in c.sources){ const arr=c.sources[q]; if(!Array.isArray(arr)) continue;
        for(let i=0;i<arr.length;i++) if(num(arr[i])){ acc[i]+=arr[i]; cnt[i]++ } }
      const v=norm(acc.map((x,i)=>cnt[i]?x/cnt[i]:null));
      if(v) put(k==='brightness'?'brite':k, gridFor(c.rate,len), v);
    }
  }
  return out;
})();
const CHORD_AT=(function(){
  const c=(MAP.observations&&MAP.observations.chords&&MAP.observations.chords.events)||[];
  return c.map(x=>x.at).filter(x=>typeof x==='number').sort((a,b)=>a-b);
})();
const WORDS=(function(){
  const w=(MAP.observations&&MAP.observations.lyrics&&MAP.observations.lyrics.words)||[];
  return w.filter(x=>x&&typeof x.at==='number').sort((a,b)=>a.at-b.at);
})();
function lastAtOrBefore(arr,t,key){
  let lo=0,hi=arr.length-1,k=-1;
  while(lo<=hi){const m=(lo+hi)>>1; const v=key?arr[m][key]:arr[m];
    if(v<=t){k=m;lo=m+1}else hi=m-1}
  return k;
}
function obsAt(k,t,dflt){
  const c=OBS[k]; if(!c) return dflt;
  const v=c.value, at=c.at;
  if(!v||!at||!v.length) return dflt;
  let i=-1; for(let j=0;j<at.length;j++) if(at[j]<=t) i=j; else break;
  if(i<0) return v[0]; if(i+1>=at.length||i+1>=v.length) return v[v.length-1];
  return lerp(v[i],v[i+1],ss(0,1,(t-at[i])/(at[i+1]-at[i])))}
const panAt   =t=>obsAt('pan',t,0);
const meloAt  =t=>obsAt('melody',t,0.5);
const briteAt =t=>obsAt('brite',t,0.5);
const meloDrift=t=>cl((meloAt(t)-0.5)*2,-1,1);
const harmAt  =t=>obsAt('harmony',t,0);
function chordTurn(t){
  if(!CHORD_AT.length) return harmAt(t);
  const k=lastAtOrBefore(CHORD_AT,t);
  if(k<0) return 0;
  return 1-ss(0,Math.max(0.15,PER),t-CHORD_AT[k]);
}
function sung(t){
  if(!WORDS.length) return 0;
  const k=lastAtOrBefore(WORDS,t,'at');
  if(k<0) return 0;
  const w=WORDS[k], to=(typeof w.to==='number'&&w.to>w.at)?w.to:w.at+0.22;
  if(t>=to) return 0;
  const d=to-w.at;
  return cl(ss(0,Math.min(0.05,d*0.3),t-w.at)*(1-0.45*ss(0,d,t-w.at)));
}
const voxAt   =t=>obsAt('voice',t,0.5);

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
  const at=lerp(0.15,0.035,SONG_DRIVE), dc=0.20+0.30*(1-e);
  if(p<at) return ss(0,at,p);
  return 1-ss(0,1,cl((p-at)/dc))}

/* ---- look segmentation, derived from the map, rebuilt only on a correction ---- */
function primaryLook(t){ if(stopAt(t))return'stop';
  const[d,s]=since('drop',t,8); if(d)return (s<0.30&&HOT_OK)?'flash':'drop';
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
const SLEW_HEADROOM=HEADROOM_K;
const SLEW_CAP=Math.max(0.30,Math.min(1.0,0.60*(LIMP/0.85)*K.motion))*SLEW_HEADROOM;
const LOOK_MOVE = {intro:2.1, quiet:2.0, idle:2.1, verse:1.45, break:1.7,
                   build:1.15, drop:0.70, outro:2.1, spotlight:1.9, flash:0.70};
const MOVE_XF = 3.0;
const scaleOf = nm => { const m = LOOK_MOVE[nm]; return (m===undefined?1.25:m); };
function moveScaleAt(t){
  const drive = lerp(1.8, 1.0, SONG_DRIVE);
  if(!CH.length) return 1.25*drive;
  const j = chIdx(t);
  let v = scaleOf(CH[j][1]);
  if(j > 0){
    const end = (j+1 < CH.length) ? CH[j+1][0] : DUR;
    const xf = Math.min(MOVE_XF, Math.max(0.001, end - CH[j][0]));
    const w = ss(0, xf, t - CH[j][0]);
    if(w < 1) v = lerp(scaleOf(CH[j-1][1]), v, w);
  }
  return v*drive;
}
const MOVE_STEPS=[0.0625,0.125,0.25,0.5,1,2];
function quantMove(r){
  let best=MOVE_STEPS[0], bd=Infinity;
  for(const v of MOVE_STEPS){ const d=Math.abs(Math.log(v/Math.max(1e-6,r))); if(d<bd){bd=d;best=v} }
  return best}
const MBARS = Math.max(2, Math.ceil((DUR - PH)/BAR) + 3);
const MPH = (function(){
  const rate=new Array(MBARS), cum=new Array(MBARS+1); cum[0]=0;
  const t0=PH+DBP*PER;
  for(let b=0;b<MBARS;b++){
    const tt=t0+b*BAR+BAR*0.5;
    rate[b]=quantMove(BAR/(movePeriod(eMotion(tt))*moveScaleAt(tt)));
    cum[b+1]=cum[b]+rate[b];
  }
  return {rate:rate,cum:cum}})();
function moveSlot(t){
  const m=mpos(t);
  let i=Math.floor(m); if(i>=MBARS-1) i=MBARS-2; if(i<0) i=0;
  return [i, cl(m-i)]}
function boundRate(t){
  const sl=moveSlot(t), i=sl[0], R=MPH.rate;
  const a2=Math.max(R[i], i>0?R[i-1]:R[i]);
  const b2=Math.max(R[i], i+1<MBARS?R[i+1]:R[i]);
  return lerp(a2,b2,sl[1])}
function motionPhase(t){
  const sl=moveSlot(t);
  return 2*Math.PI*(MPH.cum[sl[0]] + MPH.rate[sl[0]]*sl[1])}
function rateNow(t){ return 2*Math.PI*boundRate(t)/BAR }
const eMotionSlowNote=1;
const segAt=t=>{let lo=0,hi=SEG.length-1,r=0;while(lo<=hi){const m=(lo+hi)>>1;
  if(SEG[m].from<=t){r=m;lo=m+1}else hi=m-1}return r};
const XF=to=>(to==='flash'?0.03:to==='stop'?0.22:to==='drop'?0.30:1.10)*SLOWXF;
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

/* A profile is a short list of colours a designer chose, and the show may use
   NOTHING else. The previous version let hue wander continuously -- a walk clock,
   plus energy, plus the melody contour, plus a per-fixture offset in degrees --
   so the rig passed through every hue between the ones anybody intended, and
   landed on olive and mustard on the way. That is what "random colours" was.
   Two colours are on stage at a time: the chapter's primary and its partner.
   Pars alternate between them, heads take the partner so they read against the
   wash, uplights take the deep. Energy moves saturation and lightness, never hue. */
/* garrix and garrix-red come from the look of his shows rather than from measuring
   any footage: a cold saturated base, ONE hot accent, white reserved for impact,
   and very few colours on stage at any moment. The restraint is the character --
   his stages are mostly two colours and a blinder, not a rainbow. If a specific
   show is wanted these are the numbers to change. */
const PROFILES = {
  /* white only: colour removed from the picture entirely, so a problem with
     timing, position or width can be judged without colour arguing with it. The
     chords rung has nothing to say under this theme and its check says so. */
  white:       { lead:[0,0,.60], hot:[0,0,.74], cool:[0,0,.48], deep:[0,0,.30] },
  garrix:      { lead:[214,.95,.52], hot:[356,.94,.50], cool:[188,.92,.48], deep:[230,.90,.28] },
  "garrix-red":{ lead:[356,.94,.50], hot:[  8,.96,.52], cool:[206,.94,.50], deep:[224,.88,.26] },
  sunset: { lead:[ 24,.90,.50], hot:[  6,.94,.48], cool:[196,.86,.44], deep:[240,.78,.34] },
  ice:    { lead:[202,.88,.48], hot:[318,.86,.50], cool:[184,.84,.44], deep:[258,.78,.34] },
  neon:   { lead:[316,.92,.52], hot:[ 42,.94,.54], cool:[172,.88,.46], deep:[272,.84,.38] },
  amber:  { lead:[ 34,.84,.52], hot:[ 16,.92,.50], cool:[ 44,.62,.50], deep:[ 26,.70,.32] },
};
const NOTE_PC = {C:0,'C#':1,DB:1,D:2,'D#':3,EB:3,E:4,F:5,'F#':6,GB:6,G:7,
                'G#':8,AB:8,A:9,'A#':10,BB:10,B:11};
const MOODOBS = (MAP.observations && MAP.observations.mood) || null;
const MOOD_IDX = (function(){
  const out = {};
  const terms = (MOODOBS && MOODOBS.terms) || [];
  for(let i=0;i<terms.length;i++) out[terms[i]] = i;
  return out;
})();
function moodAt(term, t){
  if(!MOODOBS || !MOODOBS.at || !MOODOBS.value) return 0.5;
  const i = MOOD_IDX[term];
  if(i === undefined) return 0.5;
  let k = -1;
  for(let j=0;j<MOODOBS.at.length;j++){ if(MOODOBS.at[j] <= t + 1e-6) k = j; else break }
  if(k < 0) k = 0;
  const row = MOODOBS.value[k];
  return (row && typeof row[i] === 'number') ? cl(row[i]) : 0.5;
}
const HAS_MOOD = !!(MOODOBS && MOODOBS.value && MOODOBS.value.length);
const NOVOBS = (MAP.observations && MAP.observations.novelty) || null;
const HAS_NOV = !!(NOVOBS && NOVOBS.value && NOVOBS.value.length);
function novAt(t){
  if(!HAS_NOV) return 0;
  const at = NOVOBS.at, v = NOVOBS.value;
  let k = -1;
  for(let j=0;j<at.length;j++){ if(at[j] <= t + 1e-6) k = j; else break }
  if(k < 0) return 0;
  if(k+1 >= at.length || k+1 >= v.length) return cl(v[v.length-1]);
  const span = at[k+1]-at[k];
  return cl(lerp(v[k], v[k+1], span>0 ? ss(0,1,(t-at[k])/span) : 0));
}
function novaLift(t){
  if(!HAS_NOV) return 1;
  return 1 + NOV_W*ss(NOV_FROM, 1.0, novAt(t));
}
function warmthAt(t){
  if(!HAS_MOOD) return 0.5;
  return cl(0.5 + 0.5*(moodAt('warm',t) - moodAt('cold',t))
                + 0.30*(moodAt('euphoric',t) + moodAt('triumphant',t))*0.5
                - 0.30*(moodAt('dark',t) + moodAt('sad',t))*0.5);
}
function liftMoodAt(t){
  if(!HAS_MOOD) return 1;
  const up = (moodAt('driving',t) + moodAt('euphoric',t) + moodAt('triumphant',t))/3;
  const down = (moodAt('calm',t) + moodAt('tender',t))/2;
  return lerp(1, 0.55 + 0.95*cl(0.5 + 0.5*(up - down)), MOOD_W);
}
function tensionAt(t){
  if(!HAS_MOOD) return 0;
  return cl((moodAt('tense',t) + moodAt('dark',t))/2);
}
const KEYOBS = (MAP.observations && MAP.observations.key) || null;
function keyFacts(){
  const k = KEYOBS;
  if(!k) return {tonic:-1, major:false, conf:0};
  let tonic = (typeof k.tonic==='number') ? k.tonic : -1;
  let major = (k.mode==='major');
  const txt = (typeof k.estimate==='string') ? k.estimate.trim() : '';
  if(tonic < 0 && txt){
    const m = /^([A-Ga-g][#b]?)/.exec(txt);
    if(m){ const key=m[1].toUpperCase().replace('B','B'); 
           const pc = NOTE_PC[m[1].toUpperCase()]; if(pc!==undefined) tonic = pc }
  }
  if(!k.mode && /min/i.test(txt)) major = false;
  if(!k.mode && /maj/i.test(txt)) major = true;
  const conf = (typeof k.confidence==='number') ? cl(k.confidence) : 0.5;
  return {tonic:tonic, major:major, conf:conf};
}
function obsMean(name, dflt){
  const c = OBS[name];
  if(!c || !c.value || !c.value.length) return dflt;
  let s2=0,n2=0; for(const v of c.value){ if(typeof v==='number'&&isFinite(v)){s2+=v;n2++} }
  return n2 ? s2/n2 : dflt;
}
const WARM_HUES = [352, 8, 24, 38];
const COOL_HUES = [186, 196, 206, 214, 224, 236, 262, 286];
function palFrom(tonic, major, sat, lit){
  const t = (tonic >= 0) ? tonic : 0;
  const ci = t % COOL_HUES.length;
  const at = k => COOL_HUES[((ci + k) % COOL_HUES.length + COOL_HUES.length) % COOL_HUES.length];
  const w = WARM_HUES[t % WARM_HUES.length];
  const s2 = major ? sat*0.96 : sat;
  const l2 = major ? lit*1.06 : lit;
  return {
    lead: [at(0),  s2,                  l2],
    cool: [at(2),  s2*0.94,             l2*0.92],
    deep: [at(5),  s2*0.92,             l2*0.54],
    hot:  [w,      Math.min(1,s2*1.03), l2*0.96],
  };
}
const AUTO = (function(){
  const k = keyFacts();
  const commit = ss(0.35, 0.75, k.conf);
  const major = k.major && commit > 0.5;
  const tone = obsMean('tonality', 0.5);
  const sat = cl(0.80 + 0.16*tone, 0.62, 0.97);
  const lit = cl(0.44 + 0.10*tone + (major?0.03:0), 0.34, 0.58);
  return {pal: palFrom(k.tonic, major, sat, lit),
          tonic: k.tonic, major: major, sat: sat, lit: lit};
})();
const PROFILE = (function(){ try { return (COLOUR || "auto") } catch(e) { return "auto" } })();
const PAL = (PROFILE === 'auto') ? AUTO.pal : (PROFILES[PROFILE] || AUTO.pal);
const DROP_TIMES = MO.filter(x=>x.kind==='drop').map(x=>x.at).sort((a,b)=>a-b);
const FINALE = {garrix:'garrix-red', 'garrix-red':'garrix', sunset:'neon',
                neon:'ice', ice:'neon', amber:'sunset', white:'white'};
const FINALE_PAL = (PROFILE === 'auto')
  ? palFrom((AUTO.tonic >= 0 ? AUTO.tonic : 0) + 5, AUTO.major, AUTO.sat, AUTO.lit)
  : (PROFILES[FINALE[PROFILE]] || PAL);
const FINALE_AT = (function(){
  if(DROP_TIMES.length < 3) return Infinity;
  const last = DROP_TIMES[DROP_TIMES.length-1];
  return (last > DUR*0.55) ? last : Infinity;
})();
const PAL_STEPS = 3;
const PAL_JOURNEY = (function(){
  if(PROFILE !== 'auto') return null;
  const cool = [], warm = [];
  const tn = AUTO.tonic >= 0 ? AUTO.tonic : 0;
  for(let i=0;i<PAL_STEPS;i++){
    cool.push(palFrom(tn + i*2, false, AUTO.sat, AUTO.lit));
    warm.push(palFrom(tn + i*2, true,  AUTO.sat, AUTO.lit));
  }
  return {cool:cool, warm:warm};
})();
function palAt(t){
  if(t + 1e-9 >= FINALE_AT) return FINALE_PAL;
  if(!PAL_JOURNEY) return PAL;
  const sec = sectionAt(t);
  const arc = sec && sec.arc !== undefined ? cl(sec.arc) : cl(t/Math.max(1,DUR));
  const i = Math.min(PAL_STEPS-1, Math.floor(arc*PAL_STEPS));
  const lane = (HAS_MOOD && warmthAt(t) > WARM_AT) ? PAL_JOURNEY.warm : PAL_JOURNEY.cool;
  return lane[i];
}
/* [primary, partner] per chapter. Warm carries the song, cool carries the room,
   deep carries the dark, and the build hands over to the drop by going hot. */
const ROLES = {
  intro:['cool','deep'], verse:['lead','cool'], break:['deep','cool'],
  build:['hot','lead'],  drop :['lead','hot'],  outro:['cool','deep'],
  quiet:['deep','cool'], spotlight:['lead','hot'],
};
function rolesFor(name){
  const r = ROLES[name] || ROLES.verse;
  if(HOT_OK) return r;
  return [r[0]==='hot'?'lead':r[0], r[1]==='hot'?'cool':r[1]];
}
const MELODY_DEG = MELODY_DEG_K;
const MEL_TILT = 0.055;
function roleRGB(role,e,bri,pal,drift,white){
  const P = pal || PAL;
  const c = P[role] || P.lead;
  const d = (drift===undefined?0:drift) * MELODY_DEG;
  const w = white===undefined?0:cl(white);
  return hsl(c[0] + d, cl(c[1]*(0.86+0.20*e)*(1-0.92*w),0,1),
                       cl(c[2]*(0.84+0.28*e)*(0.94+0.12*bri)*(1+0.55*w),0,1));
}

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
  const src = ((MAP.accents && MAP.accents.events) || []).map(a=>({...a, at:snapT(a.at)}));
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
const RIG_MIRRORED = (function(){
  const fx=(LAYOUT.fixtures||[]).filter(f=>fam(f)!=='fog');
  if(fx.length<6) return false;
  const xs=fx.map(f=>f.at[0]);
  const lo=Math.min.apply(null,xs), hi=Math.max.apply(null,xs), mid=(lo+hi)/2;
  let paired=0;
  for(const f of fx){
    const want=2*mid-f.at[0];
    if(fx.some(g=>g!==f&&fam(g)===fam(f)&&Math.abs(g.at[0]-want)<0.35&&Math.abs(g.at[1]-f.at[1])<0.35)) paired++;
  }
  return paired/fx.length >= 0.7;})();
const sym = xn => RIG_MIRRORED ? Math.abs(xn-0.5)*2 : xn;
const CENTRE_PAIR = (function(){
  const hs=(LAYOUT.fixtures||[]).filter(f=>fam(f)==='head'&&canMove(f));
  if(hs.length<4) return 1;
  const xs=LAYOUT.fixtures.map(f=>f.at[0]);
  const lo=Math.min.apply(null,xs), sp=Math.max(0.001,Math.max.apply(null,xs)-lo);
  const d=hs.map(f=>Math.abs((f.at[0]-lo)/sp-0.5)).sort((a,b)=>a-b);
  return d[Math.min(d.length-1,3)]+1e-4;})();
function chaseGain(xn, c){
  const half = Math.max(1, Math.floor(c.n/2));
  const fold = RIG_MIRRORED ? Math.abs(xn - 0.5) * 2 : xn;
  const span = RIG_MIRRORED ? half : c.n;
  const here = Math.round(fold * (span - 1));
  const pos = RIG_MIRRORED ? (c.pos % span) : c.pos;
  let d = Math.abs(here - pos);
  d = Math.min(d, span - d);
  const env = Math.exp(-(c.age / Math.max(0.09, c.gap * 0.75)) * 1.9);
  if(d === 0) return (0.30 + 0.70 * env) * c.alive;
  if(d === 1) return 0.28 * env * c.alive;
  if(d === 2 && RIG_MIRRORED) return 0.10 * env * c.alive;
  return 0.0;
}

const PARN = Math.max(2, (LAYOUT.fixtures||[]).filter(f=>fam(f)==='par').length);

function fixColour(t,L,kind,xn,e){
  if(L==='stop')  return [0,0,0];
  if(L==='flash') return [255,252,244];
  const bri=briteAt(t), XFC=1.9, j=chIdx(t);
  const bpw=buildProg(t);
  const wh=bpw>=0 ? Math.pow(bpw,1.6)*0.90 : 0;
  const dr=meloDrift(t), hm=chordTurn(t), P=palAt(t);
  const pick=(roles)=>{
    let role, alt;
    if(kind==='up'){ role='deep'; alt=roles[1] }
    else if(kind==='head'){ role=roles[1]; alt=roles[0] }
    else { const fi = RIG_MIRRORED ? Math.round(Math.abs(xn-0.5)*2*(PARN-1)) : Math.round(xn*(PARN-1));
           role = (fi % 2 === 0) ? roles[0] : roles[1];
           alt  = (fi % 2 === 0) ? roles[1] : roles[0]; }
    const base=roleRGB(role,e,bri,P,dr,wh);
    const w=CHORD_LEAN*hm;
    let c=base;
    if(w>0.004){ const o=roleRGB(alt,e,bri,P,dr,wh);
      c=[base[0]+(o[0]-base[0])*w|0, base[1]+(o[1]-base[1])*w|0, base[2]+(o[2]-base[2])*w|0] }
    return kind==='up' ? [c[0]*0.74|0, c[1]*0.74|0, c[2]*0.74|0] : c;
  };
  const R = (L==='spotlight') ? rolesFor('spotlight') : rolesFor(CH[j][1]);
  const cur = pick(R);
  // one crossfade, in RGB, at the chapter join -- the only place an in-between
  // colour is allowed, and it lasts under two seconds
  if(j>0 && t-CH[j][0] < XFC && L!=='spotlight'){
    const w=ss(0,XFC,t-CH[j][0]), p=pick(rolesFor(CH[j-1][1]));
    return [Math.round(lerp(p[0],cur[0],w)),Math.round(lerp(p[1],cur[1],w)),
            Math.round(lerp(p[2],cur[2],w))];
  }
  return cur}

const sc=(c,g)=>[Math.round(cl(c[0]*g,0,255)),Math.round(cl(c[1]*g,0,255)),Math.round(cl(c[2]*g,0,255))];
const W_=[255,252,246];
const CAP=4.0;
const BEAT_HZ = 1/Math.max(0.05, PER);
function musicalHz(){
  let best = BEAT_HZ/4;
  for(const m of [0.25, 0.5, 1, 2, 4]){ const hz = BEAT_HZ*m; if(hz <= CAP + 1e-6) best = hz }
  return best;
}
const STROBE_AT = (function(){
  const ms = MO.filter(x=>x.kind==='drop').sort((a,b)=>a.at-b.at);
  const keep = new Set(); let big = -1;
  for(const m of ms){ const v = (m.v===undefined?0.9:m.v); if(v > big + 1e-6){ big = v; keep.add(m.at) } }
  if(ms.length) keep.add(ms[ms.length-1].at);
  return keep;
})();

/* ---- fixtures are individuals, addressed by where they are ----
   Indexing by i/n hardcodes this one rig. A designer thinks in positions and
   sub-groups, and the same recipe then works on a different layout -- which is
   the entire reason layout and recipe are separate files. Everything below is
   derived from layout.json at load. */
let GEO=buildGeo();
const KIND=k=>LAYOUT.fixtures.filter(f=>fam(f)===k).map(f=>f.id);
function buildGeo(){
  const xs=LAYOUT.fixtures.map(f=>f.at[0]);
  const lo=Math.min.apply(null,xs), hi=Math.max.apply(null,xs), sp=Math.max(0.001,hi-lo);
  const ysAll=LAYOUT.fixtures.map(f=>f.at[1]);
  const ylo=Math.min.apply(null,ysAll), yhi=Math.max.apply(null,ysAll), ysp=Math.max(0.001,yhi-ylo);
  const seen={};
  const g={};
  LAYOUT.fixtures.forEach(function(f,idx){
    const xn=(f.at[0]-lo)/sp;
    const k=fam(f); seen[k]=(seen[k]||0);
    g[f.id]={xn:xn,yn:(f.at[1]-ylo)/ysp,x:f.at[0],y:f.at[1],z:f.at[2],kind:k,
             ki:seen[k]++, zone:f.zone||null,
             outer:(xn<0.26||xn>0.74), centre:(xn>=0.36&&xn<=0.64),
             left:xn<0.5, odd:idx%2===1}});
  Object.keys(g).forEach(function(id){ g[id].kn = seen[g[id].kind] });
  return g}

const ARRAY_MIN = 4;
const DROPS_AT = MO.filter(x=>x.kind==='drop').map(x=>x.at).sort((a,b)=>a-b);
function actNo(t){ let k=0; for(const d of DROPS_AT){ if(d<=t+1e-9) k++; else break } return k }
const DEPLOY = {
  par:0, strip:0, head:0, uplight:0, blinder:0, strobe:0, fog:0, video:0,
  wash:1, co2:1, laser:2, pyro:2, confetti:2,
};
const NDROPS = DROP_TIMES.length;
function deployed(kind, t){
  const want = DEPLOY[kind];
  if(want === undefined || want <= 0) return 1;
  const need = Math.min(want, Math.max(0, NDROPS - 1));
  if(need <= 0) return 1;
  const a = actNo(t);
  if(a < need) return 0;
  if(a > need) return 1;
  const at = DROP_TIMES[need-1];
  return (at === undefined) ? 1 : ss(0, 1, (t - at)/BAR);
}

const GATE_RATE  = {wash:3.2, uplight:3.2, strip:2.2, head:1.5, par:1.5};
const GATE_FLOOR = {wash:0.34, uplight:0.34, strip:0.18, head:0.26, par:0.26};
function buildProg(t){
  const sp = spanAt(t);
  if(!sp || sp.kind !== 'build' || !(sp.to > sp.from)) return -1;
  return cl((t - sp.from) / (sp.to - sp.from));
}
function gateBars(kind, tt){
  const L = primaryLook(tt), e = en(tt);
  const cq = cueAt(tt, L).rate;
  const cyc = (cq === undefined)
    ? {drop:CYC_DROP, build:CYC_BUILD, verse:CYC_VERSE, quiet:2, idle:2, outro:2, spotlight:2}[L]
    : cq;
  const kmul = GATE_RATE[kind] === undefined ? 1 : GATE_RATE[kind];
  const bp = buildProg(tt);
  const accel = (bp >= 0) ? lerp(2.4, 0.30, bp*bp) : 1;
  const drive = lerp(1.9, 1.0, SONG_DRIVE);
  return (cyc===undefined?1:cyc) * kmul * accel * drive * (1.7 - 0.9*e);
}
const GATE_STEPS = [0.125, 0.25, 0.5, 1, 2, 4];
function quantRate(r){
  let best = GATE_STEPS[0], bd = Infinity;
  for(const v of GATE_STEPS){
    const d = Math.abs(Math.log(v/Math.max(1e-6, r)));
    if(d < bd){ bd = d; best = v }
  }
  return best;
}
const NBARS = Math.max(2, Math.ceil((DUR - PH)/BAR) + 3);
let GPH_CACHE = null;
function GPH_BUILD(){
  const kinds = {}, out = {};
  for(const f of (LAYOUT.fixtures||[])) kinds[fam(f)] = 1;
  const t0 = PH + DBP*PER;
  for(const kind in kinds){
    const rate = new Array(NBARS), cum = new Array(NBARS+1);
    cum[0] = 0;
    for(let b=0;b<NBARS;b++){
      rate[b] = quantRate(1/Math.max(0.12, gateBars(kind, t0 + b*BAR + BAR*0.5)));
      cum[b+1] = cum[b] + rate[b];
    }
    out[kind] = {rate:rate, cum:cum};
  }
  return out;
}
function gph(){ if(!GPH_CACHE) GPH_CACHE = GPH_BUILD(); return GPH_CACHE }
function gatePhase(kind, t){
  const G0 = gph();
  const T = G0 && G0[kind];
  if(!T) return 0;
  const m = mpos(t);
  let i = Math.floor(m); if(i >= NBARS-1) i = NBARS-2; if(i < 0) i = 0;
  return T.cum[i] + T.rate[i]*cl(m-i);
}
const PHRASE_BARS = 4;
const QUIET_WASH = 0.22;
const QUIET_UP = 0.14;
const FLOOR_DROP = 0.45;
const DROP_HOLD = 3;
const DROP_FADE = 5;
const DROP_SETTLE = 0.60;
const CUE_XF = 0.06;
const HOFF_SPREAD = 0.15;
const HOFF_TRUSS = 0.50;
const DWELL_LO = 0.35;
const DWELL_HI = 0.22;
const DWELL_CAP = 0.50;
const BUILD_LO = 0.75;
const BUILD_HI = 1.45;
const LIFT_LO = 0.60;
const LIFT_HI = 1.60;
const BLOCKS = {
  bed:       {par:0.30, head:0.12, wash:0.95, uplight:1.00, zoom:0.66, shape:0.00, chase:0.00, lift:0.55, spread:0.10, rate:4.00},
  pulse:     {par:1.00, head:0.34, wash:0.55, uplight:0.75, zoom:0.52, shape:0.10, chase:0.25, lift:0.85, spread:0.00, rate:1.50},
  chase:     {par:0.92, head:0.72, wash:0.30, uplight:0.42, zoom:0.40, shape:0.30, chase:1.00, lift:0.95, spread:0.55, rate:0.50},
  fan:       {par:0.42, head:1.00, wash:0.62, uplight:0.55, zoom:0.26, shape:0.20, chase:0.00, lift:0.95, spread:0.30, rate:2.00},
  cross:     {par:0.55, head:1.00, wash:0.40, uplight:0.45, zoom:0.16, shape:0.90, chase:0.30, lift:1.00, spread:0.60, rate:0.50},
  ballyhoo:  {par:0.62, head:1.00, wash:0.52, uplight:0.50, zoom:0.22, shape:1.00, chase:0.55, lift:1.00, spread:0.70, rate:0.25},
  flood:     {par:1.00, head:0.92, wash:1.00, uplight:1.00, zoom:0.92, shape:0.40, chase:0.10, lift:1.00, spread:0.05, rate:1.00},
  silhouette:{par:0.06, head:0.85, wash:0.16, uplight:1.00, zoom:0.34, shape:0.00, chase:0.00, lift:0.70, spread:0.15, rate:4.00},
  spot:      {par:0.06, head:0.28, wash:0.10, uplight:0.22, zoom:0.20, shape:0.00, chase:0.00, lift:0.45, spread:0.00, rate:4.00},
  swell:     {par:0.40, head:0.66, wash:1.00, uplight:1.00, zoom:0.58, shape:0.15, chase:0.00, lift:0.90, spread:0.20, rate:4.00},
  drift:     {par:0.22, head:0.80, wash:0.70, uplight:0.85, zoom:0.30, shape:0.55, chase:0.00, lift:0.80, spread:0.45, rate:2.00},
};
const CUE_LIST = {
  intro:    ['bed','drift','swell','pulse'],
  verse:    ['pulse','fan','pulse','drift'],
  break:    ['swell','drift','silhouette','swell'],
  quiet:    ['swell','drift','spot','swell'],
  build:    ['chase','chase','fan','cross'],
  drop:     ['flood','ballyhoo','cross','ballyhoo'],
  outro:    ['bed','silhouette','bed','spot'],
  idle:     ['bed','bed','silhouette','bed'],
  spotlight:['spot'], flash:['flood'], stop:['spot'],
};
function cueName(L, n, rep){
  const list = CUE_LIST[L] || CUE_LIST.verse;
  const k = list.length;
  return list[((n + rep) % k + k) % k];
}
function cueAt(t, L){
  const sec = sectionAt(t), rep = sec ? (sec.repeat || 1) : 1;
  const m = mpos(t)/PHRASE_BARS, n = Math.floor(m);
  const A = BLOCKS[cueName(L, n-1, rep)] || BLOCKS.pulse;
  const B = BLOCKS[cueName(L, n, rep)] || BLOCKS.pulse;
  const w = ss(0, CUE_XF, m - n);
  const out = {};
  for(const k in B) out[k] = lerp(A[k] === undefined ? B[k] : A[k], B[k], w);
  return out;
}
const INSTR_W = 1.00;
const INSTR_LO = 0.30;
/* The instrument voice ducks toward this floor between hits and reaches full on
   one. It used to run 0.12..1.90, which is mostly above the ceiling: during a
   drop the base level is already near 1.0, so `cl(lv*emph*gate)` clipped at 1.0
   whether the kick was there or not, and the transient was thrown away at the
   very last step. A rig punches because it drops between hits, not because it
   goes past full -- a real dimmer has no headroom above full either. */
const INSTR_HI = 1.00;
/* A stem is a bed and an accent is a transient, so they add -- they do not
   compete for a max. stem('drums') sits near 1.0 for the whole of a drop, and
   under Math.max a kick could never rise above it. The hit has to punch through
   the bed it is played over, which is what makes a rig look like it is hearing
   the drummer rather than the mix. */
const FAMILY_VOICE = {
  par:     t => cl(0.68*stem('drums',t)  + 0.92*accentOf('kick',t)),
  uplight: t => cl(0.78*stem('bass',t)   + 0.55*accentOf('bass',t)),
  head:    t => cl(Math.max(stem('vocals',t), stem('other',t)) + 0.50*accentOf('vocals',t)),
  wash:    t => cl(Math.max(stem('piano',t), stem('other',t))  + 0.42*accentOf('piano',t)),
  strip:   t => cl(0.55*stem('guitar',t) + 0.80*accentOf('hat',t) + 0.75*accentOf('snare',t)),
  // the backbeat. Blinders on 2 and 4 is the oldest move in the trade, and
  // these three families previously had no instrument at all: instr() returned
  // a flat 1 for every blinder, strobe and screen in every rig.
  blinder: t => cl(0.20 + 0.95*accentOf('snare',t)),
  strobe:  t => cl(0.15 + 0.90*accentOf('snare',t) + 0.45*accentOf('hat',t)),
  video:   t => cl(Math.max(stem('vocals',t), stem('other',t))),
};
function instr(kind, t){
  const f = FAMILY_VOICE[kind];
  if(!f || INSTR_W <= 0) return 1;
  return lerp(1, INSTR_LO + (INSTR_HI-INSTR_LO)*cl(f(t)), INSTR_W);
}
const LIFT_MID = 0.75;
function climbAt(t, L){
  const bp = buildProg(t);
  const p = bp >= 0 ? bp : (L === 'build' ? chProg(t) : -1);
  return p < 0 ? 1 : lerp(BUILD_LO, BUILD_HI, p);
}
function emph(kind, t, L){
  const c = cueAt(t, L);
  const v = c[kind];
  const lift = cl((c.lift === undefined ? LIFT_MID : c.lift)/LIFT_MID, LIFT_LO, LIFT_HI);
  return (v === undefined ? 1 : v) * lift * climbAt(t, L) * instr(kind, t) * longLift(t, L) * liftMoodAt(t) * novaLift(t);
}
const BED_LOOKS = {quiet:1, idle:1, outro:1};
const BED_KINDS = {wash:1, uplight:1, strip:1};
function arrayGate(G, t, e, L, n){
  if(BED_LOOKS[L] && BED_KINDS[G.kind]){
    const dep0 = deployed(G.kind, t);
    if(dep0 <= 0) return 0;
    return dep0 * BED_HOLD;
  }
  const dep = deployed(G.kind, t);
  if(dep <= 0) return 0;
  if(!n || n <= ARRAY_MIN) return dep;
  const ceil = {drop:0.46, build:0.40, verse:0.34, quiet:QUIET_COV, idle:0.22,
                outro:0.26, spotlight:0.18, stop:0, flash:1}[L];
  const bp = buildProg(t);
  let top = (bp >= 0) ? lerp(0.16, 0.52, bp) : (ceil===undefined?0.52:ceil);
  if(L === 'drop'){
    const sd = since('drop', t, 1e9)[1];
    if(sd !== null && sd > DROP_HOLD*BAR)
      top *= lerp(1, DROP_SETTLE, ss(0, DROP_FADE*BAR, sd - DROP_HOLD*BAR));
  }
  top = Math.min(1, top*longLift(t, L));
  const cov = (top<=0||top>=1) ? top : cl(0.10 + (top-0.10)*(0.18+0.82*e), 0.08, 1);
  if(cov >= 1) return 1;
  if(cov <= 0) return 0;
  const ph = gatePhase(G.kind, t);
  const fx0 = (n > ARRAY_MIN) ? Math.abs(G.xn - 0.5)*2 : G.xn;
  const fx = GATE_GROUPS > 0 ? Math.floor(fx0*GATE_GROUPS + 1e-6)/GATE_GROUPS : fx0;
  const wave = 0.5 + 0.5*Math.cos(2*Math.PI*(fx*1.2 + G.yn*0.6 - ph));
  const soft = 0.16 + 0.22*e;
  const edge = 1 - cov;
  const gate = cl((wave - edge + soft) / (soft*2), 0, 1);
  const fl0 = GATE_FLOOR[G.kind];
  const lk = {drop:FLOOR_DROP, flash:1.0, build:0.60, verse:0.42, break:0.16,
              quiet:0.10, idle:0.06, outro:0.14}[L];
  const fl = (fl0 === undefined) ? undefined
           : fl0 * (lk === undefined ? 0.5 : lk) * (0.30 + 0.70*e);
  const held = (fl === undefined || L === 'stop' || L === 'spotlight')
             ? gate : fl + (1 - fl) * gate;
  const soften = (L==='quiet'||L==='idle'||L==='outro'||L==='break') ? QUIET_GAIN : 2.4;
  return held * cl(1/Math.max(0.12, cov), 1, soften) * dep;
}
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
const zoomAt=(t,e,L)=>{
  const bp=buildProg(t);
  if(bp>=0) return cl(lerp(0.46,0.06,bp));
  return cl(cueAt(t,L).zoom * lerp(1, 0.62, tensionAt(t)*MOOD_W));
};
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
  const drumGate=0.14+0.86*ss(0.14,0.82,stem('drums',t));
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
    if(d) dip=1-KILL_DEPTH*ss(0,1,1-dt/(PER*KILL_BEATS));
  }
  if(CUT_DEPTH>0){
    const m=mpos(t), into=m-Math.floor(m/CUT_PHRASE)*CUT_PHRASE;
    const start=CUT_PHRASE-CUT_BARS;
    if(into>=start){
      const x=cl((into-start)/CUT_BARS);
      const after=en(t+(CUT_BARS-(into-start))*BAR+BAR*0.5);
      const before=en(t-BAR*0.5);
      const earn=ss(0, CUT_RISE, after-before);
      dip*=1-CUT_DEPTH*earn*Math.sin(Math.PI*x);
    }
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
      const musical=(0.15+0.85*e)*(L==='drop'?1:0.72);
      lv=(base*0.42 + 0.95*musical)*wave*EX.arc
         + (0.16+0.52*e)*A*grow*K.accent*drumGate;
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
      if(L==='quiet') lv*=0.78+0.22*Math.sin(2*Math.PI*(mpos(t)/4)+sym(G.xn)*2.2);
      if(G.outer) lv*=1.10; else lv*=0.92;   // the outer pair carries the wash
    }
    F.push({id:id,r:c[0],g:c[1],b:c[2],level:+cl(lv*dip*emph('par',t,L)*arrayGate(G,t,e,L,PARS.length)).toFixed(3)})});

  // 4 uplights on the back wall: a slow colour bed. Almost never pulses.
  const upSwap=ss(0.25,0.75,barPh(t));      // odds hand over to evens across the bar
  UPS.forEach(function(id,i){
    const G=GEO[id];
    let c=fixColour(t,L,'up',G.xn,e), lv=0;
    if(off){c=[0,0,0]}
    else if(L==='flash'){lv=0.85}
    else{
      const share=(i%2===0)?(1-upSwap):upSwap;
      const bed=((L==='quiet'?QUIET_UP:0.070)+0.19*e*(L==='drop'?1.1:0.78))*(0.28+1.10*ss(0.12,0.86,stem('bass',t)));
      lv=bed*(0.55+0.90*share)*(0.84+0.16*Math.sin(2*Math.PI*(mpos(t)/8)+sym(G.xn)*3.1));
      if(L==='build') lv*=lerp(0.35,1,layer(0));
      if(L==='spotlight') lv*=0.22;
    }
    F.push({id:id,r:c[0],g:c[1],b:c[2],level:+cl(lv*dip*emph('uplight',t,L)*arrayGate(G,t,e,L,UPS.length)).toFixed(3)})});

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
  const dw=cl(DWELL_LO*(1-eM)+DWELL_HI*ss(0.72,1.0,eM),0,DWELL_CAP);
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
  const om=rateNow(t), duty=Math.max(1-DWELL_CAP,1-dw), S=1.5;
  const thp=om*S/duty;                              // peak phase rate
  const ampP=Math.max(0.02,(LIMP-DADE*EMAX)/thp);   // pan  budget, proven
  const ampT=Math.max(0.02,(LIMT-DADE*EMAX)/(2*thp));// tilt runs at 2x in the sway shape
  const msc=Math.min(1, moveScaleAt(t));
  const amp=Math.min(AMP_CAP*msc, ampP)*(0.42+0.58*eM)*SLEW_CAP;
  const tam=Math.min(AMP_CAP*0.65*msc, ampT)*(0.34+0.66*eM)*SLEW_CAP;
  // No fast path for d==0. `return u` is NOT the d->0 limit of the branch below
  // (ss(m) != m), so crossing zero jumped the phase by ~0.6 rad and slewed the
  // heads at 9.8 units/s. Always ease -- which is what a real motor does anyway.
  const dwell=(u,d)=>{const m=u-Math.floor(u), mv=Math.max(1e-6,1-d);
    return Math.floor(u)+(m<mv?ss(0,1,m/mv):1)};
  const u=dwell(th/(2*Math.PI) + (1-dw)*0.5*MOVE_LEAD, dw)*2*Math.PI;
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
  const alt=0.5+0.5*Math.cos(2*Math.PI*(mpos(t)/8));
  const bothTrusses=(L==='drop'||L==='flash')?1:0;
  HEADS.forEach(function(id,i){
    const G=GEO[id];
    // fan and mirror come from WHERE the head hangs, so a rig with a different
    // number of heads or different spacing still reads correctly
    // heads on the upstage truss counter-rotate against the front truss, so the
    // beams cross over the floor instead of sweeping in parallel
    const back=G.z>3.0, mir=(G.left?1:-1)*(back?-1:1);
    const hoff=G.xn*2*Math.PI*HOFF_SPREAD+(back?Math.PI*HOFF_TRUSS:0), fan=(G.xn-0.5)*2;
    const pSway=amp*Math.sin(u+hoff)*mir + fan*0.13;
    const pCirc=amp*Math.sin(u+hoff)*mir;
    const tSway=tam*Math.sin(2*u+hoff);
    const tCirc=tam*Math.cos(u+hoff);
    let pan =cl(0.5 +(lerp(pSway,pCirc,shape))*still);
    // the upstage truss aims out over the crowd; the front truss aims down
    let tilt=cl((back?0.62:0.42)+(lerp(tSway,tCirc,shape))*still
                + MEL_TILT*meloDrift(t)*still*(back?1:-1));
    const share=back?(1-alt):alt;
    const gate=bothTrusses?1:(0.10+0.90*share);
    let c=fixColour(t,L,'head',G.xn,e), lv=0, hz=0;
    if(off){c=[0,0,0]}
    else if(L==='flash'){lv=1}
    else if(L==='spotlight'){
      const near=Math.abs(G.xn-0.5);
      const voc=Math.max(stem('vocals',t), voxAt(t), sung(t));
      lv = near<=CENTRE_PAIR ? (0.30+0.62*voc)*(1-0.5*near/Math.max(1e-6,CENTRE_PAIR)) : 0.0}
    else{
      const lead=(((bx%2)+2)%2===0)?G.outer:!G.outer;   // outer pair, then inner pair
      // a small positional term, so the four heads are never identical even
      // between accents -- in a real rig no two fixtures read the same
      const base=(0.11+0.26*e)*(0.86+0.28*sym(G.xn));
      const lamp=(L==='drop'?0.30+0.44*e:0.18+0.36*e)*(0.84+0.28*Math.max(voxAt(t),sung(t)));
      lv=(base*EX.arc+lamp*accent(p,e)*(lead?1:0.28)*busy*grow+0.09*accentHit(t)*(lead?1:0.5))
;
      if(L==='build') lv*=lerp(0.25,1,layer(2));
      if(L==='quiet') lv=base*0.75+0.045*(0.5+0.5*Math.sin(2*Math.PI*(mpos(t)/4)));
      if(L==='idle')  lv=0.04+0.03*(0.5+0.5*Math.sin(2*Math.PI*(mpos(t)/8)+sym(G.xn)*4));
      if(L==='drop'){const[d,s]=since('drop',t,8);
        if(s!==null&&s<BAR&&STROBE_AT.has(d.at)) hz=musicalHz()}
    }
    F.push({id:id,r:c[0],g:c[1],b:c[2],level:+cl(lv*dip*gate*emph('head',t,L)*panBias(G.xn)*arrayGate(G,t,e,L,HEADS.length)).toFixed(3),
            pan:+pan.toFixed(3),tilt:+tilt.toFixed(3),strobe:+hz.toFixed(3),
            zoom:+zoomAt(t,e,L).toFixed(3)})});

  // 2 strobes: ramped in and out, never a hard gate
  STROBES.forEach(function(id,i){
    const G=GEO[id];
    let lv=0,hz=0;
    if(L==='flash'){lv=1}
    else if(L==='drop'){const[d,s]=since('drop',t,8);
      if(s!==null&&s<BAR&&STROBE_AT.has(d.at)){lv=(1-ss(BAR*0.6,BAR,s));hz=musicalHz()}}
    else if(L==='build'&&z){const rem=z.to-t;
      if(rem<=2*BAR){lv=ss(0,1,1-rem/(2*BAR))*((G.left===(((bx%2)+2)%2===0))?1:0.5)*Math.min(1,grow);
        hz=musicalHz()}}
    F.push({id:id,level:+cl(lv*dip*STROBE_GAIN*deployed('strobe',t)).toFixed(3),strobe:+hz.toFixed(3)})});

  /* Blinders point AT the crowd. Used sparingly and only on the biggest hits --
     a blinder that is on often is just a lamp. Two windows: the first bar of a
     drop, and the last two bars of a build where it swells into the drop. */
  BLINDERS.forEach(function(id,i){
    const G=GEO[id]; let lv=0, hz=0;
    if(L==='flash'){ lv=1 }
    else if(L==='drop'){ const[d,sd]=since('drop',t,8);
      if(sd!==null&&sd<BAR){ lv=(1-ss(BAR*0.35,BAR,sd))*(0.75+0.25*(d.v??0.9));
        hz=musicalHz() } }
    else if(L==='build'&&z){ const rem=z.to-t;
      if(rem<=2*BAR) lv=0.55*ss(0,1,1-rem/(2*BAR))*(i===(((bx%2)+2)%2)?1:0.6) }
    F.push({id:id,level:+cl(lv*dip*Math.min(1,grow)*(0.25+0.75*BANG)*deployed('blinder',t)).toFixed(3),strobe:+hz.toFixed(3)})});

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
      const wave=0.72+0.28*Math.cos(2*Math.PI*(sym(G.xn)*1.5-bp4));
      const base={drop:0.28,build:0.12,verse:0.15,quiet:QUIET_WASH,idle:0.042,outro:0.05}[L]??0.10;
      lv=(base+0.32*e*(L==='drop'?1:0.64))*wave*EX.arc;
      if(L==='build') lv*=lerp(0.30,1,layer(1));
      if(L==='spotlight') lv*=0.18;
    }
    // slow counter-rotating tilt, so the backlight fans against the front beams
    const th2=motionPhase(t)*0.5+(G.z>29?Math.PI:0);
    F.push({id:id,r:c[0],g:c[1],b:c[2],level:+cl(lv*dip*emph('wash',t,L)*panBias(G.xn)*arrayGate(G,t,e,L,WASHES.length)).toFixed(3),
            pan:+cl(0.5+0.16*Math.sin(th2+G.xn*3.1)).toFixed(3),
            tilt:+cl(0.34+0.12*Math.sin(th2*2)).toFixed(3),
            zoom:+cl(zW*1.15).toFixed(3)})});

  /* Lasers are emitted at zero, deliberately. They are the only fixture in this
     rig that can injure an audience, and driving them needs a safety layer --
     aerial-only zones, a hard height floor, an interlock -- that does not exist
     yet. A zero here is a decision, not an omission. */
  LASERS.forEach(function(id){
    const G=GEO[id], lim=(LAYOUT.limits||{});
    const zones=lim.laser_zones||[], floorM=(lim.laser_min_height_m!==undefined?lim.laser_min_height_m:3.0);
    const okZone = zones.indexOf(G.zone)>=0;
    const okHigh = G.y >= floorM;
    if(!(okZone && okHigh)){
      F.push({id:id,level:0,pattern:0,scan:0,
              held_back: !okZone ? ('zone '+G.zone+' is not a declared laser zone')
                                 : ('mounted at '+G.y.toFixed(1)+' m, below the '+floorM+' m floor')});
      return }
    let lv=0;
    const[dL,sdL]=since('drop',t,BAR*8);
    if(dL && sdL!==null){
      const rise=ss(0,1,sdL/(BAR*0.5));
      const fall=1-ss(0,1,cl((sdL-BAR*3)/BAR));
      lv=(0.55+0.45*(dL.v!==undefined?dL.v:0.9))*rise*fall;
    }
    if(L==='build'&&z){ const rem=z.to-t;
      if(rem<=4*BAR) lv=Math.max(lv,0.70*ss(0,1,1-rem/(4*BAR))); }
    if(L==='flash') lv=Math.max(lv,0.9);
    lv*=0.30+0.70*BANG;
    const fan = 0.55+0.45*Math.cos(2*Math.PI*(sym(G.xn)*2 - mpos(t)/2));
    const c = fixColour(t,L,'head',G.xn,e);
    F.push({id:id, level:+cl(lv*fan*dip*EX.arc*deployed('laser',t),0,1).toFixed(3),
            r:c[0], g:c[1], b:c[2], pattern:1, scan:0, aerial:true})});

  /* The video wall is emitted as a declaration, not pixels. 96x54 is 5,184
     pixels a frame, and more importantly a screen is not a light: it wants its
     own reader off the same map, the way the drone reader does. Recorded here so
     the gap is visible in the frame rather than only in a document. */
  KIND('co2').forEach(function(id){
    const G=GEO[id]; let lv=0;
    if(L==='drop'){ const[d,sd]=since('drop',t,8);
      const burst=Math.min((LAYOUT.limits||{}).co2_max_burst_s||1.2, BAR*0.6);
      if(sd!==null && sd<burst) lv=(1-ss(0,burst,sd))*(0.6+0.4*(d&&d.v!==undefined?d.v:0.9)); }
    F.push({id:id,level:+cl(lv*BANG*deployed('co2',t),0,1).toFixed(3)})});

  KIND('confetti').forEach(function(id){
    let lv=0;
    const last=DROPS_AT.length?DROPS_AT[DROPS_AT.length-1]:null;
    if(last!==null && t>=last && t-last<BAR*4) lv=1-ss(0,BAR*4,t-last);
    F.push({id:id,level:+cl(lv*BANG,0,1).toFixed(3),
            note:'once, on the last drop -- confetti fired twice is confetti nobody notices'})});

  KIND('pyro').forEach(function(id){
    const G=GEO[id], lim=(LAYOUT.limits||{}), zones=lim.pyro_zones||[];
    const armed = zones.indexOf(G.zone)>=0 && !!lim.pyro_interlock;
    if(!armed){ F.push({id:id,level:0,
      held_back: zones.indexOf(G.zone)<0 ? ('zone '+G.zone+' is not a declared pyro zone')
                                         : 'declared zone but the layout names no interlock'});
      return }
    const gap=lim.pyro_min_gap_s||20;
    let cue=null;
    for(const d of DROPS_AT){ if(d>t) break;
      if(cue===null || d-cue>=gap) cue=d }
    let lv=0;
    if(cue!==null){ const age=t-cue, dur=Math.min(1.6, BAR*0.7);
      if(age>=0 && age<dur) lv=(1-ss(0,dur,age)) }
    F.push({id:id, level:+cl(lv*BANG*deployed('pyro',t),0,1).toFixed(3), armed:true,
            interlock:lim.pyro_interlock})});

  VIDEO.forEach(function(id){
    const R=rolesFor(L==='drop'?'drop':(L==='build'?'build':'verse'));
    const c=roleRGB(R[1], e, 1, palAt(t), meloDrift(t));
    const pulse=0.30+0.45*e*(0.55+0.45*(1-bph(t)));
    F.push({id:id, level:+cl((off?0:pulse)*deployed('video',t),0,1).toFixed(3),
            r:c[0], g:c[1], b:c[2], content:'wash',
            note:'a level and a colour so the wall is lit; real pixels need a video reader'})});

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
      const sxt=(bph(t)*4)%1, drift=(mpos(t)/2)%1;
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
      const back = bsb<0.045 ? ss(0,0.045,bsb) : 1-ss(0,1,cl((bsb-0.045)/1.20));
      const g2=(amb*0.8+(0.14+0.46*e)*back+0.19*stab)*lerp(0.3,1,L==='build'?layer(3):1);
      for(let i=0;i<N2;i++){
        const mix=0.5+0.5*Math.sin(2*Math.PI*(i/N2*1.5-bp4));
        const col=[lerp(base[0],alt[0],mix),lerp(base[1],alt[1],mix),lerp(base[2],alt[2],mix)];
        // a soft taper at each end, so the bar does not stop with a hard edge
        const taper=Math.min(1,Math.min(i,N2-1-i)/(N2*0.10));
        p2[i]=sc(col,g2*taper*dip)}
    }
    const sdep=deployed('strip',t);
    STRIPS.forEach(function(id,i){
      const src0=(i%2===0?p1:p2);
      F.push({id:id, pixels: sdep>=0.999 ? src0 : src0.map(q=>[Math.round(q[0]*sdep),Math.round(q[1]*sdep),Math.round(q[2]*sdep)])}) });
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
  for(const f of LAYOUT.fixtures) if(fam(f)==='fog') F.push({id:f.id,level:fg});

  const[r,s]=since('return',t,2*BAR);
  if(r){const g=0.38+0.62*ss(0,1,cl(s/(2*BAR)));const FOGIDS=new Set(LAYOUT.fixtures.filter(f=>fam(f)==='fog').map(f=>f.id));
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
