/* "Even if we remove the song, it would go the same way."

   That is a claim about SIMILARITY, and every metric I reached for first
   measured difference instead, which is not the same question: two rotating
   chases at different phases differ maximally in bytes and are equally
   unmusical. So: run the show twice, once on the real map and once on a map
   with the grid and nothing else, and correlate each fixture's own level
   against itself across the two runs.

     corr near 1  ->  that fixture does the same thing on silence. The record
                      is not reaching it.
     corr near 0  ->  what it does is coming from the record.

   Correlation, not difference, so a constant offset or a scale change does not
   hide behind it -- only the SHAPE over time counts, which is what an audience
   sees. */
const fs=require('fs'), path=require('path'), cp=require('child_process');
const ROOT=path.resolve(__dirname,'..');
const RECIPE=fs.readFileSync(path.join(ROOT,'readers/src/recipe4.js'),'utf8');
const RIG=JSON.parse(fs.readFileSync(path.join(ROOT,'readers/lights/festival/layout.json'),'utf8'));
const SONGS=process.argv[2]?[process.argv[2]]:['levels','the-nights','mizhiyoram','starlight','dont-look-down'];
const mapPath=s=>{const f=path.join(ROOT,'maps/model/'+s+'.full.map.json');
  return fs.existsSync(f)?f:path.join(ROOT,'maps/model/'+s+'.map.json')};
function compact(m){
  return JSON.parse(cp.execFileSync('python3',['-c',
    'import sys,json;sys.path.insert(0,sys.argv[1]);from compact import compact;'+
    'print(json.dumps(compact(json.load(sys.stdin))))', path.join(ROOT,'readers/src')],
    {input:JSON.stringify(m), maxBuffer:1<<28}).toString());
}
const strip=m=>({grid:m.grid, beats:m.beats, downbeats:m.downbeats, song:m.song,
                 chapters:[], spans:[], moments:[], energy:[], made_by:m.made_by});
function series(cm){
  const g={MAP:cm,LAYOUT:RIG,ENERGY:'medium',STOP_REAL:true,ANT:true,HAZE:0.28,DRIFT:true,
    PER:cm.period,PH:cm.phase,DUR:cm.dur,DBP:cm.bar_phase,BAR:4*cm.period,BEATS:[],
    CH:(cm.chapters&&cm.chapters.length?cm.chapters:[[0,'verse']]).map(c=>c.slice()),
    SP:(cm.spans||[]).map(s=>({kind:s[0],from:s[1],to:s[2],rise:s[3]})),
    MO:(cm.moments||[]).map(m=>({at:m[0],kind:m[1],v:m[2]})), EN:cm.energy||[]};
  for(let t=cm.phase;t<cm.dur;t+=cm.period) g.BEATS.push(+t.toFixed(4));
  for(const k in g) global[k]=g[k];
  (0,eval)(RECIPE+';global.__frame=frame;global.__fam=(typeof fam==="function")?fam:(f=>f.kind);');
  const STEP=0.05, T=[]; for(let t=0;t<g.DUR;t+=STEP) T.push(t);
  const lv={}, pn={};
  for(const f of RIG.fixtures){ lv[f.id]=new Float64Array(T.length); pn[f.id]=new Float64Array(T.length) }
  for(let i=0;i<T.length;i++){
    const fr=global.__frame(T[i]);
    for(const o of fr.fixtures){ if(!lv[o.id]) continue;
      let v=o.level||0;
      if(o.pixels&&o.pixels.length){let m=0;for(const q of o.pixels)m=Math.max(m,(q[0]+q[1]+q[2])/765);v=Math.max(v,m)}
      lv[o.id][i]=v; if(o.pan!==undefined) pn[o.id][i]=o.pan }
  }
  return {lv,pn,fam:global.__fam};
}
function corr(a,b){
  const n=Math.min(a.length,b.length);
  let ma=0,mb=0; for(let i=0;i<n;i++){ma+=a[i];mb+=b[i]} ma/=n; mb/=n;
  let num=0,da=0,db=0;
  for(let i=0;i<n;i++){const x=a[i]-ma,y=b[i]-mb; num+=x*y; da+=x*x; db+=y*y}
  if(da<1e-12||db<1e-12) return NaN;
  return num/Math.sqrt(da*db);
}
console.log('\n=== what survives when the song is taken away? ===');
console.log('  per-fixture correlation between the real show and a grid-only map');
console.log('  1.00 = identical behaviour on silence   0.00 = fully song-driven\n');
console.log('  '+'song'.padEnd(16)+'family'.padEnd(10)+'level corr'.padStart(12)+'pan corr'.padStart(11));
const all=[];
for(const song of SONGS){
  const raw=JSON.parse(fs.readFileSync(mapPath(song),'utf8'));
  const A=series(compact(raw));
  const B=series(compact(strip(raw)));
  const byFam={};
  for(const f of RIG.fixtures){
    const fm=A.fam(f); if(fm==='fog') continue;
    const cl_=corr(A.lv[f.id],B.lv[f.id]);
    const cp_=corr(A.pn[f.id],B.pn[f.id]);
    (byFam[fm]=byFam[fm]||[]).push([cl_,cp_]);
  }
  for(const fm of Object.keys(byFam).sort()){
    const q=byFam[fm];
    const av=i=>{const r=q.filter(x=>!Number.isNaN(x[i]));
      return r.length? r.reduce((x,y)=>x+y[i],0)/r.length : NaN};
    const a=av(0), b=av(1);
    const f3=x=>Number.isNaN(x)?'    --':x.toFixed(3);
    console.log('  '+song.padEnd(16)+fm.padEnd(10)+f3(a).padStart(12)+f3(b).padStart(11)+
      (a>0.7?'   <-- barely hears the record':''));
    if(!Number.isNaN(a)) all.push(a);
  }
}
console.log('\n  mean level correlation with the silent show: '+
  (all.reduce((x,y)=>x+y,0)/Math.max(1,all.length)).toFixed(3));
