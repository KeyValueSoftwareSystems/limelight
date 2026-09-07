const fs=require('fs'), cp=require('child_process');
const song=process.argv[2]||'levels';
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
const L=JSON.parse(fs.readFileSync('readers/lights/festival/layout.json','utf8'));
global.MAP=M;global.LAYOUT=L;global.ENERGY='medium';global.STOP_REAL=true;global.ANT=true;global.HAZE=0.28;global.DRIFT=true;
global.PER=M.period;global.PH=M.phase;global.DUR=M.dur;global.DBP=M.bar_phase;global.BAR=4*M.period;global.BEATS=[];
for(let t=M.phase;t<M.dur;t+=M.period)BEATS.push(+t.toFixed(4));
global.CH=M.chapters.map(c=>c.slice());
global.SP=M.spans.map(s=>({kind:s[0],from:s[1],to:s[2],rise:s[3]}));
global.MO=M.moments.map(m=>({at:m[0],kind:m[1],v:m[2]}));
global.EN=M.energy;
(0,eval)(fs.readFileSync('readers/src/recipe4.js','utf8')+';global.frame=frame;global.PL=primaryLook;');
const KOF={};L.fixtures.forEach(f=>KOF[f.id]=f.kind);
const BEAM=['par','head','wash','uplight','strip'];
const FPS=50,N=Math.floor(DUR*FPS),ON=0.16,OFF=0.06;
const st={}, byLook={};
for(let i=0;i<N;i++){
  const t=i/FPS, Lk=PL(t), f=frame(t);
  let sw=0, n=0;
  for(const o of f.fixtures){
    if(BEAM.indexOf(KOF[o.id])<0) continue;
    let v=o.level||0;
    if(o.pixels&&o.pixels.length){let m=0;for(const q of o.pixels)m=Math.max(m,(q[0]+q[1]+q[2])/765);v=Math.max(v,m)}
    const was=st[o.id]||false, is=was?(v>OFF):(v>ON);
    if(is!==was) sw++;
    st[o.id]=is; n++;
  }
  const B=byLook[Lk]=byLook[Lk]||{f:0,sw:0,n:n};
  B.f++; B.sw+=sw;
}
console.log('\n=== '+song+' — handover, and what the music offers ===');
const per=PER, bpm=60/per;
console.log('  '+bpm.toFixed(0)+' bpm: a bar = '+(1/(4*per)).toFixed(2)+'/s, 1/4 = '+(1/per).toFixed(2)+
            '/s, 1/8 = '+(2/per).toFixed(2)+'/s, 1/16 = '+(4/per).toFixed(2)+'/s (per fixture)');
console.log('  look        time    rig switches/s   per fixture/s   nearest subdivision');
const names=[['1 bar',1/(4*per)],['1/2 bar',2/(4*per)],['1/4',1/per],['1/8',2/per],['1/16',4/per]];
for(const k of Object.keys(byLook).sort((a,b)=>byLook[b].f-byLook[a].f)){
  const B=byLook[k]; if(B.f<20) continue;
  const rig=B.sw/(B.f/FPS), pf=rig/B.n;
  let best='-',bd=1e9;
  for(const [nm,hz] of names){ const d=Math.abs(Math.log((pf||1e-6)/hz)); if(d<bd){bd=d;best=nm} }
  console.log('  '+k.padEnd(11)+(100*B.f/N).toFixed(0).padStart(4)+'%'+
    rig.toFixed(1).padStart(14)+pf.toFixed(2).padStart(16)+'   '+best+
    (pf > 4/per*1.15 ? '   FASTER THAN A 16TH' : ''));
}
