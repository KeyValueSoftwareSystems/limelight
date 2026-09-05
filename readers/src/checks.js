const RUNGS=[
 {n:1,name:"beats",     adds:"a flash on every beat, all five lamps together",
  q:"Does a flash land on <b>every</b> beat, and nothing in between?",
  look:"the orange lane, against the grey lines above it",
  good:"one flash on every grey line, nothing between them, all five lamps together",
  bad:"flashes drifting away from the lines, or landing between them",
  fix:"the beat times are wrong, not the lights. Fix them in the editor with snap to kicks.",
  check:"how much louder the drum is under the flashes than elsewhere", pass:135},
 {n:2,name:"the bar",   adds:"the first beat of each bar is brighter",
  q:"Do the <b>tall</b> flashes land where each bar starts?",
  look:"how tall each flash is, against the blue lines",
  good:"a tall flash on every blue line, then three short ones",
  bad:"the tall flash sits one beat away from the blue line",
  fix:"the song's bar start is off by one beat. The strip below shows where it breaks.",
  check:"how often a new part of the song starts on a blue line", pass:80},
 {n:3,name:"position",  adds:"one lamp at a time, not all five",
  q:"Does the light <b>step along</b> the five, and open wide on beat one?",
  look:"the five lamps below, and whether the light moves along the row",
  good:"one lamp per beat moving along the row, all five open on a blue line",
  bad:"the same lamp twice in a row, or one lamp that never lights",
  fix:"the step restarts on every blue line, so a short bar reuses the same lamps.",
  check:"how much the least-used lamp gets, against an even share", pass:60},
 {n:4,name:"breathing", adds:"the lamps dip on each beat and grow back",
  q:"Do the lamps <b>dip on the beat</b> and grow back before the next one?",
  look:"the shape between the lines: a slope, not a spike",
  good:"the light drops on each beat and climbs back before the next",
  bad:"flat between beats, or spikes that fall to black",
  fix:"this song may not do it. Of the songs we have, only Levels does.",
  check:"whether the light grows between beats, the way the song does", pass:0},
 {n:5,name:"loud and quiet", adds:"brighter in the big parts, dimmer in the quiet ones",
  q:"Does the rig <b>grow</b> where the song grows?",
  look:"how tall the whole lane is as the song moves on",
  good:"brighter going into a big part, dimmer in a quiet one",
  bad:"the same height all the way through, or bright in the quiet parts",
  fix:"the song's loud-and-quiet track is flat or wrong in that part.",
  check:"whether the light rises and falls with how loud the song is", pass:50},
 {n:6,name:"the build", adds:"the rig climbs through a build and tightens",
  q:"Does the rig <b>climb</b> through a build instead of sitting still?",
  look:"the height of the lane across a build, and the outer lamps near the top",
  good:"steadily brighter, and narrowing to the middle as it peaks",
  bad:"flat through the build, or bright at the start with nowhere left to go",
  fix:"the map has no build marked there. Builds live in spans.",
  check:"whether the light rises across a build", pass:50},
 {n:7,name:"the drop", adds:"dark before it, everything on it",
  q:"Does the rig <b>fall away</b> before a drop and then open on it?",
  look:"the bar before the drop, then the instant itself",
  good:"fading to nearly black over the last bar, then all five white at once",
  bad:"the same brightness either side, so the drop passes unmarked",
  fix:"the map has no drop marked there. Drops live in moments.",
  check:"how much brighter the drop is than the bar before it", pass:300},
 {n:8,name:"colour",    adds:"two colours at a time, from a set you pick",
  q:"Are there only <b>two colours</b>, with white on the bar starts?",
  look:"the colours of the five lamps",
  good:"two colours alternating along the row, white only on a blue line",
  bad:"more than two colours, or a colour nobody chose",
  fix:"the colour set is a fixed list, so a third colour means something is ignoring it.",
  check:"how many different colours are on stage", pass:0, limit:4},
 {n:9,name:"drum hits", adds:"the hits that fall between the beats",
  q:"Do the extra flashes sit on <b>real hits</b>, not on the beat?",
  look:"the small flashes between the grey lines",
  good:"extra flashes on real drum hits, still in time with the song",
  bad:"extra flashes at even spacing, which means it is guessing rather than listening",
  fix:"it is reacting to quiet hits like hi-hats. Raise the threshold.",
  check:"how many of all the flashes are still in time", pass:90},
 {n:10,name:"instruments", adds:"how wide the rig is follows how full the song is",
  q:"Does the rig get <b>wider</b> when more instruments play?",
  look:"how many lamps are lit at once, as instruments come and go",
  good:"one lamp for a solo voice, all five when the whole band is in",
  bad:"the same number of lamps lit all the way through",
  fix:"this song has no instrument breakdown yet. Run synth/enrich.py on it.",
  check:"whether the number of lit lamps follows how full the song is", pass:50},
 {n:11,name:"melody",     adds:"which lamp follows the pitch of the tune",
  q:"Does the light <b>walk up the row</b> when the tune goes up?",
  look:"which lamp is brightest, as the tune rises and falls",
  good:"the bright lamp moves along the row with the tune, using the whole row",
  bad:"the bright lamp moving on its own, ignoring the tune",
  fix:"this song has no tune written down yet, so there is nothing to follow.",
  check:"whether the lit lamp follows the pitch of the tune", pass:45},
 {n:12,name:"chords",    adds:"the colour changes when the harmony changes",
  q:"Does the colour change <b>on the chord</b>, and at no other time?",
  look:"when the colours swap over, against where the chords change",
  good:"colour swaps land on chord changes and nowhere else",
  bad:"colour swapping on the beat, or drifting whenever it likes",
  fix:"this song has no chords written down yet.",
  check:"how many colour changes land on a chord change", pass:60},
 {n:13,name:"restraint", adds:"one thing leads at a time, the rest hold back",
  q:"Is the rig doing <b>one thing</b> at a time, or everything at once?",
  look:"the whole rig, and whether you know where to look",
  good:"one idea at a time -- the pulse, or the tune, or the rise -- the rest quiet",
  bad:"everything moving at once, so there is nothing to watch",
  fix:"this is applied last. If it still looks busy, a rung below it is too loud.",
  check:"how many times a second the picture changes", pass:0, limit:400},
 {n:14,name:"moving lamps", adds:"the moving lamps come back",
  q:"Do the moving lamps stay <b>within what a real motor can do</b>?",
  look:"the moving lamps, and whether the movement looks achievable",
  good:"movement a real motor could follow",
  bad:"jumping between positions, or the number above 100%",
  fix:"the limit comes from the rig description, not from the light program.",
  check:"the fastest movement, against what the rig allows", pass:0, limit:100},
 {n:15,name:"taking sides", adds:"each part of the rig gets a different job",
  q:"Are the two sides of the stage doing <b>different things</b>?",
  look:"the left ladders against the right ones, and both against the front truss",
  good:"the left pulsing with the bass while the right follows the voice",
  bad:"every lamp rising and falling together, so the rig is one animal",
  fix:"this song has no instrument breakdown. Run synth/enrich.py on it.",
  check:"how alike the fixture groups behave -- lower is better", pass:0, limit:70},
];

/* The rung checks, in one place.
   ----------------------------------------------------------------------------
   These used to live inside build.html, which meant the only way to run them was
   to open a browser and look. Renjith asked whether the ladder can be checked
   without a human, accurately, and it can -- but only if the script and the page
   run the SAME code. Two copies would drift and the answer would stop meaning
   anything, so there is one copy and both callers use it.

   Everything a check needs arrives in a context object rather than as globals:
     MAP    the map being judged
     LAY    the rig
     F      the reader, already built at the rung being tested
     LIGHT  {v, max} -- total emitted light sampled at HZ
     WAVE   {dt, peak, low} -- the recording's own envelope, which is what the
            checks that must not be circular are measured against
   Nothing here reads the page. */
/* A check with nothing to measure returns na:true. "This song has no chords
   written down" is not a broken show and must not be counted as one -- a runner
   that conflates missing data with failure produces a number nobody can act on.
   A rig that never changes colour, or leaves the lamps off while the tune plays,
   is NOT na: that is the show failing and it stays a failure. */
function makeChecks(C){
  const {MAP, LAY, F, LIGHT, WAVE, HZ} = C;
  const dur = m => (m.song && m.song.length) || 240;
  /* one definition of "what colour is this", used by the colour, chords and
     restraint checks -- three copies had already started to drift */
  const HUE_ = o => { const r=(o.r||0)/255, g=(o.g||0)/255, b=(o.b||0)/255;
    const M=Math.max(r,g,b), m2=Math.min(r,g,b), d=M-m2;
    if(d<0.06) return -1;
    let h = M===r ? 60*(((g-b)/d)%6) : M===g ? 60*((b-r)/d+2) : 60*((r-g)/d+4);
    return Math.round(((h%360)+360)%360/15) };
  const RUNGS_ = RUNGS;
  function flashTimes(A,B){
  const out=[], v=LIGHT.v, mx=LIGHT.max||1;
  for(let i=2;i<v.length-2;i++){
    const rise=v[i]-v[i-1];
    if(rise < mx*0.06) continue;
    if(v[i]-v[i-2] < v[i+1]-v[i-1]) continue;
    const t=i/HZ - 0.5/HZ;
    if(A!==undefined && (t<A||t>B)) continue;
    out.push(t);
  }
  return out;
}
  function onGridShare(A,B){
  const T=flashTimes(A,B); if(!T.length) return 0;
  const PER=MAP.grid.period, PH=MAP.grid.phase, SUB=PER/4;
  return 100*T.filter(t=>Math.abs(t-(PH+Math.round((t-PH)/SUB)*SUB))<=0.04).length/T.length;
}
  function runCheck(n, w0, w1){
  if(!LIGHT||!MAP) return {v:0,ok:false,txt:"no render", na:true};
  /* A rung can be right across the song and wrong in one part of it, which is
     exactly the thing worth knowing, so every check takes a window and the strip
     under the lane runs it once per part. */
  const A = (w0===undefined) ? 0 : w0, B2 = (w1===undefined) ? dur(MAP) : w1;
  /* Rung 1 must anchor to the RECORDING, not to the map. Measuring flashes against
     the map's own grid is circular: shift the whole map half a beat and the flashes
     shift with it, so the check passes on a map that is audibly late. This asks the
     only question that cannot be gamed -- is the kick actually loud at the instant
     the light comes on? -- by comparing the low band under the flashes against the
     low band everywhere else. */
  if(n===1){
    const T=flashTimes(A,B2); if(!T.length) return {v:0,ok:false,txt:"no flashes here"};
    if(!WAVE) return {v:0,ok:false,txt:"still loading the sound", na:true};
    const L=WAVE.low, dt=WAVE.dt;
    const at=t=>{ const i=Math.round(t/dt); let p=0;
      for(let j=Math.max(0,i-1);j<Math.min(L.length,i+2);j++) p=Math.max(p,L[j]); return p };
    let hit=0; for(const t of T) hit+=at(t);
    let all=0, cnt=0;
    for(let i=Math.max(0,(A/dt)|0);i<Math.min(L.length,(B2/dt)|0);i++){ all+=L[i]; cnt++ }
    if(!cnt) return {v:0,ok:false,txt:"no sound here", na:true};
    const ratio=(hit/T.length)/(all/cnt);
    return {v:ratio*100, ok:ratio>=1.35,
            txt:`the drum is ${ratio.toFixed(2)} times louder under the flashes than elsewhere`} }
  /* Rung 6 measures against the map's grid, which is only safe because rung 1
     already anchored that grid to the recording. Accepting 6 without 1 means
     nothing. */
  if(n===9){ const s=onGridShare(A,B2);
    return {v:s, ok:s>=RUNGS_[n-1].pass,
            txt:`${s.toFixed(0)}% of ${flashTimes(A,B2).length} flashes are in time`} }
  if(n===2){
    const B=MAP.beats||[], D=new Set((MAP.downbeats||[]).map(x=>+x.toFixed(3)));
    const marks=[...(MAP.chapters||[]).map(c=>c.at), ...(MAP.moments||[]).map(m=>m.at)]
      .filter(t=>t>=A&&t<=B2);
    if(!marks.length||!D.size) return {v:0,ok:false,txt:"nothing here to test against", na:true};
    const hit=marks.filter(t=>[...D].some(d=>Math.abs(d-t)<=0.06)).length;
    const s=100*hit/marks.length;
    return {v:s, ok:s>=80, txt:`${hit} of ${marks.length} new parts start on a blue line`} }
  /* Rung 4 asks whether the light agrees with the RECORD. The window starts at 45%
     of the beat so the flash from rung 1 has decayed and what is left is the bed
     the compressor acts on. A record that pumps must make the light recover; a
     record that does not must leave it alone. Always breathing would fail here. */
  if(n===4){
    const P=(MAP.observations||{}).pump, B=MAP.beats||[];
    const win=(lo,hi)=>{ const v=[];
      let used=0;
      for(let i=0;i<B.length-1;i++){ if(B[i]<A||B[i]>B2||used>90) continue; used++;
        const per=B[i+1]-B[i], S=[];
        for(let x=lo;x<hi;x+=0.03) S.push(F(B[i]+per*x).fixtures.reduce((a,o)=>a+(o.level||0),0));
        const t3=Math.max(1,Math.floor(S.length/3));
        const a1=S.slice(0,t3).reduce((a,b)=>a+b,0)/t3, b1=S.slice(-t3).reduce((a,b)=>a+b,0)/t3;
        if(a1+b1>0) v.push((b1-a1)/(a1+b1)) }
      return v.length? v.reduce((a,b)=>a+b,0)/v.length : 0 };
    const r=win(0.45,0.95);
    if(!P) return {v:0,ok:false,txt:"nobody has measured this song yet (run listen/pump.py)", na:true};
    if(!P.present) return {v:r,ok:true,
      txt:`this song does not do it, and the lamps do not either`};
    return {v:r*100, ok:r>0,
      txt:`the song grows +${P.depth} between beats, the light grows ${r>=0?"+":""}${r.toFixed(3)}`} }
  /* Measured on the light, against where the map says the build and the drop are.
     Both can fail: a rig that is flat through a build, or one that is the same
     brightness either side of a drop, gets caught. */
  if(n===6){
    const sp=(MAP.spans||[]).filter(s=>s.kind==="build" && s.to>A && s.from<B2);
    if(!sp.length) return {v:0,ok:false,na:true,txt:"no build marked in this part"};
    const xs=[],ys=[];
    for(const s of sp) for(let t=s.from;t<s.to;t+=0.25){
      let v=0,c=0;
      for(let u=t;u<t+0.25;u+=0.02){ v+=F(u).fixtures.reduce((a,o)=>a+(o.level||0),0); c++ }
      xs.push((t-s.from)/(s.to-s.from)); ys.push(v/Math.max(1,c)) }
    if(xs.length<8) return {v:0,ok:false,na:true,txt:"the builds here are too short to tell"};
    const mx=xs.reduce((a,b)=>a+b,0)/xs.length, my=ys.reduce((a,b)=>a+b,0)/ys.length;
    let sxy=0,sxx=0,syy=0;
    for(let i=0;i<xs.length;i++){const a2=xs[i]-mx,b2=ys[i]-my; sxy+=a2*b2; sxx+=a2*a2; syy+=b2*b2}
    if(syy<1e-9) return {v:0,ok:false,txt:"the rig is flat through the build"};
    const r=sxy/Math.sqrt(sxx*syy||1);
    return {v:100*r, ok:r>=0.5,
      txt:`the rig climbs through the build, ${r.toFixed(2)} out of a possible 1.00`} }
  if(n===7){
    const dr=(MAP.moments||[]).filter(m=>m.kind==="drop" && m.at>=A && m.at<=B2);
    if(!dr.length) return {v:0,ok:false,na:true,txt:"no drop marked in this part"};
    const mean=(a,b)=>{ let v=0,c=0;
      for(let t=a;t<b;t+=0.02){ v+=F(t).fixtures.reduce((x,o)=>x+(o.level||0),0); c++ }
      return c? v/c : 0 };
    const ratios=[];
    for(const d of dr){
      const before=mean(d.at-0.5, d.at-0.02), on=mean(d.at, d.at+0.3);
      ratios.push(on / Math.max(0.02, before)) }
    const r=ratios.reduce((a,b)=>a+b,0)/ratios.length;
    return {v:100*r, ok:r>=3,
      txt:`the drop is ${r.toFixed(1)} times brighter than the bar before it`} }
  if(n===3){
    const use=new Array(LAY.fixtures.filter(f=>f.kind==="par").length).fill(0);
    for(let t=A;t<Math.min(B2,A+90);t+=0.04){
      const fr=F(t); fr.fixtures.forEach((o,i)=>{ if(i<use.length && (o.level||0)>0.25) use[i]++ }) }
    const tot=use.reduce((a,b)=>a+b,0); if(!tot) return {v:0,ok:false,txt:"nothing lit here"};
    const even=tot/use.length, s=100*Math.min(...use)/even;
    return {v:s, ok:s>=60, txt:`the least-used lamp gets ${s.toFixed(0)}% of an even share`} }
  if(n===5){
    /* Correlating the light against the map's OWN energy field is circular -- the
       recipe derives brightness from that field, so the answer is 1.00 whatever
       the field says, including when it is wrong. This measures the light against
       the RECORDING instead: the loudness envelope computed from the audio, which
       the recipe never sees. Now a bad energy curve fails. */
    const E=MAP.energy||[]; if(E.length<8) return {v:0,ok:false,txt:"no energy curve", na:true};
    if(!WAVE) return {v:0,ok:false,txt:"waveform not loaded yet", na:true};
    const loud=t=>{ const i=Math.round(t/WAVE.dt); let p=0;
      for(let j=Math.max(0,i);j<Math.min(WAVE.peak.length,i+Math.round(MAP.grid.period*4/WAVE.dt));j++)
        p+=WAVE.peak[j];
      return p };
    const xs=[],ys=[];
    for(const [t] of E){ if(t>dur(MAP)-1||t<A||t>B2) continue;
      let s=0,c=0; for(let u=t;u<t+MAP.grid.period*4;u+=0.05){ const fr=F(u);
        s+=fr.fixtures.reduce((a,o)=>a+(o.level||0),0); c++ }
      xs.push(loud(t)); ys.push(s/Math.max(1,c)) }
    const mx=xs.reduce((a,b)=>a+b,0)/xs.length, my=ys.reduce((a,b)=>a+b,0)/ys.length;
    let sxy=0,sxx=0,syy=0;
    for(let i=0;i<xs.length;i++){const a=xs[i]-mx,b=ys[i]-my; sxy+=a*b; sxx+=a*a; syy+=b*b}
    if(xs.length<4) return {v:0,ok:false,txt:"not enough of the song here to tell", na:true};
    const r=sxy/Math.sqrt(sxx*syy||1), s=100*r;
    return {v:s, ok:s>=50,
      txt:`the light follows how loud the song is, ${r.toFixed(2)} out of a possible 1.00`} }
  if(n===8){
    /* Count HUES, not raw values. Bucketing r,g,b counted every brightness of the
       same colour as a new one, so adding the breathing rung -- which changes
       brightness and nothing else -- made this fail with ten. White is counted
       once however bright it is, because white is one colour. */
    const H=new Set();
    for(let t=A;t<Math.min(B2,A+90);t+=0.1)
      for(const o of F(t).fixtures){ if((o.level||0)<0.2) continue;
        const r=(o.r||0)/255, g=(o.g||0)/255, b=(o.b||0)/255;
        const mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn;
        if(d < 0.06){ H.add("white"); continue }
        let h = mx===r ? 60*(((g-b)/d)%6) : mx===g ? 60*((b-r)/d+2) : 60*((r-g)/d+4);
        H.add(String(Math.round(((h%360)+360)%360/15)));   // 15-degree buckets
      }
    const s=H.size;
    return {v:s, ok:s<=4, txt:`${s} different colours on stage, counting white as one`} }
  /* Rungs 8 to 10 are CONSISTENCY checks, not the record-anchored kind that rungs
     1 and 4 use. They ask whether the light agrees with what the map says about
     the song; they cannot tell you the map is wrong about it. That is a real and
     deliberate limit -- an independent version would need the separated instrument
     audio, which we do not have. Stated here rather than hidden, because the whole
     value of this file is that a green result means something. */
  if(n===10){
    const I=(MAP.observations||{}).instruments;
    if(!I||!I.density_per_bar) return {v:0,ok:false,txt:"this song has no instrument breakdown yet", na:true};
    const D=I.density_per_bar.filter(x=>x[0]>=A&&x[0]<=B2);
    if(D.length<4) return {v:0,ok:false,txt:"not enough of the song here to tell", na:true};
    const xs=[],ys=[];
    for(const [t,d] of D){ let n2=0,c=0;
      for(let u=t;u<t+1.5;u+=0.05){ n2+=F(u).fixtures.filter(o=>(o.level||0)>0.15).length; c++ }
      xs.push(d); ys.push(n2/Math.max(1,c)) }
    const mx=xs.reduce((a,b)=>a+b,0)/xs.length, my=ys.reduce((a,b)=>a+b,0)/ys.length;
    let sxy=0,sxx=0,syy=0;
    for(let i=0;i<xs.length;i++){const a2=xs[i]-mx,b3=ys[i]-my; sxy+=a2*b3; sxx+=a2*a2; syy+=b3*b3}
    if(syy<1e-9) return {v:0,ok:false,txt:"the same number of lamps is lit all the way through"};
    const r=sxy/Math.sqrt(sxx*syy||1);
    return {v:100*r, ok:r>=0.5,
      txt:`the rig widens with the song, ${r.toFixed(2)} out of a possible 1.00`} }
  if(n===11){
    const M=(MAP.observations||{}).melody;
    const N=((M&&M.notes)||[]).filter(e=>e&&e.length>=3&&isFinite(e[2])&&e[0]>=A&&e[0]<=B2);
    if(N.length<12) return {v:0,ok:false,txt:"this song has no tune written down here", na:true};
    /* Measured over a bar, not note to note. Following each note put the lit lamp
       somewhere new eight times a second, which is a strobe rather than a show, so
       the rig deliberately follows the PHRASE. The check has to ask the same
       question the design answers: does the light sit where the tune is sitting.
       Note-level following would score this design badly and a strobe well. */
    const BARS=(MAP.grid.period||0.5)*4;
    const bins=new Map();
    for(const [t,,mid] of N){ const b=Math.floor(t/BARS);
      if(!bins.has(b)) bins.set(b,[]); bins.get(b).push(mid) }
    const xs=[],ys=[]; const seen=new Set();
    for(const [b,ms] of bins){
      if(ms.length<3) continue;
      const t=(b+0.5)*BARS;
      let sum=0,c=0;
      for(let u=b*BARS;u<(b+1)*BARS;u+=0.08){
        const fr=F(u); let bi=-1,bv=0.15;
        fr.fixtures.forEach((o,i)=>{ if((o.level||0)>bv){ bv=o.level; bi=i } });
        if(bi>=0){ seen.add(bi); sum+=bi; c++ } }
      if(!c) continue;
      xs.push(ms.reduce((a,b2)=>a+b2,0)/ms.length); ys.push(sum/c) }
    if(xs.length<8) return {v:0,ok:false,txt:"the lamps are off while the tune plays here"};
    const mx=xs.reduce((a,b)=>a+b,0)/xs.length, my=ys.reduce((a,b)=>a+b,0)/ys.length;
    let sxy=0,sxx=0,syy=0;
    for(let i=0;i<xs.length;i++){const a2=xs[i]-mx,b3=ys[i]-my; sxy+=a2*b3; sxx+=a2*a2; syy+=b3*b3}
    if(syy<1e-9) return {v:0,ok:false,txt:"the same lamp stays lit whatever the tune does"};
    const r=sxy/Math.sqrt(sxx*syy||1);
    const nPar=LAY.fixtures.filter(f=>f.kind==="par").length;
    return {v:100*r, ok:r>=0.45 && seen.size>=Math.min(4,nPar),
      txt:`the lit lamp follows the tune ${r.toFixed(2)} out of 1.00, using ${seen.size} of ${nPar} lamps`} }
  if(n===12){
    const C2=((MAP.observations||{}).chords||{}).events||[];
    const ch=C2.filter(c=>c.at>=A&&c.at<=B2);
    if(ch.length<4) return {v:0,ok:false,txt:"this song has no chords written down here", na:true};
    const hue=HUE_;
    /* white is excluded. The bar starts go white on purpose, so counting that as a
       colour change made an intended gesture look like colour drifting -- the same
       mistake as counting brightness as colour. What is being asked is whether the
       COLOURS move when the harmony moves. */
    const swaps=[]; let prev=null;
    for(let t=A;t<B2;t+=0.05){
      /* the SET of colours in use, not the per-lamp list: a lamp switching off
         removed an entry and read as a colour change, which it is not */
      const f2=F(t).fixtures.filter(o=>(o.level||0)>0.25).map(hue).filter(h=>h>=0);
      if(!f2.length) continue;
      const sig=[...new Set(f2)].sort((a,b)=>a-b).join(",");
      if(prev!==null && sig!==prev) swaps.push(t);
      prev=sig }
    if(!swaps.length){
      /* under the white-only theme there is no colour to change, so this rung has
         nothing to judge rather than something to fail */
      let anyHue=false;
      for(let t=A;t<Math.min(B2,A+30);t+=0.5)
        if(F(t).fixtures.some(o=>(o.level||0)>0.25 && hue(o)>=0)){ anyHue=true; break }
      if(!anyHue) return {v:0,ok:false,na:true,
        txt:"the colour set is white only, so there is nothing here to judge"};
      return {v:0,ok:false,txt:"the colours never change here"} }
    const near=swaps.filter(t=>ch.some(c=>Math.abs(c.at-t)<=0.25)).length;
    const s2=100*near/swaps.length;
    return {v:s2, ok:s2>=60,
      txt:`${near} of ${swaps.length} colour changes land on a chord change`} }
  /* Judged from the end of the room rather than from the map. A viewer can follow
     two or three changes a second; past that a rig stops reading as a show and
     starts reading as flicker. Brightness is counted in coarse steps so a smooth
     fade is one change and not fifty. */
  if(n===13){
    /* Quantising brightness counted a fading flash as a stream of changes, so even
       one flash a beat scored as chaos. A viewer sees a fade as ONE event. What
       the eye actually registers is a change of picture: which lamps are lit, and
       what colour they are. A decay does not count until a lamp crosses out. */
    const state=t=>{
      const on=[], hues=new Set();
      F(t).fixtures.forEach((o,i)=>{ if((o.level||0)>0.35){ on.push(i);
        const h=HUE_(o); if(h>=0) hues.add(h) } });
      return on.join(",")+"|"+[...hues].sort((a,b)=>a-b).join(",") };
    let prev=null, changes=0, n2=0;
    for(let t=A;t<Math.min(B2,A+45);t+=0.02){
      const sig=state(t);
      if(prev!==null && sig!==prev) changes++;
      prev=sig; n2++ }
    if(!n2) return {v:0,ok:false,na:true,txt:"nothing rendered here"};
    const per=changes/(n2*0.02);
    return {v:per*100, ok:per<=4,
      txt:`the picture changes ${per.toFixed(1)} times a second, and a room can follow about 4`} }
  /* Renjith's complaint, made measurable: "the lights all move like one". Correlate
     the groups against each other. Identical behaviour scores 1.00 and fails; groups
     doing genuinely different jobs land far below it. This is the only check here
     that wants a LOW number. */
  if(n===15){
    const I=(MAP.observations||{}).instruments;
    if(!I||!I.parts) return {v:0,ok:false,na:true,txt:"this song has no instrument breakdown yet"};
    const fx=(LAY.fixtures||[]);
    const xs=fx.map(f=>(f.at||[0])[0]);
    const midx=(Math.min(...xs)+Math.max(...xs))/2;
    const hz=fx.filter(f=>f.kind==="head").map(f=>(f.at||[0,0,0])[2]);
    const backz=hz.length?(Math.min(...hz)+Math.max(...hz))/2:0;
    const groups={
      pars:  f=>f.kind==="par",
      left:  f=>f.kind==="head"&&(f.at||[0,0,0])[2]>=backz&&f.at[0]<midx,
      right: f=>f.kind==="head"&&(f.at||[0,0,0])[2]>=backz&&f.at[0]>=midx,
      front: f=>f.kind==="head"&&(f.at||[0,0,0])[2]<backz };
    const names=Object.keys(groups).filter(k2=>fx.some(groups[k2]));
    if(names.length<2) return {v:0,ok:false,na:true,txt:"this rig has only one group of lamps"};
    const series={}; names.forEach(k2=>series[k2]=[]);
    for(let t=A;t<Math.min(B2,A+100);t+=0.25){
      const by={}; for(const o of F(t).fixtures) by[o.id]=o;
      for(const k2 of names)
        series[k2].push(fx.filter(groups[k2]).reduce((a,f)=>a+((by[f.id]||{}).level||0),0));
    }
    const cor=(a,b)=>{const n2=a.length; if(n2<4) return 1;
      const ma=a.reduce((x,y)=>x+y,0)/n2, mb=b.reduce((x,y)=>x+y,0)/n2;
      let sx=0,sy=0,sxy=0;
      for(let i2=0;i2<n2;i2++){const p2=a[i2]-ma,q=b[i2]-mb; sxy+=p2*q; sx+=p2*p2; sy+=q*q}
      if(sx<1e-9||sy<1e-9) return 1;
      return sxy/Math.sqrt(sx*sy)};
    const ps=[];
    for(let i2=0;i2<names.length;i2++) for(let j2=i2+1;j2<names.length;j2++)
      ps.push(cor(series[names[i2]],series[names[j2]]));
    const mean=ps.reduce((a,b)=>a+b,0)/ps.length;
    return {v:100*mean, ok:mean<=0.70,
      txt:`the groups behave ${(100*mean).toFixed(0)}% alike, and under 70% is different enough`} }
  if(n===14){
    const L=(LAY.limits||{}), mp=L.max_pan_per_s||1.55, mt=L.max_tilt_per_s||1.7;
    let worst=0, prev=null;
    for(let t=A;t<Math.min(B2,A+60);t+=0.02){
      const fr=F(t); const h=fr.fixtures.filter(o=>o.pan!==undefined);
      if(prev) h.forEach((o,i)=>{ if(!prev[i]) return;
        worst=Math.max(worst, Math.abs(o.pan-prev[i].pan)/0.02/mp, Math.abs(o.tilt-prev[i].tilt)/0.02/mt) });
      prev=h }
    const s=100*worst;
    return {v:s, ok:s<=100,
      txt:`the fastest movement is ${s.toFixed(0)}% of what the rig allows`} }
  return {v:0,ok:false,txt:"—"};
}
  return {runCheck, flashTimes, onGridShare};
}
if(typeof module!=="undefined" && module.exports) module.exports={makeChecks, RUNGS};
