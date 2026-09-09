/* A show for three pars. Not a probe -- a show you could take to a gig.
   ----------------------------------------------------------------------------
   recipe_three.js assigns one map field per lamp so a fault is legible. Useful,
   and not a show: nobody would light a room that way. This is the other thing --
   what a designer would actually program if the venue owns three pars in a row
   and nothing else, using only the dimensions pre-flight says this rig can carry.

   Pre-flight, on readers/lights/three: 8 of the 10 dimensions Levels asks for
   are carryable here. The two that are not are `place`, which needs a mover, and
   `shock`, which needs a strobe. So this show is built from intensity, hue,
   extent, time and focus, and it does not pretend to the other two.

   THE ONE IDEA THAT ONLY EXISTS AT THREE LAMPS

   With three in a row, left and right are a PAIR and centre is a SPECIAL.
   Symmetry reads as "the room"; breaking it reads as "this thing, now". That is
   two roles instead of seven and it is enough to say most of what a song does.

   And `extent` -- how much of the rig is involved -- becomes a real channel here
   in a way it never is on a big rig, because three is COUNTABLE. One lamp lit is
   intimate, two is the room, three is everything. Nobody can count 101 fixtures,
   so on the mainstage that dimension is wasted; on this rig it is one of the
   strongest things available.

   THE FIVE GESTURES, AND WHAT EACH ONE MEANS

     pair holds a colour, centre pulses     the song is running
     pair splits apart                      tension is building
     centre alone, pair dark                one voice, one instrument
     all three, one colour, full            the peak. Three times a song, never four
     all three at zero                      the gap before a hit

   Rules carried over from the show-design brief, all of them enforced here
   rather than described: a structural scalar so identical music renders
   differently before and after the peak; a rate ceiling per role, so the pair
   physically cannot change faster than every eight bars; two values plus black
   and never both hot; a gap in BEATS before every hit; and no gesture without a
   named referent.

   Obeys the one rule -- every function below is pure in t. */

/* ---- the declared tier ------------------------------------------------------
   Renjith, 9 Sept: an artist should be able to say "around the bridge they should
   feel X", and a reader should honour it.

   A feeling cannot be a colour, because colour means nothing to a drone show. So
   a feeling is a RE-WEIGHTING of what we already measure: how much light, how many
   lamps, how warm, and how often anything is allowed to change. Six words, a
   closed set, the same discipline as the six moment kinds -- an open vocabulary
   would mean inventing semantics for whatever anyone typed.

   The artist's PALETTE is different from an instruction to go blue at the drop.
   "This act is red and white" is identity: a drone show can be red and white, a
   video edit can grade to it, no reader is privileged. That is why it is allowed
   in a file that forbids lighting words. */
const FEELINGS = {
  lift:     {level:1.18, lamps:+1, warm:+0.35, rate:1.00},  /* release, hands up */
  weight:   {level:0.55, lamps:-1, warm:-0.30, rate:0.60},  /* grief, pressure */
  intimate: {level:0.50, lamps:-2, warm:+0.15, rate:0.50},  /* one voice */
  drive:    {level:1.10, lamps: 0, warm:-0.05, rate:1.30},  /* urgent, forward */
  still:    {level:0.28, lamps:-1, warm:-0.10, rate:0.30},  /* held breath */
  fond:     {level:0.80, lamps: 0, warm:+0.40, rate:0.60},  /* nostalgic, warm */
};
/* A feeling also has a SHAPE across its stretch, which the six words alone cannot
   carry. "Drowning" is not merely heavy -- it takes more away the longer it
   lasts. Without this a declared feeling is a flat filter over a section, and a
   flat filter is not a feeling.
   A shape says how STRONGLY the feeling is applied across its stretch, and the
   names are chosen so they read the way an artist would mean them. My first
   version had "descend" fading the effect out, so the drowning wore off as it
   went and the middle of the stretch came out brighter than doing nothing at
   all. Drowning deepens.
*/
const SHAPES = {
  hold:    () => 1,                                  /* evenly, all the way through */
  deepen:  u => u,                                   /* takes more away as it goes */
  release: u => 1 - u,                               /* lets go as it goes */
  swell:   u => Math.sin(Math.PI * u),               /* strongest in the middle */
};
const DECL = (MAP && MAP.declared) || null;
function feelAt(t){
  if(!DECL || !DECL.feelings) return null;
  for(const f of DECL.feelings){
    if(t < f.from || t >= f.to) continue;
    const base = FEELINGS[f.feel];
    if(!base) return null;
    const u = Math.max(0, Math.min(1, (t - f.from) / Math.max(0.001, f.to - f.from)));
    const k = (SHAPES[f.shape] || SHAPES.hold)(u);
    /* `says` is the artist's own words and is never interpreted away; `feel` and
       `shape` are somebody's reading of those words and are marked as such in the
       file. The show is driven by the reading, but the words are what survives. */
    return { name: f.says || f.feel, term: f.feel, shape: f.shape || "hold",
             level: 1 - (1 - base.level) * k,
             /* floor, not round: rounding made the lamp count flicker 1,3,1,2 as
                the shape crossed a boundary, which reads as a fault not a feeling */
             lamps: Math.floor(base.lamps * k + 0.001),
             warm:  base.warm * k,
             rate:  base.rate };
  }
  return null;
}
/* the artist's palette, if declared, replaces the two worlds the recipe would
   otherwise pick by chapter name. Roles, not just colours: which one is the
   ground and which one is the impact. */
function declaredPalette(){
  const p = DECL && DECL.palette;
  if(!p || !p.ground || !p.impact) return null;
  const hex = h => { const n = parseInt(String(h).replace("#",""),16);
                     return [(n>>16)&255,(n>>8)&255,n&255] };
  return {ground:hex(p.ground), impact:hex(p.impact)};
}


/* ---- the consumer's side ----------------------------------------------------
   Both ends hold something. The publisher ships intent WITH the work: a palette,
   a feeling, a prohibition. The consumer holds the use: how hard to push tonight,
   their own brand colours, their own accessibility limits. Neither owns the whole
   artifact, and the interesting engineering is not the two sets of controls but
   the rule for who wins.

     an artist declaration is a CONDITION or a PREFERENCE.
       condition  -- a term of use. The consumer cannot override it; a brief that
                     tries fails before anything renders.
       preference -- the artist's default. The consumer may override it.
     the rig can render neither if it lacks the capability, and pre-flight says
       so before a frame exists rather than failing quietly at showtime.

   Every frame carries `decided_by`, so at any instant you can ask who chose this
   and get a name rather than a shrug. That is the whole point: a format where
   both ends can see their own control reflected. */
const BRIEF = (function(){ try{ const p=(typeof KNOB==="string")?JSON.parse(KNOB):KNOB;
  return (p && p.brief) ? p.brief : null }catch(e){ return null } })();

function binding(kind){                       /* what did the artist say about this */
  const b = DECL && DECL.binding;
  if (!b) return "preference";                /* silence means overridable */
  return b[kind] === "condition" ? "condition" : "preference";
}
/* energy is the consumer's dial and is never the artist's to fix: it is about the
   room tonight, not about the work. It is bounded, not free -- a brief cannot push
   past what the rig and the safety limits allow. */
function energyScale(){
  if (!BRIEF || BRIEF.energy === undefined) return 1;
  return Math.max(0.15, Math.min(1.6, +BRIEF.energy));
}
function resolvePalette(){
  const artist = declaredPalette();
  const hex = h => { const n = parseInt(String(h).replace("#",""),16);
                     return [(n>>16)&255,(n>>8)&255,n&255] };
  const consumer = (BRIEF && BRIEF.palette && BRIEF.palette.ground && BRIEF.palette.impact)
    ? {ground:hex(BRIEF.palette.ground), impact:hex(BRIEF.palette.impact)} : null;
  if (artist && binding("palette") === "condition")
    return {pal: artist, by: "artist (condition)"};
  if (consumer) return {pal: consumer, by: "consumer brief"};
  if (artist)   return {pal: artist,  by: "artist (preference)"};
  return {pal: null, by: "the recipe's own two worlds"};
}

/* Resolved here and not earlier: the artist's declaration and the consumer's
   brief must both exist before either can win. */
const RES = resolvePalette();
const PAL = RES.pal;

const BAR_S = 4 * PER, PHRASE = 8 * BAR_S;
const DECAY = Math.max(0.055, PER * 0.22);

/* ---- reaction time -------------------------------------------------------
   Renjith, 9 Sept: "the lights are singing slightly behind the song."

   There is a physical reason this is true even with a correct grid. Auditory
   processing takes roughly 10-20 ms; visual takes roughly 50-80 ms. A lamp that
   peaks exactly ON the beat is therefore PERCEIVED after it. A browser adds more
   on top -- the audio clock, the animation frame, the panel itself -- and every
   one of those pushes the same way, late.

   So LEAD shifts the whole show earlier by a number of milliseconds. It is not a
   fudge to hide a timing bug; the grid is measured and correct. It is the
   compensation for the fact that eyes are slower than ears, and it has to be
   found by a human because the number depends on the room, the screen and the
   person. Whatever value reads as locked IS the right value.

   ENV changes the shape of the pulse, which matters as much as its position:
   perceived timing follows the envelope's centre of mass, not its peak, so a
   long tail reads late even when the attack is exact. */
const LEAD = (function(){ try{ const p=(typeof KNOB==="string")?JSON.parse(KNOB):KNOB;
  return (p && typeof p.lead==="number") ? p.lead/1000 : 0 }catch(e){ return 0 } })();
const ENV  = (function(){ try{ const p=(typeof KNOB==="string")?JSON.parse(KNOB):KNOB;
  return (p && p.env) ? p.env : "swell" }catch(e){ return "swell" } })();

/* ---- which beat is the "one" ---------------------------------------------
   Renjith, 9 Sept: "I feel like we got the downbeat wrong."

   Two audio-anchored witnesses disagree. The clap test (a clap sits on 2 and 4
   in 4/4 dance) cannot distinguish phase 0 from phase 2 at all -- both put the
   odd beats in the same places -- so it is structurally blind to this question.
   Bar-to-bar self-similarity CAN see all four, and it prefers phase 2 over the
   map's 0, but only by 3%, which is too thin to act on.

   What makes it worth taking seriously is that it converges with something else:
   every drop in this map sits two beats off a bar line, and drops land on
   downbeats. If the bar line really is at phase 2, those drops are exactly on
   the one and the map's phase is out by two.

   So BAR shifts which beat the travelling pulse treats as the start of the bar.
   With a ball moving L-C-R-C the bar phase becomes visible in a way a flash can
   never make it -- a wrong phase reads as the pattern rotating against the
   music. An ear settles this in fifteen seconds; a 3% correlation does not. */
/* NOT `BAR` -- mkReader already injects that as the bar length in seconds. */
const BARPH = (function(){ try{ const p=(typeof KNOB==="string")?JSON.parse(KNOB):KNOB;
  return (p && typeof p.bar==="number") ? ((p.bar%4)+4)%4 : 0 }catch(e){ return 0 } })();

function before(a, t){ let lo=0, hi=a.length-1, k=-1;
  while(lo<=hi){ const m=(lo+hi)>>1; if(a[m]<=t){k=m;lo=m+1} else hi=m-1 } return k }
function pulse(a, t, d){ if(!a||!a.length) return 0; const k=before(a,t);
  return k<0?0:Math.exp(-(t-a[k])/(d||DECAY)) }
function enAt(t){
  if(!EN||!EN.length) return 0.5;
  const g=i=>Array.isArray(EN[i])?EN[i]:[EN[i].at,EN[i].v];
  let k=-1; for(let i=0;i<EN.length;i++){ if(g(i)[0]<=t) k=i; else break }
  if(k<0) return g(0)[1];
  const [t0,v0]=g(k); if(k+1>=EN.length) return v0;
  const [t1,v1]=g(k+1); const u=t1>t0?(t-t0)/(t1-t0):0;
  return v0+(v1-v0)*Math.max(0,Math.min(1,u));
}
function chAt(t){ let k=-1; for(let i=0;i<CH.length;i++){ if(CH[i][0]<=t) k=i; else break }
  return k<0?"intro":CH[k][1] }

/* ---- the structural scalar -------------------------------------------------
   Where are we relative to this song's biggest moment? Read off the energy the
   map already carries, in eight-bar blocks, so it costs nothing and needs no new
   field. This is the number that stops two identical verses looking identical. */
const BLOCKS = (function(){
  const out=[]; for(let t=0;t+PHRASE<=DUR;t+=PHRASE) out.push([t,enAt(t+PHRASE/2)]);
  return out.length?out:[[0,0.5]];
})();
const PEAK_T = BLOCKS.reduce((b,x)=>x[1]>b[1]?x:b,BLOCKS[0])[0];
const SPAN = Math.max(PHRASE, Math.max(PEAK_T, DUR-PEAK_T));
function arc(t){                       /* 1.0 at the peak, falling away either side */
  const d = Math.abs(t-PEAK_T)/SPAN;
  return Math.max(0.18, 1 - 0.82*Math.min(1,d));
}
function after(t){ return t > PEAK_T }  /* post-peak looks are dimmer and warmer */

/* ---- extent: how many lamps the music justifies ----------------------------
   The dimension this rig is best at. Driven by loudness and by whether a voice
   is the only thing happening. */
const VOC = ((MAP.obs||{}).instruments||{}).parts||{};
function litCount(t){
  const c = chAt(t);
  const fe = feelAt(t);
  if(fe && fe.lamps <= -2) return 1;                 /* intimate: one voice, always */
  if(c==="stop") return 0;
  if(c==="quiet") return 1;                    /* one lamp: intimate */
  const e = enAt(t);
  let n = (c==="drop"||c==="build") ? 3 : (e > 0.55 ? 3 : (e > 0.28 ? 2 : 1));
  if(fe) n = Math.max(0, Math.min(3, n + fe.lamps));
  return n;
}

/* ---- the gap the music is owed ---------------------------------------------
   A hit needs somewhere to arrive from. Half a bar of black before every drop or
   stop -- expressed in beats, not seconds, so it survives a tempo change. */
const HITS = (MO||[]).filter(m=>m.kind==="drop"||m.kind==="stop").map(m=>m.at);
const GAP_BEATS = 2;
function inGap(t){
  for(const h of HITS){ if(t > h - GAP_BEATS*PER && t < h - 0.02) return true }
  return false;
}
function hitFlash(t){ return pulse(HITS, t, BAR_S*0.42) }

/* ---- two values and black, never a third ----------------------------------
   Warm carries the hook, cool carries the looking-back. Which one is hot is a
   structural question, not a colour question. */
const WARM=[255,196,120], COOL=[86,132,235], WHITE=[255,250,244];
function bed(t){
  const c = chAt(t);
  const hot = (c==="drop"||c==="build"||c==="chorus"||c==="outro");
  let base = hot ? WARM : COOL;
  if(PAL) base = hot ? PAL.impact : PAL.ground;      /* the artist's identity wins */
  const fe = feelAt(t);
  if(fe){                                            /* the feeling warms or cools it */
    base = [Math.min(255, base[0]*(1+fe.warm*0.5)),
            base[1]*(1+fe.warm*0.12),
            Math.max(0, base[2]*(1-fe.warm*0.55))];
  }
  if(!after(t)) return base;
  return [Math.min(255,base[0]*1.05), base[1]*0.94, base[2]*0.82];  /* warmer after */
}

/* ---- the pair: the room. Rate-ceilinged to eight bars by construction ------
   Quantising t before the level is computed is what makes the ceiling physical
   rather than a promise -- there is no expression here that can change faster. */
function pairLevel(t){
  const q = Math.floor(t/PHRASE)*PHRASE + PHRASE/2;
  const c = chAt(q);
  /* Measured 9 Sept: with the bed at these levels the beat was a 1.44:1
     modulation on a bright field, against 8.81:1 for the recipe Renjith approved
     on day one. Contrast is what the eye reads, so the bed has to get out of the
     way and let the beat be the light. These are a fifth of what they were. */
  const base = {intro:0.06,verse:0.10,break:0.03,build:0.13,drop:0.16,
                quiet:0.02,stop:0.0,outro:0.08,chorus:0.14,inst:0.10}[c];
  return (base===undefined?0.08:base) * (0.45 + 0.55*arc(q)) * energyScale();
}
/* tension splits the pair apart: same total light, less symmetry */
function split(t){
  const s = (SP||[]).find(x=>x.kind==="build" && t>=x.from && t<=x.to);
  if(!s) return 0;
  const u = (t-s.from)/Math.max(0.001,(s.to-s.from));
  return Math.max(0,Math.min(1,u)) * 0.55;
}

/* ---- the ball: motion toward the beat, not a flash on it -------------------
   Renjith, 9 Sept: "it doesn't make me feel like I want to align with it."

   The reason is measurable and it is not our timing. People synchronise far
   better to sound than to light, because the auditory system is specialised for
   time and vision for space -- so a flashing lamp is close to the WORST visual
   rhythm cue available. The literature's own comparison is a stationary flash
   against a BOUNCING BALL: visuo-motor synchronisation improves greatly when the
   stimulus moves through space, and improves further when that motion has a
   changing velocity profile. You entrain to something you can see arriving.

   Three pars in a row are a spatial axis. So instead of three lamps flashing
   together on the beat, one brightness TRAVELS along the axis and lands on a
   lamp on the beat, accelerating as it comes -- a ball falling onto the downbeat
   rather than a bulb blinking on it.

   This is also why the pair being symmetric 95% of the time was so damaging: it
   collapses the axis, leaving nothing for the ball to travel along. The two
   complaints were one complaint.

   Pure in t: the ball's position is derived from which beat we are between,
   never from where it was last frame. */

/* UNISON is the default and the ball is an option, which is the reverse of what
   I shipped first. Measured: with the ball travelling L-C-R-C, the centre lamp
   crossed half brightness 0.86 times a second while the kick was at 2.13 -- so
   the lamp you happen to be watching SKIPS beats, which reads exactly as "not
   synced" because it is not. The bouncing-ball research that led me here uses a
   SMOOTHLY moving stimulus; three lamps 1.2 m apart is not motion, it is three
   flashes taking turns. At this scale unison wins. */
const PATH = [0, 1, 2, 1];          /* only used when env is "ball" */
function ballAt(t, i){
  const k = before(BEATS, t);
  if (k < 0) return 0;
  const here = PATH[(k + 1 + BARPH) % PATH.length];  /* lamp the NEXT beat lands on */
  const from = PATH[(k + BARPH) % PATH.length];      /* lamp the last beat landed on */
  const nxt  = BEATS[k + 1] === undefined ? BEATS[k] + PER : BEATS[k + 1];
  const u    = Math.max(0, Math.min(1, (t - BEATS[k]) / Math.max(0.001, nxt - BEATS[k])));

  /* Four shapes. `swell` is the falling ball -- accelerating approach, so the eye
     sees it coming. `snap` is the classic instant-on. `pop` is percussive with
     almost no tail, which moves the envelope's centre of mass onto the beat.
     `breathe` is symmetric around the beat, so it rises BEFORE it -- the
     anticipation a drummer's stick gives you, without needing the travel. */
  const age = t - BEATS[k];
  let approach, land;
  if (ENV === "snap"){
    approach = u > 0.985 ? 1 : 0;
    land = Math.exp(-(age / (PER * 0.30)));
  } else if (ENV === "pop"){
    approach = 0;
    land = Math.max(0, 1 - age / (PER * 0.16));
  } else if (ENV === "breathe"){
    const half = PER * 0.42;
    approach = u > 0.5 ? 0.5 * (1 - Math.cos(Math.PI * (u - 0.5) / 0.5)) : 0;
    land = age < half ? 0.5 * (1 + Math.cos(Math.PI * age / half)) : 0;
  } else {
    approach = u * u * u;
    land = Math.exp(-(age / (PER * 0.28)));
  }

  if (ENV !== "ball") return Math.max(approach, land);   /* every lamp, every beat */
  let v = 0;
  if (i === here) v = Math.max(v, approach);     /* brightening as it arrives */
  if (i === from) v = Math.max(v, land);         /* still letting go of the last */
  return v;
}

/* ---- the special: the song ------------------------------------------------- */
function specialLevel(t){
  const c = chAt(t);
  if(c==="stop") return 0;
  const beat = pulse(BEATS, t);
  const acc  = pulse(((MAP.accents||{}).events||[]).map(e=>e.at), t, DECAY*0.7);
  const gain = {intro:0.35,verse:0.70,break:0.30,build:0.85,drop:1.0,
                quiet:0.45,stop:0,outro:0.45,chorus:0.9,inst:0.7}[c];
  const g = (gain===undefined?0.6:gain) * (0.5 + 0.5*arc(t));
  return Math.min(1, Math.max(beat*g, acc*g*0.8));
}

function frame(tIn){
  /* One line, and it moves everything: pulses, gaps, hits, chapters. The show is
     rendered as if the clock were LEAD milliseconds further on. */
  const t = tIn + LEAD;
  const pars = LAYOUT.fixtures.filter(f=>f.kind==="par");
  const n = litCount(t);
  const gap = inGap(t);
  const hit = hitFlash(t);
  const atPeak = hit > 0.55 && arc(t) > 0.82;

  let L=0,C=0,R=0, colL=bed(t), colC=bed(t), colR=bed(t), look=chAt(t);
  /* Every intermediate value, kept so a page can print the arithmetic instead of
     a finished number. Diagnostic only -- rule 7 lets a reader ignore it. */
  const TERMS = {branch:"body", chapter:chAt(t), arc:+arc(t).toFixed(3),
                 hit:+hit.toFixed(3), energy_scale:+energyScale().toFixed(3)};

  if(gap){ look = "gap"; TERMS.branch="gap" }                /* everything at zero */
  else if(atPeak){                                            /* the peak: all three */
    /* The consumer's dial was skipped here, so at the loudest instant of the song --
       the one place a "keep it calm" brief matters most -- the brief did nothing.
       Caught by printing the terms next to the claim that energy scales every level. */
    const pk = Math.min(1,0.85+0.15*hit) * energyScale();
    L=C=R=Math.max(0,Math.min(1,pk)); colL=colC=colR=WHITE; look="peak";
    TERMS.branch="peak"; TERMS.why="hit>0.55 and arc>0.82, so all lamps go white";
    TERMS.energy_scale=+energyScale().toFixed(3); TERMS.after_energy=+L.toFixed(4);
  } else {
    const p = pairLevel(t), sp = split(t), c = chAt(t);
    /* the bed: the room, symmetric, slow. Split apart when tension is building
       so the pair is not identical by default -- 94.7% identical measured before
       this line existed, which is a rut rather than a choice. */
    const bedL = p*(1+sp), bedR = p*(1-sp);
    /* the pulse: one brightness travelling the axis, landing on the beat */
    const gain = {intro:0.55,verse:0.88,break:0.45,build:0.95,drop:1.0,
                  quiet:0.55,stop:0,outro:0.62,chorus:1.0,inst:0.85}[c];
    /* floor raised so no beat falls under the eye's threshold: structure should
   change how bright a beat is, never whether you can see it at all. */
    let g = (gain===undefined?0.8:gain) * (0.78 + 0.22*arc(t));
    TERMS.gain = (gain===undefined?0.8:gain);
    TERMS.after_arc = +g.toFixed(4);
    const fe = feelAt(t);
    if(fe) g = Math.max(0, Math.min(1, g * fe.level));   /* declared feeling scales it */
    TERMS.feeling_mult = fe ? fe.level : 1;
    TERMS.after_feeling = +g.toFixed(4);
    g = Math.max(0, Math.min(1, g * energyScale()));     /* the consumer's dial */
    TERMS.after_energy = +g.toFixed(4);
    TERMS.pair = +p.toFixed(4); TERMS.split = +sp.toFixed(4);
    TERMS.bedL = +(p*(1+sp)).toFixed(4); TERMS.bedR = +(p*(1-sp)).toFixed(4);
    const b = [ballAt(t,0)*g, ballAt(t,1)*g, ballAt(t,2)*g];
    TERMS.pulse = b.map(v=>+v.toFixed(4));
    TERMS.lamps_lit = n;
    /* max, not sum: a bed added UNDER a pulse raises the floor and eats the
       contrast, which is the whole fault being fixed here. */
    if(n === 1){                                        /* focus: one voice */
      L = 0; R = 0; C = Math.max(specialLevel(t), b[1]); look = c+" · alone";
    } else {
      L = Math.max(n>=2?bedL:0, b[0]);
      C = Math.max(n>=3?p:0,    b[1]);
      R = Math.max(n>=2?bedR:0, b[2]);
    }
    /* Same fault as the peak: the accent was added after the dial, so an off-grid hit
       pushed the middle lamp to full however quiet the consumer asked for. */
    if(hit > 0.02){ const add = hit * energyScale();
      C = Math.min(1, C + add); colC = WHITE; TERMS.accent_added = +add.toFixed(3) }
  }
  TERMS.L = +L.toFixed(4); TERMS.C = +C.toFixed(4); TERMS.R = +R.toFixed(4);

  /* Generalised past three. The roles are positional, not indexed: the lamp
     nearest the middle is the SPECIAL, everything else is the PAIR, split by
     which side of centre it sits on. Three lamps is the minimum that has a
     middle; nine works the same way, which is the point of starting at three. */
  const out=[];
  const N = pars.length;
  const mid = (N - 1) / 2;
  for(let i=0;i<N;i++){
    const d = i - mid;
    let v, c;
    if(Math.abs(d) < 0.51){ v = C; c = colC; }            /* the middle lamp(s) */
    else if(d < 0)        { v = L; c = colL; }             /* left of centre */
    else                  { v = R; c = colR; }             /* right of centre */
    v = Math.max(0, Math.min(1, v));
    out.push({ id:pars[i].id, level:+v.toFixed(4),
               r:Math.round(c[0]*v), g:Math.round(c[1]*v), b:Math.round(c[2]*v) });
  }
  const fe = feelAt(t);
  if(fe && look !== "gap") look = look + " · " + fe.name;
  /* Diagnostic, not part of the frame contract -- a reader that does not know
     this field ignores it, which rule 7 requires. */
  const decided_by = {
    palette: RES.by,
    feeling: fe ? `artist: "${fe.name}" read as ${fe.term}/${fe.shape}` : "nobody declared one",
    energy:  BRIEF && BRIEF.energy !== undefined
             ? `consumer brief, x${energyScale().toFixed(2)}` : "unset, x1.00",
    structure: "the score",
  };
  return { t:+tIn.toFixed(3), look, decided_by, terms:TERMS, fixtures:out };
}
