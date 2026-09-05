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
     4 pump        the rig breathes with the sidechain
     5 sections    the rig gets bigger and smaller with the song
     6 colour      a profile, two colours at a time
     7 accents     the drum hits between the beats
     8 instruments how WIDE the rig is follows how full the arrangement is
     9 melody      WHICH lamp follows the pitch of the tune
    10 chords      the colour changes when the harmony changes, and only then
    11 heads       the two moving heads come back

   Rungs 8 to 10 are what a lighting designer does with five lamps in a row, and
   they are the reason the row exists. A row is an AXIS. Walking a pulse along it
   is decoration -- it looks busy and means nothing, which is what rung 3 does and
   why it was overdone. Mapping something that genuinely has an axis is different:
   pitch is high or low, so a rising tune walks up the row and a falling one walks
   down, and the rig is now telling you something you can hear.

   The same discipline applies to the other two. How many lamps are lit says how
   full the arrangement is, so a solo vocal gets one lamp and the full band gets
   five -- the rig's width carries the song's width and nothing is lit for the
   sake of being lit. Colour changes when the harmony changes and at no other
   time, which is what stops colour being wallpaper.

   Each rung is judged by a check in build.html that can FAIL, not by whether it
   looks nice. Rungs are accepted one at a time and written to
   synth/learning/<song>.json, which is what makes this a learning phase rather
   than a tuning session: the accepted settings are the starting point for a song
   nobody has mapped yet. */

/* ---- the rate a room can read -------------------------------------------
   Every musical fact has its own speed and none of them is a lighting speed.
   The tune moves 7.9 notes a second, the chords change every 1.9 seconds, the
   arrangement shifts every bar. Driving a lamp directly from any of those makes
   a strobe, which is what Renjith saw and called terrible -- and it was, and it
   was the same mistake three times.

   A lighting designer does not rebuild the rig every two seconds. Each element
   below is SMOOTHED over a phrase and then HELD, so the rig states one idea long
   enough to be read before it states the next. The musical fact decides WHAT the
   rig does; these numbers decide how often it is allowed to say it. */
const PHRASE = 2;                  // bars a gesture is averaged over
const HOLD   = { melody: 1, width: 4, colour: 4 };   // bars before it may change again

/* ---- energy: the last thing applied, so it never changes what the show says,
   only how hard it says it ------------------------------------------------- */
const DRIVE = (function(){ try { return (ENERGY || "medium") } catch(e) { return "medium" } })();
const E = ({
  low:    { lvl:0.74, bed:0.80, spread:1.25, flash:0.80 },
  medium: { lvl:1.00, bed:1.00, spread:1.00, flash:1.00 },
  high:   { lvl:1.16, bed:1.14, spread:0.80, flash:1.22 },
}[DRIVE]) || { lvl:1, bed:1, spread:1, flash:1 };

const STEP = (function(){ try { return Math.max(1, Math.min(11, +LADDER || 1)) } catch(e) { return 1 } })();

/* ---- one rung on its own -------------------------------------------------
   The ladder is cumulative, so rung 9 means rungs 1 to 9 all running at once.
   That is right for building a show and wrong for finding out whether ONE thing
   works: if the melody looks bad while eight other elements are moving, you
   cannot say which of the nine is at fault.

   SOLO runs a single rung on a plain carrier. Rungs about WHEN something happens
   keep the beat, because without it there is nothing to be on time with. The rest
   sit on a steady wash, so the only thing moving on stage is the element being
   judged. use(n) is the gate everything reads: cumulative normally, exactly one
   rung when soloing. */
const SOLO = (function(){ try { return SOLORUNG ? +SOLORUNG : 0 } catch(e) { return 0 } })();
/* A few rungs speak THROUGH another one and cannot be seen without it. Chords
   change the colour, so soloing chords with the colour machinery off gives five
   white lamps and tells you nothing. Written down rather than left implicit. */
const NEEDS = { 10: [6] };            // chords are expressed as colour
const use  = n => SOLO ? (n === SOLO || (NEEDS[SOLO] || []).indexOf(n) >= 0)
                       : (STEP >= n);
const BEATY = { 1:1, 2:1, 3:1, 7:1 };
const SOLO_STEADY = SOLO && !BEATY[SOLO];

const DECAY    = Math.max(0.055, PER * 0.22);
/* One number per rung, set on the page and written into the learning file, so the
   value that survives is the one a human chose while watching -- not one I picked
   while writing this. */
const K = (function(){ try { return (KNOB===null||KNOB===undefined) ? null : +KNOB } catch(e){ return null } })();
const OFFBEAT  = K!==null && (SOLO||STEP)===2 ? K : 0.5;   // rung 2: beats 2-4 against the downbeat

/* ---- rung 4: the pump -------------------------------------------------------
   Levels is built on its sidechain. Every kick ducks the whole mix and it
   breathes back over the beat that follows, and lights that merely flash on time
   miss the thing that makes the record feel the way it does.

   The map says WHETHER the record pumps and BY HOW MUCH, per chapter, because
   that is a fact about the recording -- listen/pump.py measures it and it comes
   out negative on music that cannot pump. How far the light ducks is a lighting
   decision and lives here. DUCK_GAIN converts the measured recovery into a duck
   depth; it is the one number in this rung that nobody measured. */
/* A duck needs something to duck. Flashing on the beat and ducking on the beat
   are opposite gestures -- the flash is brightest at the kick, the sidechain is
   darkest there -- so a rig that only flashes has decayed to nothing by the time
   the pump recovers and there is no breathing to see. Measured: the emitted light
   recovered -0.63 with the pump on versus -0.67 with it off, which is the flash's
   own decay and nothing else.

   Real pumping rigs are mostly ON. The bed is the sustained wash the compressor
   acts on; the flashes ride on top of it. That is a visible change to the look
   and it is the point of this rung rather than a side effect. */
const BED       = (K!==null && (SOLO||STEP)===4 ? K : 0.55) * E.bed;
const DUCK_GAIN = 2.2;
const DUCK_MAX  = 0.62;
const PUMPING   = !!(PUMP && PUMP.present);
const RELEASE   = (PUMP && PUMP.release_at_beat_fraction) || 0.38;
function duckAt(t){
  if(!use(4) || !PUMPING) return 1;
  let d = PUMP.depth || 0;
  const pc = PUMP.per_chapter || [];
  for(const [at, dep, ok] of pc){ if(at <= t){ d = ok ? dep : 0 } else break }
  const amt = Math.min(DUCK_MAX, Math.max(0, d * DUCK_GAIN));
  const k = beatIndex(t); if(k < 0) return 1;
  const nb = (k+1 < BEATS.length) ? BEATS[k+1] : BEATS[k] + PER;
  const ph = (t - BEATS[k]) / Math.max(1e-6, nb - BEATS[k]);
  return 1 - amt * Math.exp(-ph / RELEASE);       // ducked at the kick, back by the next
}
const WHITE    = [255, 250, 242];
const PARS     = LAYOUT.fixtures.filter(f => f.kind === "par");
const HEADS    = LAYOUT.fixtures.filter(f => f.kind === "head");
const NP       = Math.max(1, PARS.length);
const DOWNSET  = new Set(DOWN.map(t => +t.toFixed(3)));

/* rung 5: colour, from a fixed profile. Two on stage at a time, never a hue
   between them -- the whole reason the old show looked random. */
/* garrix and garrix-red come from the look of his shows rather than from measuring
   any footage: a cold saturated base, ONE hot accent, white reserved for impact,
   and very few colours on stage at any moment. The restraint is the character --
   his stages are mostly two colours and a blinder, not a rainbow. If a specific
   show is wanted these are the numbers to change. */
const PROFILES = {
  /* white only: colour removed from the picture entirely, so a problem with
     timing, position or width can be judged without colour arguing with it. The
     chords rung has nothing to say under this theme and its check says so. */
  white:      { a:[0,0,.62], b:[0,0,.62] },
  garrix:     { a:[214,.95,.52], b:[356,.94,.50] },   // electric blue, red accent
  "garrix-red":{ a:[356,.94,.50], b:[206,.94,.50] },  // red base, blue accent
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
  if(!use(7)) return [];
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

/* ---- what the map already knows and nothing was reading ------------------- */
const OBS    = MAP.obs || {};
const INSTR  = OBS.instruments || null;
const CHORDS = (OBS.chords && OBS.chords.events) || [];
const MELN   = (function(){
  const n = (OBS.melody && OBS.melody.notes) || [], out = [];
  for(const e of n) if(e && e.length >= 3 && isFinite(e[2])) out.push([e[0], e[2]]);
  return out })();
/* the tune's own range, from the middle 90% so one stray octave does not flatten
   everything else into the same lamp */
const MELRANGE = (function(){
  if(MELN.length < 8) return null;
  const v = MELN.map(x => x[1]).sort((a,b) => a-b);
  const lo = v[Math.floor(v.length*0.05)], hi = v[Math.floor(v.length*0.95)];
  return hi - lo > 2 ? {lo, hi} : null })();

const lastAtOrBefore = (arr, t, key) => {
  let lo = 0, hi = arr.length - 1, k = -1;
  while(lo <= hi){ const mi = (lo+hi)>>1; if(key(arr[mi]) <= t){ k = mi; lo = mi+1 } else hi = mi-1 }
  return k };

/* the bar this instant belongs to, and the start of the block it is held in.
   Counting from the first BEAT rather than the first BAR put every block one beat
   off the music, so a colour change that was meant to land on a chord landed
   between two of them. The bar line is where the downbeats are. */
const BAR0 = (DOWN && DOWN.length) ? DOWN[0] : PH;
const barOf = t => Math.floor((t - BAR0) / BAR);
const blockStart = (t, bars) => BAR0 + Math.floor(barOf(t) / bars) * bars * BAR;

/* rung 8: how many lamps are in play, from how full the arrangement is --
   averaged over a phrase and held for four bars, and never below three lamps
   unless the arrangement really has almost nothing in it. A rig that drops to two
   lamps every other bar reads as broken rather than as restraint. */
function widthAt(t){
  if(!use(8) || !INSTR || !INSTR.density_per_bar || !INSTR.density_per_bar.length) return NP;
  const D = INSTR.density_per_bar, t0 = blockStart(t, HOLD.width);
  let sum = 0, n = 0;
  for(const [at, d] of D){ if(at >= t0 - PHRASE*BAR && at < t0 + HOLD.width*BAR){ sum += d; n++ } }
  if(!n){ const k = lastAtOrBefore(D, t, x => x[0]); sum = k<0?D[0][1]:D[k][1]; n = 1 }
  const d = sum / n;
  const floor = d < 0.12 ? 1 : 3;                  // a real solo may have one lamp
  return Math.max(floor, Math.min(NP, Math.round(1 + d * (NP - 1) * E.spread)));
}
/* rung 9: where along the row, from the pitch of the tune -- as the average of a
   phrase, moving at most once a bar. Following note to note put the lit lamp
   somewhere new eight times a second, which is the single worst thing in this
   file and the reason the melody rung looked terrible. */
function pitchPos(t){
  if(!use(9) || !MELRANGE || !MELN.length) return null;
  const t0 = blockStart(t, HOLD.melody);
  let sum = 0, n = 0;
  for(let i = lastAtOrBefore(MELN, t0 + HOLD.melody*BAR, x => x[0]); i >= 0; i--){
    if(MELN[i][0] < t0 - PHRASE*BAR) break;
    sum += MELN[i][1]; n++;
  }
  if(n < 3) return null;                            // the tune is not really playing here
  return cl((sum/n - MELRANGE.lo) / (MELRANGE.hi - MELRANGE.lo), 0, 1);
}
/* rung 10: which of the two colours leads, changing only when the chord changes */
/* rung 10: which colour, from the harmony -- but not on every chord. Changing
   colour every 1.9 seconds is wallpaper with a faster loop. The dominant root of
   each four-bar block decides the colour, so the rig states a colour, holds it
   long enough to mean something, and moves when the harmony has actually moved. */
function chordState(t){
  if(!use(10) || !CHORDS.length) return null;
  const t0 = blockStart(t, HOLD.colour), t1 = t0 + HOLD.colour*BAR;
  const inBlock = [];
  for(let i = lastAtOrBefore(CHORDS, t1, x => x.at); i >= 0; i--){
    if(CHORDS[i].at < t0) break;
    inBlock.push(CHORDS[i]);
  }
  const k = inBlock.length
    ? CHORDS.indexOf(inBlock[Math.floor(inBlock.length/2)])   // the middle of the block
    : lastAtOrBefore(CHORDS, t, x => x.at);
  if(k < 0) return null;
  const name = CHORDS[k].chord || "";
  /* The root note moves the hue. Swapping which lamp holds which colour was a
     positional change, not a colour one -- the palette never moved, so nothing on
     stage told you the harmony had. A root maps to a small hue offset instead, so
     a chord change is visible AS a colour change while staying inside the two
     colours you picked. Twelve roots across 30 degrees: enough to see, not enough
     to turn the rig into a rainbow. */
  const ROOTS = {C:0,"C#":1,Db:1,D:2,"D#":3,Eb:3,E:4,F:5,"F#":6,Gb:6,G:7,
                 "G#":8,Ab:8,A:9,"A#":10,Bb:10,B:11};
  const rm = name.match(/^([A-G][#b]?)/);
  const root = rm ? (ROOTS[rm[1]] ?? 0) : 0;
  return { i: Math.floor(barOf(t) / HOLD.colour), root, shift: (root / 12 - 0.5) * 30,
           minor: /m(?!aj)/.test(name.replace(/^[A-G][#b]?/, "")), at: blockStart(t, HOLD.colour) };
}

/* the starts of parts, and the drops: where white earns its place */
const BIGT = (function(){
  const out = CH.map(c => c[0]);
  for(const m of MO) if(m.kind === "drop" || m.kind === "stop") out.push(m.at);
  return out.sort((a,b) => a-b) })();
function bigMoment(t){
  if(!use(10)) return true;                 // before the chords rung, every bar
  for(const b of BIGT) if(Math.abs(b - t) < 0.25) return true;
  return false;
}

function beatIndex(t){
  let lo=0, hi=BEATS.length-1, k=-1;
  while(lo<=hi){ const mi=(lo+hi)>>1; if(BEATS[mi]<=t){ k=mi; lo=mi+1 } else hi=mi-1 }
  return k;
}

function frame(t){
  const k  = beatIndex(t);
  const bt = k < 0 ? -99 : BEATS[k];
  const isDown = k >= 0 && DOWNSET.has(+bt.toFixed(3));
  /* a soloed non-beat rung gets a steady wash, not a decaying flash */
  const env = SOLO_STEADY ? 1 : (k < 0 ? 0 : Math.exp(-(t - bt) / DECAY));

  // ---- rung 1: every beat, flat -------------------------------------------
  let amp = 1;
  // ---- rung 2: the bar ----------------------------------------------------
  if(use(2) && !isDown) amp = OFFBEAT;
  // ---- rung 5: the song gets bigger and smaller ---------------------------
  let size = 1;
  if(use(5)) size = 0.34 + 0.66 * cl(energyAt(t), 0, 1);
  // ---- rung 4: and it breathes with the sidechain -------------------------
  const duck = duckAt(t);

  /* ---- rung 3: WHICH par, not all of them --------------------------------
     The bar walks across the rig, one par per beat, and the downbeat opens all
     five. That is the smallest use of the fact that a rig has positions, and it
     is the reason position has to be in the layout at all. */
  let lit = null;                                    // null = every par
  if(use(3) && k >= 0 && !isDown){
    let d = 0; for(let j=k; j>=0 && !DOWNSET.has(+BEATS[j].toFixed(3)); j--) d++;
    lit = d % NP;
  }
  /* rung 8: the arrangement decides how much of the row is in play at all, and
     the window sits in the middle so a thin arrangement reads as a narrow rig
     rather than a rig with holes in it */
  const w = widthAt(t);
  const half = (NP - w) / 2;
  const inPlay = i => (!use(8)) || (i >= Math.floor(half) && i < Math.floor(half) + w);
  /* rung 9: the tune picks the lamp, replacing the mechanical walk -- that walk
     was the thing Renjith called overdone, and it was: it moved for its own sake */
  const pp = pitchPos(t);
  let spot = null;
  if(pp !== null && !isDown){
    const first = Math.floor(half), last = first + w - 1;
    spot = first + pp * (last - first);            // a place on the row, not a lamp index
    lit = Math.round(spot);
  }

  const F = [];
  PARS.forEach((f, i) => {
    /* The bed is the WASH: every par carries it, because a compressor acts on the
       whole mix and not on whichever fixture the chase happens to be pointing at.
       Lighting the bed only on the selected par left four of five dark and the
       breathing had nowhere to show. The chase and the flash ride on top of it. */
    const on = (lit === null || lit === i) && inPlay(i);
    const bed = (use(4) && PUMPING) ? BED : (SOLO_STEADY ? 0.5 : 0);
    /* a soft spot rather than one lamp snapping on: the neighbours catch some of
       it, so the tune reads as movement along the row instead of a lamp race */
    let share = on ? 1 : 0;
    if(spot !== null && inPlay(i)){
      const d2 = Math.abs(i - spot);
      share = Math.max(share, d2 < 1.6 ? Math.pow(1 - d2/1.6, 1.6) : 0);
    }
    /* the wash respects the arrangement too. It did not, so a lamp that rung 8 had
       taken out of play still sat at bed level -- every lamp lit all the time, and
       soloing the instruments rung showed it at once. */
    const bedHere = inPlay(i) ? bed : 0;
    let lv = (bedHere + (1 - bedHere) * share * amp * env) * size * duck;
    if(!use(4) && !SOLO_STEADY) lv = share * amp * env * size;
    lv *= E.lvl;
    let col = WHITE;
    // ---- rung 5: colour ---------------------------------------------------
    if(use(6)){
      /* rung 10: the harmony decides which colour leads and when it changes. Before
         that rung the two colours simply alternate along the row, which looks fine
         and means nothing. */
      const ch = chordState(t);
      /* Once the tune decides WHICH lamp is lit, colour can no longer depend on
         which lamp it is: alternating a and b along the row meant the colour
         flickered every time the melody moved, so colour was reporting position
         rather than harmony. From rung 10 the whole rig shares one colour at a
         time and the chord is the only thing that changes it. Below that rung the
         alternation stays, because there nothing else is using the row. */
      const ch2 = chordState(t);
      const c = ch2 ? (ch2.i % 2 === 0 ? PAL.a : PAL.b)
                    : ((i % 2 === 0) ? PAL.a : PAL.b);
      const e = energyAt(t);
      let li = cl(c[2] * (0.84 + 0.28*e), 0, 1);
      let hu = c[0];
      if(ch){ hu += ch.shift; if(ch.minor) li *= 0.78 }   // a minor chord sits darker
      /* White was landing on every bar start, which is both heavy-handed and, once
         the chords rung arrived, actively hiding it: chord changes fall on bar
         starts too, so the one moment the colour moved was the one moment the rig
         went white. White is kept for the starts of PARTS of the song now -- an
         accent worth having rather than a tick every two seconds. */
      col = (isDown && bigMoment(t)) ? WHITE : hsl(hu, cl(c[1]*(0.86+0.20*e),0,1), li);
    }
    F.push({ id:f.id, level:+cl(lv,0,1).toFixed(4), r:col[0], g:col[1], b:col[2] });
  });

  // ---- rung 6: the hits between the beats ---------------------------------
  if(use(7) && OFFGRID.length){
    let lo=0, hi=OFFGRID.length-1, j=-1;
    while(lo<=hi){ const mi=(lo+hi)>>1; if(OFFGRID[mi].at<=t){ j=mi; lo=mi+1 } else hi=mi-1 }
    if(j >= 0){
      const a = OFFGRID[j], ae = Math.exp(-(t - a.at) / (DECAY * 0.55));
      const add = 0.55 * ae * cl(a.strength / 0.45, 0, 1) * (STEP >= 5 ? (0.34+0.66*energyAt(t)) : 1);
      if(add > 0.004){
        const p = Math.abs(Math.round(a.at * 1000)) % NP;   // deterministic, not random
        F[p].level = +cl(F[p].level + add, 0, 1).toFixed(4);
      }
    }
  }

  // ---- rung 7: the heads --------------------------------------------------
  if(use(11)){
    const e = energyAt(t), sweep = Math.sin(2*Math.PI * t / (BAR*2));
    HEADS.forEach((f, i) => {
      const s = i === 0 ? sweep : -sweep;
      F.push({ id:f.id, level:+cl((0.30+0.55*e) * (0.55+0.45*env), 0, 1).toFixed(4),
               pan:+(0.5 + 0.34*s).toFixed(4), tilt:+(0.42 + 0.16*s*e).toFixed(4),
               r:PAL.b ? hsl(PAL.b[0],0.86,0.48)[0] : 255,
               g:hsl(PAL.b[0],0.86,0.48)[1], b:hsl(PAL.b[0],0.86,0.48)[2] });
    });
  }

  return { t:+t.toFixed(3), look: SOLO ? "solo"+SOLO : "step"+STEP,
           step: STEP, solo: SOLO || undefined, fixtures:F };
}
