/* Which fixtures flicker, how fast, and whether anything in the music asked.

   Flicker is not brightness and it is not movement, so nothing measured so far
   could see it. It is a fixture reversing direction faster than an eye reads as
   one gesture. Above about 4 Hz a level change stops being a pulse and becomes
   a flutter, and a rig full of flutter looks broken however musical the numbers
   underneath it are.

   Two counts per fixture:
     reversals/s  -- direction changes in level. A clean pulse has 2 per cycle.
     on-off/s     -- crossings of a visibility threshold, which is what an
                     audience actually notices.
   And for each, whether an accent of that fixture's own instrument was inside
   40 ms of it. A reversal with a hit behind it is a pulse; one without is
   flicker. */
const fs=require('fs'), path=require('path'), cp=require('child_process');
const ROOT=path.resolve(__dirname,'..');
const RECIPE=fs.readFileSync(path.join(ROOT,'readers/src/recipe4.js'),'utf8');
const RIG=JSON.parse(fs.readFileSync(path.join(ROOT,'readers/lights/'+(process.env.RIG||'festival')+'/layout.json'),'utf8'));
const SONGS=process.argv[2]?[process.argv[2]]:['levels','the-nights','mizhiyoram','starlight','dont-look-down'];
const mp=s=>{const f=path.join(ROOT,'maps/model/'+s+'.full.map.json');
  return fs.existsSync(f)?f:path.join(ROOT,'maps/model/'+s+'.map.json')};
const FPS=100, ON=0.06;
for(const song of SONGS){
  const raw=JSON.parse(fs.readFileSync(mp(song),'utf8'));
  const cm=JSON.parse(cp.execFileSync('python3',['-c',
    'import sys,json;sys.path.insert(0,sys.argv[1]);from compact import compact;'+
    'print(json.dumps(compact(json.load(open(sys.argv[2])))))',
    path.join(ROOT,'readers/src'), mp(song)],{maxBuffer:1<<28}).toString());
  const g={MAP:cm,LAYOUT:RIG,ENERGY:'medium',STOP_REAL:true,ANT:true,HAZE:0.28,DRIFT:true,
    PER:cm.period,PH:cm.phase,DUR:cm.dur,DBP:cm.bar_phase,BAR:4*cm.period,BEATS:[],
    CH:cm.chapters.map(c=>c.slice()),SP:cm.spans.map(s=>({kind:s[0],from:s[1],to:s[2],rise:s[3]})),
    MO:cm.moments.map(m=>({at:m[0],kind:m[1],v:m[2]})),EN:cm.energy};
  for(let t=cm.phase;t<cm.dur;t+=cm.period) g.BEATS.push(+t.toFixed(4));
  for(const k in g) global[k]=g[k];
  (0,eval)(RECIPE+';global.frame=frame;global.__fam=(typeof fam==="function")?fam:(f=>f.kind);'+
           'global.__parts=(typeof FAMILY_PARTS!=="undefined")?FAMILY_PARTS:null;');
  // every accent time, by band
  const byBand={};
  for(const a of ((raw.accents&&raw.accents.events)||[])){
    if(typeof a.at!=='number') continue;
    (byBand[a.of]=byBand[a.of]||[]).push(a.at);
  }
  for(const b in byBand) byBand[b].sort((x,y)=>x-y);
  const nearHit=(bands,t)=>{
    for(const b of (bands||[])){
      const arr=byBand[b]; if(!arr||!arr.length) continue;
      let lo=0,hi=arr.length-1,best=Infinity;
      while(lo<=hi){const m=(lo+hi)>>1; const d=arr[m]-t;
        if(Math.abs(d)<Math.abs(best))best=d; if(d<0)lo=m+1; else hi=m-1}
      if(Math.abs(best)<=0.05) return true;
    }
    return false;
  };
  const N=Math.floor(g.DUR*FPS);
  const lv={}; for(const f of RIG.fixtures) lv[f.id]=new Float32Array(N);
  for(let i=0;i<N;i++){
    const fr=global.frame(i/FPS);
    for(const o of fr.fixtures){ if(!lv[o.id]) continue;
      let v=o.level||0;
      if(o.pixels&&o.pixels.length){let m=0;for(const q of o.pixels)m=Math.max(m,(q[0]+q[1]+q[2])/765);v=Math.max(v,m)}
      lv[o.id][i]=v }
  }
  const fam={};
  for(const f of RIG.fixtures){
    if(f.emits!=='light') continue;
    const F=global.__fam(f), y=lv[f.id];
    const bands=global.__parts?global.__parts[F]:null;
    let rev=0, onoff=0, unexplained=0;
    for(let i=2;i<N-1;i++){
      const d0=y[i]-y[i-1], d1=y[i+1]-y[i];
      if(d0>1e-4 && d1<-1e-4 || d0<-1e-4 && d1>1e-4){ rev++;
        if(!nearHit(bands, i/FPS)) unexplained++ }
      if((y[i-1]<ON)!==(y[i]<ON)) onoff++;
    }
    fam[F]=fam[F]||{n:0,rev:0,onoff:0,unex:0};
    fam[F].n++; fam[F].rev+=rev/g.DUR; fam[F].onoff+=onoff/g.DUR; fam[F].unex+=unexplained/g.DUR;
  }
  console.log('\n=== '+song+' ===');
  console.log('  '+'family'.padEnd(10)+'n'.padStart(4)+'reversals/s'.padStart(13)+
              'on-off/s'.padStart(10)+'  no hit behind them');
  for(const k of Object.keys(fam).sort((a,b)=>fam[b].rev/fam[b].n-fam[a].rev/fam[a].n)){
    const q=fam[k];
    const r=q.rev/q.n, oo=q.onoff/q.n, u=q.unex/q.n;
    console.log('  '+k.padEnd(10)+String(q.n).padStart(4)+r.toFixed(2).padStart(13)+
      oo.toFixed(2).padStart(10)+'   '+(r>0?(100*u/r).toFixed(0):'0')+'%'+
      (r>4?'   <-- FLUTTER':''));
  }
}
