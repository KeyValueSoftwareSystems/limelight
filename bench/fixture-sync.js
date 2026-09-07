const fs=require('fs'), cp=require('child_process');
const song=process.argv[2]||'levels', rig=process.argv[3]||'festival';
/* Compacted straight from maps/model, never from a cached copy: a tool reading
   a stale snapshot of the thing it measures reports on a map that no longer
   exists. */
function mapPath(song){
  const full='maps/model/'+song+'.full.map.json';
  return fs.existsSync(full) ? full : 'maps/model/'+song+'.map.json';
}
function loadMap(song){
  return JSON.parse(cp.execFileSync('python3',['-c',
    'import sys,json;sys.path.insert(0,"readers/src");from compact import compact;'+
    'print(json.dumps(compact(json.load(open(sys.argv[1])))))', mapPath(song)],
    {maxBuffer:1<<28}).toString());
}
const M=loadMap(song);
const L=JSON.parse(fs.readFileSync('readers/lights/'+rig+'/layout.json','utf8'));
global.MAP=M;global.LAYOUT=L;global.ENERGY='medium';global.STOP_REAL=true;global.ANT=true;global.HAZE=0.28;global.DRIFT=true;
global.PER=M.period;global.PH=M.phase;global.DUR=M.dur;global.DBP=M.bar_phase;global.BAR=4*M.period;global.BEATS=[];
for(let t=M.phase;t<M.dur;t+=M.period)BEATS.push(+t.toFixed(4));
global.CH=M.chapters.map(c=>c.slice());
global.SP=M.spans.map(s=>({kind:s[0],from:s[1],to:s[2],rise:s[3]}));
global.MO=M.moments.map(m=>({at:m[0],kind:m[1],v:m[2]}));
global.EN=M.energy;
(0,eval)(fs.readFileSync('readers/src/recipe4.js','utf8')+';global.frame=frame;');
const EV=(M.accents&&M.accents.events)||[];
const of=b=>EV.filter(e=>e.of===b).map(e=>e.at).sort((a,b)=>a-b);
// what each family is supposed to be answering
const ASSIGNED={par:['kick','drums'],uplight:['bass'],head:['other','vocals'],
                wash:['piano','other'],strip:['guitar','snare'],
                blinder:['kick'],strobe:['kick'],laser:['kick'],
                co2:['kick'],confetti:['kick'],pyro:['kick'],video:['other'],fog:[]};
const SIG={};
for(const k in ASSIGNED){ const all=[]; for(const b of ASSIGNED[k]) all.push(...of(b));
  SIG[k]=all.sort((a,b)=>a-b) }
const KOF={};L.fixtures.forEach(f=>KOF[f.id]=f.kind);
const FPS=200,N=Math.floor(DUR*FPS);
const lv={};L.fixtures.forEach(f=>lv[f.id]=new Float32Array(N));
for(let i=0;i<N;i++){
  const f=frame(i/FPS);
  for(const o of f.fixtures){ if(!lv[o.id])continue;
    let v=o.level||0;
    if(o.pixels&&o.pixels.length){let m=0;for(const q of o.pixels)m=Math.max(m,(q[0]+q[1]+q[2])/765);v=Math.max(v,m)}
    lv[o.id][i]=v }
}
function near(arr,x){let lo=0,hi=arr.length-1,b=Infinity;
  while(lo<=hi){const m=(lo+hi)>>1;const d=arr[m]-x;if(Math.abs(d)<Math.abs(b))b=d;if(d<0)lo=m+1;else hi=m-1}return b}
console.log('\n=== '+song+': is each fixture in time with ITS instrument? ===');
console.log('  kind        n   rises  within 40ms  median lag');
let tot=0,hit=0,allLags=[];
const byKind={};
for(const f of L.fixtures){
  const sig=SIG[f.kind]; if(!sig||!sig.length) continue;
  const a=lv[f.id]; let mx=0; for(let i=0;i<N;i++) if(a[i]>mx)mx=a[i];
  if(mx<0.06) continue;
  const thr=mx*0.35; const lags=[];
  for(let i=2;i<N-2;i++){
    if(a[i]>=thr && a[i-1]<thr){ const d=near(sig,i/FPS); if(Math.abs(d)<0.35) lags.push(d) }
  }
  if(lags.length<4) continue;
  const B=byKind[f.kind]=byKind[f.kind]||{n:0,r:0,h:0,lags:[]};
  B.n++; B.r+=lags.length;
  for(const d of lags){ B.lags.push(d); allLags.push(d); tot++; if(Math.abs(d)<=0.040){B.h++;hit++} }
}
for(const k of Object.keys(byKind)){
  const B=byKind[k]; B.lags.sort((a,b)=>a-b);
  const med=B.lags[Math.floor(B.lags.length/2)]*1000;
  console.log('  '+k.padEnd(10)+String(B.n).padStart(3)+String(B.r).padStart(7)+
    (100*B.h/B.r).toFixed(0).padStart(11)+'%'+med.toFixed(0).padStart(11)+' ms');
}
allLags.sort((a,b)=>a-b);
const SUSTAIN=['wash','uplight','fog','video'];
let ht=0,hh=0,hl=[];
for(const k of Object.keys(byKind)){ if(SUSTAIN.indexOf(k)>=0) continue;
  ht+=byKind[k].r; hh+=byKind[k].h; hl=hl.concat(byKind[k].lags) }
hl.sort((a,b)=>a-b);
console.log('  HITTERS          '+ht+'   '+(100*hh/ht).toFixed(1)+'% within 40ms   median '+
  (hl[Math.floor(hl.length/2)]*1000).toFixed(0)+' ms   (beds excluded: they sustain, they do not hit)');
console.log('  ALL              '+tot+'   '+(100*hit/tot).toFixed(1)+'% within 40ms   median '+
  (allLags[Math.floor(allLags.length/2)]*1000).toFixed(0)+' ms');
