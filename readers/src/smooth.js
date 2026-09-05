const fs=require('fs'), path=require('path'), cp=require('child_process');
const ROOT=path.resolve(__dirname,'../..');
const mapArg=process.argv[2], rigArg=process.argv[3]||'festival';
function findMap(){
  if(mapArg) return mapArg;
  for(const p of ['maps/model/the-nights.map.json','the-nights.map.json'])
    if(fs.existsSync(path.join(ROOT,p))) return path.join(ROOT,p);
  const d=path.join(ROOT,'maps/model');
  const f=fs.existsSync(d)&&fs.readdirSync(d).filter(x=>x.endsWith('.map.json'))[0];
  if(!f) throw new Error('no map found; pass one as argv[2]');
  return path.join(d,f);
}
const MAPPATH=findMap();
const RIG=fs.existsSync(rigArg)?rigArg:path.join(ROOT,'readers/lights',rigArg,'layout.json');
const m=JSON.parse(fs.readFileSync(MAPPATH,'utf8'));
const L=JSON.parse(fs.readFileSync(RIG,'utf8'));
console.log('map '+path.relative(ROOT,MAPPATH)+'   rig '+path.relative(ROOT,RIG));
globalThis.PER=m.grid.period; globalThis.PH=m.grid.phase; globalThis.DUR=m.song.length;
globalThis.DBP=m.grid.bar_phase; globalThis.BAR=4*PER;
globalThis.BEATS=[]; for(let t=PH;t<DUR;t+=PER) BEATS.push(+t.toFixed(4));
globalThis.CH=m.chapters.map(c=>[c.at,c.name]);
globalThis.SP=m.spans.map(s=>({kind:s.kind,from:s.from,to:s.to,rise:s.rise}));
globalThis.MO=m.moments.map(x=>({at:x.at,kind:x.kind,v:x.size??x.holds}));
globalThis.EN=m.energy; globalThis.STOP_REAL=true; globalThis.ANT=true;
globalThis.LAYOUT=L;
globalThis.MAP=JSON.parse(cp.execFileSync('python3',['-c',
  'import sys,json;sys.path.insert(0,sys.argv[1]);from compact import compact;'+
  'print(json.dumps(compact(json.load(open(sys.argv[2])))))',
  path.join(ROOT,'readers/src'), MAPPATH]).toString());
eval(fs.readFileSync(path.join(ROOT,'readers/src/recipe4.js'),'utf8'));

const FPS=40, N=Math.floor(DUR*FPS);
let bad=0, prev=null, deltas=[];
const lim=L.limits;
let panMax=0, tiltMax=0, panAt=0, tiltAt=0;
for(let i=0;i<N;i++){
  const t=i/FPS, f=frame(t);
  for(const o of f.fixtures){
    if('level' in o && !(o.level>=0&&o.level<=1)){if(bad<3)console.log('BAD level',t,o);bad++}
    if('strobe' in o && !(o.strobe>=0&&o.strobe<=4.001)){if(bad<3)console.log('BAD strobe',t,o);bad++}
    for(const c of ['pan','tilt']) if(c in o && !(o[c]>=0&&o[c]<=1)){bad++}
    if(o.pixels) for(const q of o.pixels) for(const c of q) if(!(c>=0&&c<=255)) bad++;
  }
  if(prev){
    let mx=0, who='';
    for(let j=0;j<f.fixtures.length;j++){
      const a=prev.fixtures[j], b=f.fixtures[j];
      // fog is a relay, not a light: 0 or 1 is physically correct and its 9 s
      // lag means the room never sees a step. Excluded from the light metric.
      if('level' in a && a.id!=='fog_1'){const d=Math.abs(b.level-a.level); if(d>mx){mx=d;who=a.id+'.level'}}
      if(a.pixels){for(let q=0;q<a.pixels.length;q++)for(let c=0;c<3;c++){
        const d=Math.abs(b.pixels[q][c]-a.pixels[q][c])/255; if(d>mx){mx=d;who=a.id+'.px'}}}
      for(const c of ['pan','tilt']) if(c in a){
        const d=Math.abs(b[c]-a[c])*FPS;              // units per second
        if(c==='pan'&&d>panMax){panMax=d;panAt=t}
        if(c==='tilt'&&d>tiltMax){tiltMax=d;tiltAt=t}}
    }
    deltas.push([mx,t,who]);
  }
  prev=f;
}
console.log(bad?('RANGE FAIL '+bad):('range ok — '+N+' frames, '+frame(0).fixtures.length+' fixtures'));
deltas.sort((a,b)=>b[0]-a[0]);
console.log('\n=== SMOOTHNESS: largest change in any channel between consecutive frames (1/40 s) ===');
console.log('  top 12 jumps:');
for(const [d,t,who] of deltas.slice(0,12))
  console.log(`    ${d.toFixed(3)}  at t=${t.toFixed(3)}  ${who}`);
const pct=q=>deltas[Math.floor(deltas.length*(1-q))][0];
console.log(`\n  p50=${pct(0.5).toFixed(4)}  p90=${pct(0.9).toFixed(4)}  p99=${pct(0.99).toFixed(4)}  max=${deltas[0][0].toFixed(3)}`);
const bigOnes=deltas.filter(d=>d[0]>0.15);
console.log(`  frames with a jump > 0.15: ${bigOnes.length} of ${deltas.length} (${(100*bigOnes.length/deltas.length).toFixed(3)}%)`);
const times=[...new Set(bigOnes.map(d=>Math.round(d[1]*2)/2))].sort((a,b)=>a-b);
console.log(`  they occur at: ${times.join(', ') || 'nowhere'}`);
console.log('\n=== HEAD MOTION vs the layout slew limits ===');
console.log(`  pan  peak ${panMax.toFixed(4)} /s   limit ${lim.max_pan_per_s}   ${panMax<=lim.max_pan_per_s?'OK':'EXCEEDS'}   (at t=${panAt.toFixed(1)})`);
console.log(`  tilt peak ${tiltMax.toFixed(4)} /s   limit ${lim.max_tilt_per_s}  ${tiltMax<=lim.max_tilt_per_s?'OK':'EXCEEDS'}   (at t=${tiltAt.toFixed(1)})`);
console.log('\n=== heads are always moving (pan sampled every 2 s, 40-60 s) ===');
let row=[]; for(let t=40;t<60;t+=2){const f=frame(t);
  row.push(f.fixtures.filter(o=>o.id.startsWith('head')).map(o=>o.pan.toFixed(2)).join('/'))}
console.log('  '+row.join('  '));
