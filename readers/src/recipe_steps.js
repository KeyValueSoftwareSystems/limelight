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

const STEP = (function(){ try { return Math.max(1, Math.min(15, +LADDER || 1)) } catch(e) { return 1 } })();

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
const NEEDS = { 12: [8] };            // chords are expressed as colour
const use  = n => SOLO ? (n === SOLO || (NEEDS[SOLO] || []).indexOf(n) >= 0)
                       : (STEP >= n);
const BEATY = { 1:1, 2:1, 3:1, 7:1, 9:1 };
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
/* Real white is never 255,255,255. A tungsten-ish par sits near 3200K and reads
   warm; an LED strobe is a cold 6500K and reads blue-white. Using one white for
   both is most of why a rig renders as a computer graphic. */
const WHITE    = [255, 238, 214];        // par white, warm
const COLDW    = [232, 241, 255];        // strobe and blinder white, cold
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
  /* Named after the gels these actually are. Saturated primaries are what a screen
     does, not what a lamp does: a real deep blue is congo, a real stage red sits
     nearer magenta than primary, and that difference is most of why one render
     looks like lighting and the other looks like a chart. */
  gel:        { a:[214,.94,.40], b:[344,.86,.46] },   // congo blue, deep magenta-red
  gel_amber:  { a:[ 32,.80,.52], b:[196,.88,.42] },   // straw amber, steel blue
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
const lerp=(a,b,w)=>a+(b-a)*w;
const ss=(a,b,x)=>{ const t=cl((x-a)/((b-a)||1),0,1); return t*t*(3-2*t) };
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
  if(!use(9)) return [];
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
  if(!use(10) || !INSTR || !INSTR.density_per_bar || !INSTR.density_per_bar.length) return NP;
  const D = INSTR.density_per_bar, t0 = blockStart(t, HOLD.width);
  let sum = 0, n = 0;
  for(const [at, d] of D){ if(at >= t0 - PHRASE*BAR && at < t0 + HOLD.width*BAR){ sum += d; n++ } }
  if(!n){ const k = lastAtOrBefore(D, t, x => x[0]); sum = k<0?D[0][1]:D[k][1]; n = 1 }
  const d = sum / n;
  /* Sized as a FRACTION of the rig, not as a count. Three lamps is most of a
     five-par bar and a quarter of a twelve-par one, so the same number left nine
     of twelve dark and the rig read as broken rather than restrained. */
  const floor = d < 0.12 ? Math.max(1, Math.round(NP * 0.14))
                         : Math.max(3, Math.round(NP * 0.45));
  return Math.max(floor, Math.min(NP, Math.round(1 + d * (NP - 1) * E.spread)));
}
/* rung 9: where along the row, from the pitch of the tune -- as the average of a
   phrase, moving at most once a bar. Following note to note put the lit lamp
   somewhere new eight times a second, which is the single worst thing in this
   file and the reason the melody rung looked terrible. */
function pitchPos(t){
  if(!use(11) || !MELRANGE || !MELN.length) return null;
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
  if(!use(12) || !CHORDS.length) return null;
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
  if(!use(12)) return true;                 // before the chords rung, every bar
  for(const b of BIGT) if(Math.abs(b - t) < 0.25) return true;
  return false;
}

function beatIndex(t){
  let lo=0, hi=BEATS.length-1, k=-1;
  while(lo<=hi){ const mi=(lo+hi)>>1; if(BEATS[mi]<=t){ k=mi; lo=mi+1 } else hi=mi-1 }
  return k;
}

/* ---- one thing leads ------------------------------------------------------
   Slowing each element down was necessary and not sufficient. With every rung on
   there are ten gestures running at once, and ten slow gestures is still chaos:
   the room cannot tell which of them to watch, so it watches none of them. That
   is what Renjith means by overdoing the melody -- not that the melody is wrong,
   but that it is competing.

   A designer decides, moment by moment, what the audience is meant to be looking
   at, and everything not carrying that idea recedes. The music picks the lead: a
   drop wants the pulse, a quiet vocal section wants the tune, a build wants the
   rise. Nothing is switched off, only pulled back -- a rig where elements vanish
   looks broken rather than restrained. */
/* ---- rungs 6 and 7: the two gestures that make a room feel designed ---------
   Everything below these rungs REACTS to the song. A club show does something
   else as well: it sets up a moment and then pays it off, and the pay-off is
   mostly made of the darkness before it. A drop with no blackout in front of it
   is just a loud bar.

   The build ramps. Not brightness alone -- the rig tightens as it rises, because
   a build that only gets brighter has nowhere left to go at the top.

   The drop is three things in order: the rig falls away over the last bar, cuts
   to near black for a beat, then everything opens white. The map already carries
   the drop instants and the build spans; nothing here is invented. */
function buildAt(t){
  if(!use(6)) return null;
  for(const sp of SP){
    if(sp.kind !== "build" || t < sp.from || t >= sp.to) continue;
    const x = (t - sp.from) / Math.max(0.001, sp.to - sp.from);
    // the map says HOW it rises; a late build holds back and then goes
    const shape = sp.rise === "late"  ? Math.pow(x, 2.0)
                : sp.rise === "early" ? Math.pow(x, 0.55)
                : x;
    return { x, shape, len: sp.to - sp.from, from: sp.from, to: sp.to };
  }
  return null;
}
const DROPS = MO.filter(m => m.kind === "drop").map(m => m.at).sort((a,b) => a-b);
function dropAt(t){
  if(!use(7) || !DROPS.length) return null;
  for(const d of DROPS){
    const dt = t - d;
    if(dt >= -BAR && dt < BAR * 2){
      return { dt, bar: BAR,
               /* the last bar falls AWAY: full a bar out, near black on the
                  instant. Written the other way round first, which darkened a bar
                  early and then brightened into the drop -- the exact opposite of
                  the gesture, and it reads as a mistake rather than as tension. */
               pre:  dt < 0 ? Math.max(0, Math.min(1, -dt / BAR)) : null,
               hit:  dt >= 0 && dt < 0.28,
               after: dt >= 0 ? Math.min(1, dt / (BAR * 2)) : null };
    }
  }
  return null;
}

/* ---- rung 15: the rig takes sides ----------------------------------------
   Every fixture has been reading the same signal, so the whole rig moves as one
   animal and the show repeats itself. That is not what a designer does. They give
   each group of lamps a JOB, and the jobs are different: the front truss takes the
   beat, one side of the stage takes the low end, the other takes the voice, and
   the heads over the deck take whatever is carrying the tune. Then the rig stops
   being one gesture and becomes four having a conversation.

   The map already knows how loud each instrument is in every bar, so none of this
   is invented -- the left ladders genuinely pulse with the bass because the bass
   is genuinely there. Which is also why it stops repeating: verse two has a
   different arrangement from verse one, so the rig behaves differently in it
   without anybody writing a second cue. */
const STEMS_AVAIL = Object.keys((INSTR && INSTR.parts) || {});
const pickStem = prefs => prefs.find(p => STEMS_AVAIL.indexOf(p) >= 0) || STEMS_AVAIL[0] || null;
const VOICE = {
  beat:  pickStem(["drums"]),
  low:   pickStem(["bass"]),
  lead:  pickStem(["other", "guitar", "piano"]),
  voice: pickStem(["vocals", "piano", "guitar"]),
};
function stemAt(name, t){
  if(!name || !INSTR || !INSTR.parts[name]) return 1;
  const v = INSTR.parts[name].level_per_bar, D = INSTR.density_per_bar || [];
  if(!v || !v.length || !D.length) return 1;
  const k = lastAtOrBefore(D, t, x => x[0]);
  const i = Math.max(0, Math.min(v.length - 1, k < 0 ? 0 : k));
  return cl(v[i], 0, 1);
}
/* which job each fixture has, decided once from where it is on the stage */
const MIDX = (function(){
  const xs = LAYOUT.fixtures.map(f => (f.at||[0])[0]);
  return (Math.min(...xs) + Math.max(...xs)) / 2 })();
const BACKZ = (function(){
  const zs = LAYOUT.fixtures.filter(f => f.kind === "head").map(f => (f.at||[0,0,0])[2]);
  return zs.length ? (Math.min(...zs) + Math.max(...zs)) / 2 : 0 })();
function jobOf(f){
  if(f.kind === "par") return "beat";
  if(f.kind !== "head") return null;
  if((f.at||[0,0,0])[2] < BACKZ) return "lead";            // over the deck
  return (f.at[0] < MIDX) ? "low" : "voice";               // the two sides
}
/* and how much of the rig is in play, by how far into the song this part is.
   A show that gives you everything in verse one has nowhere to go. */
function sectionReach(t){
  const S = MAP.sections || [];
  if(!S.length) return 3;
  let cur = null;
  for(const e of S){ if(e.at <= t) cur = e; else break }
  if(!cur) return 3;
  const rep = cur.repeat || 1;
  if(/intro|outro/.test(cur.name)) return 1;
  if(/drop|build/.test(cur.name))  return 3;
  return Math.min(3, rep);                                  // verse 1 thin, verse 3 full
}
const JOB_RANK = { beat:1, lead:1, low:2, voice:3 };
function sideGain(f, t){
  if(!use(15)) return 1;
  const job = jobOf(f);
  if(!job) return 1;
  if(JOB_RANK[job] > sectionReach(t)) return 0.18;          // present, but held back
  return 0.30 + 0.85 * stemAt(VOICE[job], t);
}

function leadAt(t){
  const e = energyAt(t);
  for(const sp of SP) if(sp.kind === "build" && sp.from <= t && t < sp.to) return "rise";
  if(e >= 0.62) return "beat";
  if(MELRANGE && e < 0.45 && pitchPos(t) !== null) return "melody";
  return "wash";
}
const RECEDE = {
  beat:   { flash:1.00, spot:0.30, colour:0.85 },
  melody: { flash:0.45, spot:1.00, colour:0.90 },
  rise:   { flash:0.75, spot:0.45, colour:0.80 },
  wash:   { flash:0.55, spot:0.70, colour:1.00 },
};

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
    /* the chase steps in groups on a big rig, so a bar still crosses the whole
       row in four beats rather than creeping one lamp at a time */
    let d = 0; for(let j=k; j>=0 && !DOWNSET.has(+BEATS[j].toFixed(3)); j--) d++;
    lit = Math.round((d % 4) / 3 * (NP - 1));
  }
  /* rung 8: the arrangement decides how much of the row is in play at all, and
     the window sits in the middle so a thin arrangement reads as a narrow rig
     rather than a rig with holes in it */
  const LEAD = use(13) ? RECEDE[leadAt(t)] : {flash:1, spot:1, colour:1};
  const w = widthAt(t);
  const half = (NP - w) / 2;
  const inPlay = i => (!use(10)) || (i >= Math.floor(half) && i < Math.floor(half) + w);
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
      /* the spot is a fraction of the row too: 1.6 lamps is a third of five and a
         seventh of twelve, so on a big rig the tune lit a dot instead of a shape */
      const SW = Math.max(1.6, NP / 5 * 1.6);
      const d2 = Math.abs(i - spot);
      share = Math.max(share, (d2 < SW ? Math.pow(1 - d2/SW, 1.6) : 0) * LEAD.spot);
    }
    /* the wash respects the arrangement too. It did not, so a lamp that rung 8 had
       taken out of play still sat at bed level -- every lamp lit all the time, and
       soloing the instruments rung showed it at once. */
    const bedHere = inPlay(i) ? bed : 0;
    let lv = (bedHere + (1 - bedHere) * share * amp * env * LEAD.flash) * size * duck * sideGain(f, t);
    const B = buildAt(t);
    if(B){ lv *= 0.55 + 0.75 * B.shape;                     // it climbs
           if(B.shape > 0.72 && (i === 0 || i === PARS.length-1)) lv *= 0.4 }  // and tightens
    const D = dropAt(t);
    if(D){
      if(D.pre !== null) lv *= Math.max(0.06, Math.pow(D.pre, 1.8));  // fall away, then black
      else if(D.hit)     lv = 1;                                      // everything, white
      else               lv *= 0.85 + 0.35 * D.after;                 // and come back bigger
    }
    if(!use(4) && !SOLO_STEADY) lv = share * amp * env * size;
    lv *= E.lvl;
    let col = WHITE;
    // ---- rung 5: colour ---------------------------------------------------
    if(use(8)){
      /* rung 12: the harmony decides which colour leads and when it changes. Before
         that rung the two colours simply alternate along the row, which looks fine
         and means nothing. */
      const ch = chordState(t);
      /* Once the tune decides WHICH lamp is lit, colour can no longer depend on
         which lamp it is: alternating a and b along the row meant the colour
         flickered every time the melody moved, so colour was reporting position
         rather than harmony. From rung 10 the whole rig shares one colour at a
         time and the chord is the only thing that changes it. Below that rung the
         alternation stays, because there nothing else is using the row. */
      /* The colour language from the reference photographs, which is not one
         palette applied to everything. On that stage the par row is a WARM WHITE
         wash -- amber, almost tungsten -- the moving heads are the saturated
         colour, cyan and magenta cutting through the haze, and the strobes are
         cold white. Painting all three from the same two hues is most of why this
         rendered as a chart rather than as a show. Pars stay warm and only take
         the palette when the song is quiet enough for colour to be the event. */
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
      const warmth = cl(1 - energyAt(t) * 1.15, 0, 1);      // quiet songs get colour
      col = (isDown && bigMoment(t)) || (dropAt(t) && dropAt(t).hit) ? WHITE : hsl(hu, cl(c[1]*(0.86+0.20*e)*(0.30+0.70*warmth), 0, 1),
                     cl(li*(1 + 0.30*(1-warmth)), 0, 1));
    }
    F.push({ id:f.id, level:+cl(lv,0,1).toFixed(4), r:col[0], g:col[1], b:col[2] });
  });

  // ---- rung 6: the hits between the beats ---------------------------------
  if(use(9) && OFFGRID.length){
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
  // ---- rung 14: the heads ------------------------------------------------
  if(use(14)){
    /* They were sweeping one cycle every two bars, which is a head taking nearly
       four seconds to get anywhere -- slow enough to read as a fault. A moving
       head is fast; the thing that makes it look alive is short throws taken
       quickly, not long ones taken slowly, and both cost the same motor.

       So the frequency rises with the song and the AMPLITUDE is derived from the
       motor budget rather than merely permitted by it: peak angular speed is
       amplitude * 2*pi*frequency, so solving for amplitude at the budget means
       the heads always move as fast as the fixture allows and can never be asked
       to do more. Raise max_pan_per_s in the layout and they swing wider; lower
       it and they tighten. The recipe never has to know what a real motor does. */
    const e = energyAt(t);
    const LIMP = (LAYOUT.limits && LAYOUT.limits.max_pan_per_s) || 1.55;
    const LIMT = (LAYOUT.limits && LAYOUT.limits.max_tilt_per_s) || 1.7;
    /* The frequency is FIXED, and that is not a style choice. Writing it as
       sin(2*pi*f(t)*t) with f rising on energy jumps the phase every time energy
       steps -- the head teleports, and the motor check reported 1782% of budget
       for motion that looked smooth on a graph. A pure function has no phase to
       accumulate, so the honest fix is a constant rate and let energy drive how
       BRIGHT the heads are rather than how fast they move.
       One sweep per bar, with the amplitude solved from the motor budget. */
    const HF  = 1.0 / BAR;
    const APAN = Math.min(0.36, (LIMP * 0.70) / (2 * Math.PI * HF));
    const ATIL = Math.min(0.20, (LIMT * 0.55) / (2 * Math.PI * HF * 0.5));
    const D2 = dropAt(t);
    const nh = Math.max(1, HEADS.length);
    HEADS.forEach((f, i) => {
      // fanned, and every other one mirrored, so the rig crosses rather than herds
      const ph = (i / nh) * Math.PI * 2, dir = (i % 2 === 0) ? 1 : -1;
      let pan  = 0.5 + dir * APAN * Math.sin(2*Math.PI*HF*t + ph);
      let tilt = 0.44 + ATIL * Math.sin(Math.PI*HF*t + ph*0.5);
      /* On the drop they stop chasing and open into a fixed fan -- the oldest
         trick there is and still the one that reads from the back of a room.

         But a head cannot teleport. Snapping to the fan on the instant asked for
         1344% of the motor budget, because a jump is not a move. The travel
         happens during the bar of darkness BEFORE the drop instead, which is what
         a real designer does for exactly this reason: reposition while nobody can
         see you, and arrive already pointing where the moment needs you. */
      const fanPan = 0.5 + ((i / (nh - 1 || 1)) - 0.5) * 0.62, fanTilt = 0.30;
      if(D2){
        // pre runs 1 a bar out to 0 on the instant, so this is the approach
        const w = D2.pre !== null ? ss(0, 1, 1 - D2.pre)
                : D2.dt < BAR     ? 1
                : ss(0, 1, 1 - (D2.dt - BAR) / BAR);      // and drift back after
        pan  = lerp(pan,  fanPan,  w);
        tilt = lerp(tilt, fanTilt, w);
      }
      /* the heads carry the saturated colour, and the two sides of the stage take
         opposite ends of the pair -- which is the other half of taking sides */
      const side = (f.at && f.at[0] < MIDX) ? PAL.a : PAL.b;
      const col = hsl(side[0], 0.90, 0.52);
      F.push({ id:f.id,
               level:+cl((0.28 + 0.62*e) * (0.5 + 0.5*env) * (D2 && D2.hit ? 1.6 : 1)
                         * sideGain(f, t), 0, 1).toFixed(4),
               pan:+cl(pan,0,1).toFixed(4), tilt:+cl(tilt,0,1).toFixed(4),
               r:col[0], g:col[1], b:col[2] });
    });
  }

  /* ---- LED battens ---------------------------------------------------------
     The vertical strips up the towers and the bar across the wall are not lamps;
     they are edges. They trace the architecture, so they take the harmony colour
     and move slowly -- a batten flickering on the beat turns the stage frame into
     a fairground. They rise with the build and go white on the drop like the wall. */
  for(const f of LAYOUT.fixtures){
    if(f.kind !== "strip") continue;
    const e = energyAt(t), Db = dropAt(t), Bb = buildAt(t), ch3 = chordState(t);
    let lv = 0.16 + 0.50 * e;
    if(Bb) lv *= 0.5 + 0.9 * Bb.shape;
    if(Db){ if(Db.pre !== null) lv *= Math.max(0.06, Db.pre); else if(Db.hit) lv = 1 }
    const cc = (Db && Db.hit) ? COLDW
             : hsl(PAL.b[0] + (ch3 ? ch3.shift : 0), 0.92, 0.52);
    F.push({ id:f.id, level:+cl(lv,0,1).toFixed(4), r:cc[0], g:cc[1], b:cc[2] });
  }

  /* ---- CO2 ------------------------------------------------------------------
     One gesture, one moment. A jet on anything but a drop is a jet nobody looks
     at, and the layout caps the burst because a real one empties a cylinder. */
  const CO2MAX = (LAYOUT.limits && LAYOUT.limits.co2_max_burst_s) || 1.2;
  for(const f of LAYOUT.fixtures){
    if(f.kind !== "co2") continue;
    const Dc = dropAt(t);
    let lv = 0;
    if(Dc && Dc.dt >= 0 && Dc.dt < CO2MAX) lv = 1 - Dc.dt / CO2MAX;
    F.push({ id:f.id, level:+cl(lv,0,1).toFixed(4), r:255, g:255, b:255 });
  }

  /* ---- strobes: the impact fixture, and the only one with a real safety limit
     A strobe is not a brighter lamp, it is a different gesture: it removes motion
     from a room for a second and hands it back. Used on anything but an impact it
     is just noise, so these fire on a drop and on the last bar of a build, and
     nowhere else in the song.

     The rate comes from the layout, not from here. Sustained flashing above about
     three hertz is a photosensitivity risk, so on top of the layout's ceiling the
     recipe holds every burst under 1.2 s. Both limits are stated where they can be
     checked rather than buried in a coefficient. */
  const SHZ = Math.min(12, (LAYOUT.limits && LAYOUT.limits.max_strobe_hz) || 4);
  const SBURST = 1.2;
  for(const f of LAYOUT.fixtures){
    if(f.kind !== "strobe") continue;
    let on = 0, since = null;
    const D5 = dropAt(t), B3 = buildAt(t);
    if(D5 && D5.dt >= 0 && D5.dt < SBURST) since = D5.dt;
    /* seconds, not a scaled fraction. Deriving it from B3.x times a constant made
       the flash rate depend on how long the build was, so a long build strobed
       slower than the layout allows and a short one would have strobed faster. */
    else if(B3 && B3.x > 0.90) since = (B3.x - 0.90) * B3.len;   // the last of a build
    if(since !== null && since < SBURST){
      const phase = since * SHZ;
      on = (phase % 1) < 0.42 ? 1 : 0;                          // hard on, hard off
      on *= 1 - since / SBURST;                                 // and it runs out
    }
    F.push({ id:f.id, level:+cl(on,0,1).toFixed(4), r:COLDW[0], g:COLDW[1], b:COLDW[2] });
  }

  /* ---- the LED wall ------------------------------------------------------
     On a festival stage the screen is the biggest light source in the building
     and treating it as scenery wastes it. It carries the chapter colour at the
     song's own level -- a wash you cannot get from any lamp -- and it goes white
     on the drop with everything else. It is deliberately SLOW: the wall states
     where the song is, and the lamps do the rhythm. A screen that flickers with
     the beat is a screen fighting the rig. */
  for(const f of LAYOUT.fixtures){
    if(f.kind !== "screen") continue;
    const e = energyAt(t), D4 = dropAt(t);
    const B2 = buildAt(t);
    let lv = 0.10 + 0.45 * e;
    if(B2) lv *= 0.55 + 0.85 * B2.shape;
    if(D4){
      if(D4.pre !== null) lv *= Math.max(0.05, D4.pre);
      else if(D4.hit)     lv = 1;
    }
    const ch = chordState(t);
    const base = PAL.a;
    const col = (D4 && D4.hit) ? WHITE
              : hsl(base[0] + (ch ? ch.shift : 0), cl(base[1]*0.9,0,1), cl(base[2]*0.85,0,1));
    F.push({ id:f.id, level:+cl(lv,0,1).toFixed(4), r:col[0], g:col[1], b:col[2] });
  }

  // ---- blinders: they exist for one moment in a song, and it is the drop ----
  for(const f of LAYOUT.fixtures){
    if(f.kind !== "blinder") continue;
    const D3 = dropAt(t);
    let lv = 0;
    if(D3){
      if(D3.hit) lv = 1;
      else if(D3.dt > 0 && D3.dt < BAR * 0.5) lv = Math.max(0, 1 - D3.dt / (BAR*0.5)) * 0.55;
    }
    F.push({ id:f.id, level:+lv.toFixed(4), r:COLDW[0], g:COLDW[1], b:COLDW[2] });
  }

  return { t:+t.toFixed(3), look: SOLO ? "solo"+SOLO : "step"+STEP,
           step: STEP, solo: SOLO || undefined, fixtures:F };
}
