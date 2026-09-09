const MF=MAP_FULL, SOBS=(MAP_FULL&&MAP_FULL.observations)||{};
/* X() and W() were defined in the old score page's own scope and were lost in
   the extraction, which left every lane throwing and the Score tab blank. */
const DOWNS = MAP_FULL.downbeats;
const X = t => t*PXS;
const W = () => Math.ceil(DUR*PXS)+2;
const LANES = [];
function lane(name,sub,h,draw){LANES.push({name,sub,h,draw})}
const gr=(c,a)=>'rgba('+c+','+a+')';

/* ---------------- the lanes ---------------- */
lane('bars & beats','the grid, 126.0 bpm',26,(g,w,h)=>{
  g.fillStyle='#0b0d12';g.fillRect(0,0,w,h);
  BEATS.forEach((b,i)=>{const on=((i-MF.grid.bar_phase)%4+4)%4===0;
    g.fillStyle=on?'rgba(255,255,255,.42)':'rgba(255,255,255,.13)';
    g.fillRect(X(b),on?4:11,1,on?h-8:h-18)});
  g.fillStyle='#575e6b';g.font='9px ui-monospace,Menlo,monospace';
  DOWNS.forEach((d,i)=>{if(i%4===0)g.fillText(String(i+1),X(d)+3,10)})});

lane('sections','mine, by named features',30,(g,w,h)=>{
  const S=MF.sections.entries, C={A:'#2a3a5e',B:'#4a2f56',C:'#1d3a4a',D:'#5a3a1c',
    E:'#5e2436',F:'#243f2c',G:'#4a2436',H:'#2a2f3a'};
  S.forEach(s=>{const a=X(s.at),b=X(s.to);
    g.fillStyle=C[s.id]||'#252a35';g.fillRect(a,3,Math.max(1,b-a-1),h-6);
    g.fillStyle='#e9ebf0';g.font='600 11px ui-monospace,Menlo,monospace';
    if(b-a>26)g.fillText(s.id+(s.repeat>1?('#'+s.repeat):''),a+4,h/2+4);
    g.fillStyle='#8a919e';g.font='9px ui-monospace,Menlo,monospace';
    if(b-a>70)g.fillText(s.name,a+4,h-5)})});

lane('sections','learned, from the vectors',30,(g,w,h)=>{
  const SP=MF.segmentation_proposal; if(!SP||!SP.sections) return;
  const S=SP.sections, C={A:'#2a3a5e',B:'#4a2f56',C:'#1d3a4a',
    D:'#5a3a1c',E:'#5e2436',F:'#243f2c',G:'#2a2f3a'};
  S.forEach(s=>{const a=X(s.at),b=X(s.to);
    g.fillStyle=C[s.id]||'#252a35';g.fillRect(a,3,Math.max(1,b-a-1),h-6);
    g.fillStyle='#e9ebf0';g.font='600 11px ui-monospace,Menlo,monospace';
    if(b-a>22)g.fillText(s.id+(s.repeat>1?('#'+s.repeat):''),a+4,h/2+4);
    g.fillStyle='#28c98a';g.font='9px ui-monospace,Menlo,monospace';
    if(b-a>60)g.fillText(s.bars+' bars',a+4,h-5)})});

lane('spans','with a rise shape',22,(g,w,h)=>{
  MF.spans.forEach(s=>{const a=X(s.from),b=X(s.to);
    g.fillStyle='rgba(255,122,47,.22)';g.fillRect(a,4,b-a,h-8);
    g.strokeStyle='#ff7a2f';g.lineWidth=1.4;g.beginPath();
    for(let i=0;i<=40;i++){const u=i/40;
      const v=s.rise==='late'?Math.pow(u,2.2):s.rise==='early'?Math.sqrt(u):
              s.rise==='stepped'?Math.floor(u*4)/4:u;
      const px=a+(b-a)*u, py=h-4-(h-8)*v; i?g.lineTo(px,py):g.moveTo(px,py)}
    g.stroke();
    g.fillStyle='#ff7a2f';g.font='9px ui-monospace,Menlo,monospace';
    g.fillText(s.kind+' '+s.rise,a+4,12)})});

lane('moments','the six kinds',22,(g,w,h)=>{
  const C={drop:'#ff2f5e',stop:'#ffffff',quiet:'#5b8cff',spotlight:'#ffd166',return:'#28c98a'};
  MF.moments.forEach(m=>{const x=X(m.at);
    g.fillStyle=C[m.kind]||'#8a919e';g.fillRect(x-1,3,2,h-6);
    g.font='9px ui-monospace,Menlo,monospace';g.fillText(m.kind,x+4,12)})});

lane('energy','composite, per downbeat',40,(g,w,h)=>{
  g.strokeStyle='#28c98a';g.lineWidth=1.6;g.beginPath();
  MF.energy.forEach((p,i)=>{const x=X(p[0]),y=h-3-(h-8)*p[1];i?g.lineTo(x,y):g.moveTo(x,y)});
  g.stroke()});

const STEMC={vocals:'#ffd166',drums:'#ff5470',bass:'#06d6a0',other:'#5b8cff',
             guitar:'#c9a0ff',piano:'#ff9f7a'};
Object.keys(STEMC).forEach(k=>{
  lane(k,'presence & envelope',26,(g,w,h)=>{
    // A stem the writer marked absent, or one the separator never emitted, is
    // not drawn as a flat line at whatever its own noise floor normalises to.
    const v=(((MF.stems||{}).sources)||{})[k];
    if(!v||!v.length) return;
    const DL=(typeof DERIVE!=='undefined')?DERIVE.make(MF):null;
    const shown=(DL&&DL.stems_present.indexOf(k)<0)?null:v;
    if(!shown) return;
    g.fillStyle=gr(hexrgb(STEMC[k]),0.18);
    g.beginPath();g.moveTo(0,h);
    const y01=i=>{const q=DL?DL.stem01(k,DOWNS[i]):null;return q===null?0:q};
    shown.forEach((_,i)=>g.lineTo(X(DOWNS[i]),h-2-(h-5)*y01(i)));
    g.lineTo(X(DUR),h);g.closePath();g.fill();
    g.strokeStyle=STEMC[k];g.lineWidth=1.2;g.beginPath();
    shown.forEach((_,i)=>{const x=X(DOWNS[i]),yy=h-2-(h-5)*y01(i);i?g.lineTo(x,yy):g.moveTo(x,yy)});
    g.stroke();
    const ES=(SOBS.envelope&&SOBS.envelope.sources); if(!ES) return;
    const e=ES[k];
    g.strokeStyle=gr(hexrgb(STEMC[k]),0.45);g.lineWidth=0.8;g.beginPath();
    e.forEach((db,i)=>{const x=X(BEATS[i]),yy=h-2-(h-5)*Math.max(0,(db+60)/60);
      i?g.lineTo(x,yy):g.moveTo(x,yy)});g.stroke()})});

lane('notes','3,863, basic-pitch',150,(g,w,h)=>{
  const S=(SOBS.notes&&SOBS.notes.sources); if(!S) return; let lo=127,hi=0;
  Object.values(S).forEach(a=>a.forEach(n=>{lo=Math.min(lo,n[2]);hi=Math.max(hi,n[2])}));
  const Y=p=>h-3-(h-6)*((p-lo)/Math.max(1,hi-lo));
  for(let p=lo;p<=hi;p++) if(p%12===6){g.fillStyle='rgba(255,255,255,.05)';
    g.fillRect(0,Y(p),w,1)}
  Object.keys(S).forEach(k=>{const c=STEMC[k]||'#888';
    S[k].forEach(n=>{const x=X(n[0]),ww=Math.max(1.2,X(n[1]));
      g.fillStyle=gr(hexrgb(c),0.30+0.60*Math.min(1,n[4]*2));
      g.fillRect(x,Y(n[2])-1.4,ww,2.8)})});
  g.fillStyle='#575e6b';g.font='9px ui-monospace,Menlo,monospace';
  g.fillText('F# octaves marked',4,10)});

lane('accents','983 hits, 71% off-grid',34,(g,w,h)=>{
  const C={kick:'#ff5470',snare:'#ffd166',hat:'#5b8cff'};
  SOBS.notes && null;
  MF.accents.events.forEach(a=>{
    const x=X(a.at), hh=(h-6)*a.strength;
    g.fillStyle=gr(hexrgb(C[a.of]||'#888'), a.on_grid?0.85:0.45);
    g.fillRect(x,h-3-hh,a.on_grid?1.6:1,hh)})});

lane('chords','per bar, F# major',22,(g,w,h)=>{
  const E=(SOBS.chords&&SOBS.chords.events); if(!E||!E.length) return;
  E.forEach((c,i)=>{const a=X(c.at),b=i+1<E.length?X(E[i+1].at):X(DUR);
    g.fillStyle=i%2?'#12161d':'#151a22';g.fillRect(a,2,b-a-1,h-4);
    g.fillStyle='#c9a0ff';g.font='600 10px ui-monospace,Menlo,monospace';
    if(b-a>18)g.fillText(c.chord,a+3,h/2+4)})});

lane('lyrics','243 words, Whisper',24,(g,w,h)=>{
  const VS=(SOBS.vocal_silence&&SOBS.vocal_silence.spans)||[];
  VS.forEach(s=>{g.fillStyle='rgba(255,255,255,.04)';
    g.fillRect(X(s.from),0,X(s.to)-X(s.from),h)});
  g.font='10px ui-sans-serif';g.fillStyle='#ffd166';
  let lastx=-99;
  const WD=(SOBS.lyrics&&SOBS.lyrics.words); if(!WD) return;
  WD.forEach(wd=>{const x=X(wd.at);
    if(x-lastx<7) return; g.fillText(wd.word,x,h-7); lastx=x+wd.word.length*5.2})});

lane('stereo','width & pan',30,(g,w,h)=>{
  const st=(SOBS.stereo&&SOBS.stereo.mix); if(!st||!st.width||!st.pan) return;
  g.strokeStyle='#5b8cff';g.lineWidth=1.2;g.beginPath();
  st.width.forEach((v,i)=>{const x=X(DOWNS[i]),y=h-2-(h-5)*v;i?g.lineTo(x,y):g.moveTo(x,y)});
  g.stroke();
  g.strokeStyle='#ff7a2f';g.lineWidth=1.2;g.beginPath();
  st.pan.forEach((v,i)=>{const x=X(DOWNS[i]),y=h/2-(h/2-3)*(v*3);i?g.lineTo(x,y):g.moveTo(x,y)});
  g.stroke();
  g.strokeStyle='rgba(255,255,255,.12)';g.beginPath();g.moveTo(0,h/2);g.lineTo(w,h/2);g.stroke()});

lane('brightness','centroid per stem',30,(g,w,h)=>{
  const BS=(SOBS.brightness&&SOBS.brightness.sources); if(!BS) return;
  Object.keys(STEMC).forEach(k=>{const v=BS[k]; if(!v) return;
    g.strokeStyle=gr(hexrgb(STEMC[k]),0.55);g.lineWidth=1;g.beginPath();
    shown.forEach((_,i)=>{const x=X(DOWNS[i]),yy=h-2-(h-5)*y01(i);i?g.lineTo(x,yy):g.moveTo(x,yy)});
    g.stroke()})});

function hexrgb(hx){const n=parseInt(hx.slice(1),16);
  return ((n>>16)&255)+','+((n>>8)&255)+','+(n&255)}

