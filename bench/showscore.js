const fs=require('fs'), cp=require('child_process');
const SONGS=['levels','the-nights','mizhiyoram','starlight','dont-look-down'];
function setup(song){
  const M=JSON.parse(fs.readFileSync('/tmp/claude-1001/cmp_'+song+'.json','utf8'));
  const L=JSON.parse(fs.readFileSync('readers/lights/festival/layout.json','utf8'));
  global.MAP=M; global.LAYOUT=L; global.ENERGY='medium';
  global.STOP_REAL=true; global.ANT=true; global.HAZE=0.28; global.DRIFT=true;
  global.PER=M.period; global.PH=M.phase; global.DUR=M.dur; global.DBP=M.bar_phase;
  global.BAR=4*M.period; global.BEATS=[];
  for(let t=M.phase;t<M.dur;t+=M.period) BEATS.push(+t.toFixed(4));
  global.CH=M.chapters.map(c=>c.slice());
  global.SP=M.spans.map(s=>({kind:s[0],from:s[1],to:s[2],rise:s[3]}));
  global.MO=M.moments.map(m=>({at:m[0],kind:m[1],v:m[2]}));
  global.EN=M.energy;
  (0,eval)(fs.readFileSync('readers/src/recipe4.js','utf8')+
    ';global.frame=frame;global.en_=en;global.SD_=SONG_DRIVE;');
  return {M,L};
}
function cl01(x){return x<0?0:x>1?1:x}
function band(x,lo,hi){ return x<lo?0:x>hi?1:(x-lo)/(hi-lo) }
function peakAt(x,target,tol){ const d=Math.abs(x-target)/tol; return Math.max(0,1-d) }
const out=[];
for(const song of SONGS){
  for(const k in require.cache) delete require.cache[k];
  const {M,L}=setup(song);
  const KOF={}; L.fixtures.forEach(f=>KOF[f.id]=f.kind);
  const BEAMY=id=>{const k=KOF[id]; return k!=='fog'&&k!=='video'};
  const FPS=50,N=Math.floor(DUR*FPS);
  const tot=new Float64Array(N), act=new Float64Array(N);
  const hues={}; let hn=0, jumps=0, cmp=0;
  let prev=null;
  for(let i=0;i<N;i++){
    const f=frame(i/FPS); let s=0,n=0,a=0,mxd=0; const cur={};
    for(const o of f.fixtures){
      let v=o.level||0;
      if(o.pixels&&o.pixels.length){let m=0;for(const q of o.pixels)m=Math.max(m,(q[0]+q[1]+q[2])/765);v=Math.max(v,m)}
      cur[o.id]=v;
      if(BEAMY(o.id)){ s+=v; n++ }
      if(prev&&prev[o.id]!==undefined){const d=Math.abs(v-prev[o.id]); a+=d; if(d>mxd)mxd=d}
      if(o.r!==undefined&&v>0.18){
        const r=o.r,g=o.g,b=o.b,mx=Math.max(r,g,b),mn=Math.min(r,g,b);
        let nm='white';
        if(mx-mn>15){let h;if(mx===r)h=60*(((g-b)/(mx-mn))%6);else if(mx===g)h=60*((b-r)/(mx-mn)+2);else h=60*((r-g)/(mx-mn)+4);
          h=(h+360)%360; nm=(h>=330||h<25)?'red':h<70?'amber':h<170?'GREEN':h<200?'cyan':h<250?'blue':h<292?'violet':'magenta'}
        hues[nm]=(hues[nm]||0)+1; hn++;
      }
    }
    tot[i]=n?s/n:0; act[i]=n?a/n*FPS:0; if(mxd>0.25) jumps++; prev=cur; cmp+=n;
  }
  const srt=Array.from(tot).sort((a,b)=>a-b);
  const dark=Array.from(tot).filter(v=>v<0.045).length/N;
  const blaze=Array.from(tot).filter(v=>v>0.45).length/N;
  const p50=srt[Math.floor(N*0.5)]||1e-6, p95=srt[Math.floor(N*0.95)];
  const range=p95/Math.max(1e-6,p50);
  const mid=Array.from(tot).filter(v=>v>=0.10&&v<=0.35).length/N;
  // pulse: rises of total light near beats
  const d=new Float64Array(N); for(let i=1;i<N;i++) d[i]=tot[i]-tot[i-1];
  const pk=[]; for(let i=2;i<N-2;i++) if(d[i]>d[i-1]&&d[i]>=d[i+1]&&d[i]>0) pk.push([i/FPS,d[i]]);
  pk.sort((a,b)=>b[1]-a[1]);
  const strong=pk.slice(0,Math.min(pk.length,BEATS.length)).sort((a,b)=>a[0]-b[0]);
  let marked=0; for(const bt of BEATS){ for(const p of strong){ if(Math.abs(p[0]-bt)<=0.050){marked++;break} if(p[0]>bt+0.2)break } }
  let onb=0; for(const p of strong){ let best=1e9; for(const bt of BEATS){const dd=Math.abs(p[0]-bt); if(dd<best)best=dd; if(bt>p[0]+0.2)break} if(best<=0.050)onb++ }
  // activity vs energy per bar
  const rows=[];
  for(let t=PH;t<DUR-BAR;t+=BAR){
    const a=Math.floor(t*FPS), b=Math.min(N,Math.floor((t+BAR)*FPS)); if(b-a<4) continue;
    let sa=0; for(let i=a;i<b;i++) sa+=act[i];
    rows.push([en_(t+BAR/2), sa/(b-a)]);
  }
  const z=v=>{const m=v.reduce((x,y)=>x+y,0)/v.length,sd=Math.sqrt(v.reduce((x,y)=>x+(y-m)*(y-m),0)/v.length)||1;return v.map(x=>(x-m)/sd)};
  const ze=z(rows.map(r=>r[0])), za=z(rows.map(r=>r[1]));
  let r=0; for(let i=0;i<ze.length;i++) r+=ze[i]*za[i]; r/=ze.length;
  const green=(hues.GREEN||0)/Math.max(1,hn);
  // craft terms, from how designers describe the moves
  const drops=MO.filter(x=>x.kind==='drop').map(x=>x.at).sort((a,b)=>a-b);
  let killed=0;
  for(const dt of drops){
    const j=Math.round(dt*FPS);
    let lo=1e9; for(let i=Math.max(0,j-Math.round(0.5*PER*FPS));i<j;i++) lo=Math.min(lo,tot[i]);
    let ref=0,n2=0; for(let i=Math.max(0,j-Math.round(2*BAR*FPS));i<j-Math.round(0.5*PER*FPS);i++){ref+=tot[i];n2++}
    ref=n2?ref/n2:1;
    if(ref>1e-6 && lo < 0.18*ref) killed++;
  }
  // build gesture: saturation should fall and beams narrow across a build
  let bg=[], zg=[];
  for(const sp of SP){
    if(sp.kind!=='build'||!(sp.to>sp.from+1)) continue;
    const samp=k=>{
      const t=sp.from+(sp.to-sp.from)*k, f=frame(t);
      let sat=0,zc=0,zo=0,zn=0;
      for(const o of f.fixtures){
        if(o.r!==undefined&&(o.level||0)>0.15){const mx=Math.max(o.r,o.g,o.b),mn=Math.min(o.r,o.g,o.b);
          if(mx>10){sat+=(mx-mn)/mx;zc++}}
        if(o.zoom!==undefined){zo+=o.zoom;zn++}
      }
      return [zc?sat/zc:0, zn?zo/zn:0];
    };
    const a1=samp(0.12), b1=samp(0.92);
    if(a1[0]>0.05) bg.push(cl01(1-(b1[0]/a1[0])));
    if(a1[1]>0.02) zg.push(cl01((a1[1]-b1[1])/a1[1]));
  }
  const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
  // strobe discipline: rare, and at a musical rate
  let sf=0, smus=0, sn=0;
  for(let i=0;i<N;i+=5){
    const f=frame(i/FPS);
    for(const o of f.fixtures){ if(o.strobe>0.05){ sf++; sn++;
      const ratio=o.strobe*PER; const near=Math.abs(ratio-Math.round(ratio*4)/4);
      if(near<0.06) smus++; break } }
  }
  const strobeShare=sf/Math.max(1,Math.floor(N/5));
  const jr=jumps/N;
  const drive=SD_;
  const S={
    dark:   peakAt(dark, 0.20, 0.22),
    range:  band(range, 1.8, 4.2),
    midless:1-band(mid, 0.35, 0.75),
    marked: band(marked/BEATS.length, 0.30, 0.80),
    onbeat: band(onb/Math.max(1,strong.length), 0.35, 0.85),
    follow: band(r, 0.45, 0.90),
    calm:   drive>0.45 ? peakAt(jr, 0.09, 0.09) : peakAt(jr, 0.02, 0.04),
    hue:    1-band(green, 0.005, 0.05),
    kill:   drops.length ? killed/drops.length : 1,
    build:  bg.length ? mean(bg) : 0.5,
    beam:   zg.length ? mean(zg) : 0.5,
    strobe: (sn ? smus/sn : 1) * (1 - band(strobeShare, 0.06, 0.30)),
  };
  const W={dark:1.6, range:1.4, midless:1.2, marked:1.4, onbeat:1.2, follow:1.3, calm:1.0, hue:0.8,
           kill:1.5, build:1.5, beam:1.0, strobe:1.0};
  let num=0,den=0; for(const k in S){num+=S[k]*W[k];den+=W[k]}
  out.push({song, total:num/den, S,
    raw:{dark:dark,range:range,mid:mid,marked:marked/BEATS.length,
         onbeat:onb/Math.max(1,strong.length),r:r,jr:jr,green:green}});
}
let g=0;
console.log('  song            SCORE  dark blaze  mid  markd onbeat follow calm  hue');
for(const o of out){
  g+=o.total;
  console.log('  '+o.song.padEnd(15)+o.total.toFixed(3)+'  '+
    Object.keys(o.S).map(k=>o.S[k].toFixed(2)).join(' '));
}
console.log('  TOTAL           '+(g/out.length).toFixed(4));
console.log('  raw: '+out.map(o=>o.song.slice(0,4)+' dk'+(100*o.raw.dark).toFixed(0)+' rg'+o.raw.range.toFixed(1)+
  ' mid'+(100*o.raw.mid).toFixed(0)+' mk'+(100*o.raw.marked).toFixed(0)+' ob'+(100*o.raw.onbeat).toFixed(0)+
  ' r'+o.raw.r.toFixed(2)+' j'+(100*o.raw.jr).toFixed(1)).join(' | '));
