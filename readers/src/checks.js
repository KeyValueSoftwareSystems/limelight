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
 {n:6,name:"colour",    adds:"two colours at a time, from a set you pick",
  q:"Are there only <b>two colours</b>, with white on the bar starts?",
  look:"the colours of the five lamps",
  good:"two colours alternating along the row, white only on a blue line",
  bad:"more than two colours, or a colour nobody chose",
  fix:"the colour set is a fixed list, so a third colour means something is ignoring it.",
  check:"how many different colours are on stage", pass:0, limit:4},
 {n:7,name:"drum hits", adds:"the hits that fall between the beats",
  q:"Do the extra flashes sit on <b>real hits</b>, not on the beat?",
  look:"the small flashes between the grey lines",
  good:"extra flashes on real drum hits, still in time with the song",
  bad:"extra flashes at even spacing, which means it is guessing rather than listening",
  fix:"it is reacting to quiet hits like hi-hats. Raise the threshold.",
  check:"how many of all the flashes are still in time", pass:90},
 {n:8,name:"moving lamps", adds:"the two moving lamps come back",
  q:"Do the moving lamps stay <b>within what a real motor can do</b>?",
  look:"the two moving lamps, and whether the movement looks achievable",
  good:"movement a real motor could follow",
  bad:"jumping between positions, or the number above 100%",
  fix:"the limit comes from the rig description, not from the light program.",
  check:"the fastest movement, against what the rig allows", pass:0, limit:100},
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
function makeChecks(C){
  const {MAP, LAY, F, LIGHT, WAVE, HZ} = C;
  const dur = m => (m.song && m.song.length) || 240;
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
  if(!LIGHT||!MAP) return {v:0,ok:false,txt:"no render"};
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
    if(!WAVE) return {v:0,ok:false,txt:"still loading the sound"};
    const L=WAVE.low, dt=WAVE.dt;
    const at=t=>{ const i=Math.round(t/dt); let p=0;
      for(let j=Math.max(0,i-1);j<Math.min(L.length,i+2);j++) p=Math.max(p,L[j]); return p };
    let hit=0; for(const t of T) hit+=at(t);
    let all=0, cnt=0;
    for(let i=Math.max(0,(A/dt)|0);i<Math.min(L.length,(B2/dt)|0);i++){ all+=L[i]; cnt++ }
    if(!cnt) return {v:0,ok:false,txt:"no sound here"};
    const ratio=(hit/T.length)/(all/cnt);
    return {v:ratio*100, ok:ratio>=1.35,
            txt:`the drum is ${ratio.toFixed(2)} times louder under the flashes than elsewhere`} }
  /* Rung 6 measures against the map's grid, which is only safe because rung 1
     already anchored that grid to the recording. Accepting 6 without 1 means
     nothing. */
  if(n===7){ const s=onGridShare(A,B2);
    return {v:s, ok:s>=RUNGS_[n-1].pass,
            txt:`${s.toFixed(0)}% of ${flashTimes(A,B2).length} flashes are in time`} }
  if(n===2){
    const B=MAP.beats||[], D=new Set((MAP.downbeats||[]).map(x=>+x.toFixed(3)));
    const marks=[...(MAP.chapters||[]).map(c=>c.at), ...(MAP.moments||[]).map(m=>m.at)]
      .filter(t=>t>=A&&t<=B2);
    if(!marks.length||!D.size) return {v:0,ok:false,txt:"nothing here to test against"};
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
    if(!P) return {v:0,ok:false,txt:"nobody has measured this song yet (run listen/pump.py)"};
    if(!P.present) return {v:r,ok:true,
      txt:`this song does not do it, and the lamps do not either`};
    return {v:r*100, ok:r>0,
      txt:`the song grows +${P.depth} between beats, the light grows ${r>=0?"+":""}${r.toFixed(3)}`} }
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
    const E=MAP.energy||[]; if(E.length<8) return {v:0,ok:false,txt:"no energy curve"};
    if(!WAVE) return {v:0,ok:false,txt:"waveform not loaded yet"};
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
    if(xs.length<4) return {v:0,ok:false,txt:"not enough of the song here to tell"};
    const r=sxy/Math.sqrt(sxx*syy||1), s=100*r;
    return {v:s, ok:s>=50,
      txt:`the light follows how loud the song is, ${r.toFixed(2)} out of a possible 1.00`} }
  if(n===6){
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
  if(n===8){
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
