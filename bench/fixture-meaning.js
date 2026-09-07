const fs=require('fs');
const song=process.argv[2]||'levels';
const M=JSON.parse(fs.readFileSync('/tmp/claude-1001/cmp_'+song+'.json','utf8'));
const L=JSON.parse(fs.readFileSync('readers/lights/festival/layout.json','utf8'));
global.MAP=M;global.LAYOUT=L;global.ENERGY='medium';global.STOP_REAL=true;global.ANT=true;global.HAZE=0.28;global.DRIFT=true;
global.PER=M.period;global.PH=M.phase;global.DUR=M.dur;global.DBP=M.bar_phase;global.BAR=4*M.period;global.BEATS=[];
for(let t=M.phase;t<M.dur;t+=M.period)BEATS.push(+t.toFixed(4));
global.CH=M.chapters.map(c=>c.slice());
global.SP=M.spans.map(s=>({kind:s[0],from:s[1],to:s[2],rise:s[3]}));
global.MO=M.moments.map(m=>({at:m[0],kind:m[1],v:m[2]}));
global.EN=M.energy;
(0,eval)(fs.readFileSync('readers/src/recipe4.js','utf8')+
  ';global.frame=frame;global.en_=en;global.stem_=stem;global.voxAt_=voxAt;global.meloAt_=meloAt;');
const FPS=25,N=Math.floor(DUR*FPS);
// musical reference signals
const ACC=(M.accents&&M.accents.events)||[];
function envOf(pred,decay){
  const a=new Float64Array(N);
  for(const e of ACC){ if(!pred(e)) continue; const i=Math.round(e.at*FPS); if(i<0||i>=N) continue;
    a[i]=Math.max(a[i], e.strength||0.5) }
  for(let i=1;i<N;i++) a[i]=Math.max(a[i], a[i-1]*decay);
  return a;
}
const SIG={
  kick:  envOf(e=>e.of==='kick', 0.86),
  snare: envOf(e=>e.of==='snare', 0.86),
  hat:   envOf(e=>e.of==='hat'||e.of==='hihat', 0.80),
  any:   envOf(()=>true, 0.86),
};
const cont={energy:[],bass:[],drums:[],other:[],voice:[],melody:[]};
for(let i=0;i<N;i++){ const t=i/FPS;
  cont.energy.push(en_(t)); cont.bass.push(stem_('bass',t)); cont.drums.push(stem_('drums',t));
  cont.other.push(stem_('other',t)); cont.voice.push(voxAt_(t)); cont.melody.push(meloAt_(t)); }
for(const k in SIG) cont[k]=Array.from(SIG[k]);
function resid(y, x){
  const n=Math.min(y.length,x.length);
  let my=0,mx=0; for(let i=0;i<n;i++){my+=y[i];mx+=x[i]} my/=n;mx/=n;
  let num=0,den=0;
  for(let i=0;i<n;i++){const dx=x[i]-mx;num+=dx*(y[i]-my);den+=dx*dx}
  const b1=den>1e-9?num/den:0;
  const out=new Array(n);
  for(let i=0;i<n;i++) out[i]=(y[i]-my)-b1*(x[i]-mx);
  return out;
}
function corr(a,b){
  const n=Math.min(a.length,b.length);
  let ma=0,mb=0; for(let i=0;i<n;i++){ma+=a[i];mb+=b[i]} ma/=n;mb/=n;
  let num=0,da=0,db=0;
  for(let i=0;i<n;i++){const x=a[i]-ma,y=b[i]-mb;num+=x*y;da+=x*x;db+=y*y}
  return (da>1e-9&&db>1e-9)? num/Math.sqrt(da*db) : 0;
}
const series={}; L.fixtures.forEach(f=>series[f.id]=[]);
for(let i=0;i<N;i++){
  const f=frame(i/FPS);
  for(const o of f.fixtures){ if(!series[o.id]) continue;
    let v=o.level||0;
    if(o.pixels&&o.pixels.length){let m=0;for(const q of o.pixels)m=Math.max(m,(q[0]+q[1]+q[2])/765);v=Math.max(v,m)}
    series[o.id].push(v) }
}
console.log('\n=== '+song+': what each fixture follows once energy is removed ===');
const rows=[]; let unexplained=0;
for(const f of L.fixtures){
  const s=series[f.id];
  const sr=resid(s, cont.energy);
  let best='-', br=0;
  for(const k in cont){ if(k==='energy') continue;
    const r=corr(sr, resid(cont[k], cont.energy));
    if(Math.abs(r)>Math.abs(br)){br=r;best=k} }
  rows.push({id:f.id,kind:f.kind,best,r:br});
  if(Math.abs(br)<0.18) unexplained++;
}
const byKind={};
for(const r of rows){ (byKind[r.kind]=byKind[r.kind]||[]).push(r) }
for(const k of Object.keys(byKind)){
  const g=byKind[k];
  const drivers={}; g.forEach(x=>drivers[x.best]=(drivers[x.best]||0)+1);
  const mean=g.reduce((a,b)=>a+Math.abs(b.r),0)/g.length;
  const weak=g.filter(x=>Math.abs(x.r)<0.18).length;
  console.log('  '+k.padEnd(9)+String(g.length).padStart(2)+'  follows '+
    Object.keys(drivers).sort((a,b)=>drivers[b]-drivers[a]).map(d=>d+'x'+drivers[d]).join(' ').padEnd(30)+
    ' |r| '+mean.toFixed(2)+(weak?('   '+weak+' UNEXPLAINED'):''));
}
const EVENTY=['blinder','strobe','co2','confetti','pyro','laser','video','fog'];
const cont2=rows.filter(r=>EVENTY.indexOf(r.kind)<0);
const weakCont=cont2.filter(r=>Math.abs(r.r)<0.18).length;
console.log('  continuous fixtures explained: '+(cont2.length-weakCont)+'/'+cont2.length+
  '   event fixtures (not correlation-testable): '+(rows.length-cont2.length));
