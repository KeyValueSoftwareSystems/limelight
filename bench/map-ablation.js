/* Which fields in the map actually drive the show?
   Hold the reader fixed, remove one field, measure what changes. */
const fs=require('fs'), path=require('path'), cp=require('child_process');
const ROOT=path.resolve(__dirname,'..');
const RECIPE=fs.readFileSync(path.join(ROOT,'readers/src/recipe4.js'),'utf8');
const SONGS=process.argv[2] ? [process.argv[2]] : ['levels','the-nights','mizhiyoram','starlight','dont-look-down'];
const RIG=JSON.parse(fs.readFileSync(path.join(ROOT,'readers/lights/festival/layout.json'),'utf8'));

function fullMap(song){
  const p = song==='the-nights' ? 'maps/model/the-nights.full.map.json' : `maps/model/${song}.map.json`;
  return JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
}
function compact(m){
  const out=cp.execFileSync('python3',['-c',
    'import sys,json;sys.path.insert(0,sys.argv[1]);from compact import compact;'+
    'print(json.dumps(compact(json.load(sys.stdin))))', path.join(ROOT,'readers/src')],
    {input:JSON.stringify(m), maxBuffer:1<<28});
  return JSON.parse(out.toString());
}
const del=(o,p)=>{const k=p.split('.');let c=o;for(let i=0;i<k.length-1;i++){if(!c[k[i]])return;c=c[k[i]]}delete c[k[k.length-1]]};
const ABL=[
  ['observations.mood',      m=>del(m,'observations.mood')],
  ['observations.novelty',   m=>del(m,'observations.novelty')],
  ['observations.lyrics',    m=>del(m,'observations.lyrics')],
  ['observations.key',       m=>del(m,'observations.key')],
  ['observations.melody',    m=>del(m,'observations.melody')],
  ['observations.harmony',   m=>del(m,'observations.harmony')],
  ['observations.voice',     m=>del(m,'observations.voice')],
  ['observations.chords',    m=>del(m,'observations.chords')],
  ['stems (all)',            m=>del(m,'stems')],
  ['stems.vocals',           m=>{if(m.stems&&m.stems.sources)delete m.stems.sources.vocals}],
  ['stems.drums',            m=>{if(m.stems&&m.stems.sources)delete m.stems.sources.drums}],
  ['stems.bass',             m=>{if(m.stems&&m.stems.sources)delete m.stems.sources.bass}],
  ['accents (all)',          m=>del(m,'accents')],
  ['accents: kick only gone',m=>{if(m.accents)m.accents.events=m.accents.events.filter(a=>a.of!=='kick')}],
  ['sections',               m=>del(m,'sections')],
  ['spans',                  m=>{m.spans=[]}],
  ['moments',                m=>{m.moments=[]}],
  ['moments: drops only gone',m=>{m.moments=(m.moments||[]).filter(x=>x.kind!=='drop')}],
  ['energy',                 m=>{m.energy=[]}],
  ['downbeats',              m=>{m.downbeats=[]}],
  ['chapters',               m=>{m.chapters=[{at:0.0,name:'verse'}]}],
];
function run(cm){
  const g={};
  g.MAP=cm; g.LAYOUT=RIG; g.ENERGY='medium';
  g.STOP_REAL=true; g.ANT=true; g.HAZE=0.28; g.DRIFT=true;
  g.PER=cm.period; g.PH=cm.phase; g.DUR=cm.dur; g.DBP=cm.bar_phase;
  g.BAR=4*cm.period; g.BEATS=[];
  for(let t=cm.phase;t<cm.dur;t+=cm.period) g.BEATS.push(+t.toFixed(4));
  g.CH=(cm.chapters||[]).map(c=>c.slice());
  g.SP=(cm.spans||[]).map(s=>({kind:s[0],from:s[1],to:s[2],rise:s[3]}));
  g.MO=(cm.moments||[]).map(m=>({at:m[0],kind:m[1],v:m[2]}));
  g.EN=cm.energy||[];
  for(const k in g) global[k]=g[k];
  (0,eval)(RECIPE+';global.__frame=frame;');
  const F=global.__frame, STEP=0.25, out=[];
  for(let t=0;t<g.DUR;t+=STEP){
    const f=F(t), row=[];
    for(const fx of RIG.fixtures){
      const o=f.fixtures.find(x=>x.id===fx.id);
      let v=0;
      if(o){ v=o.level||0;
        if(o.pixels&&o.pixels.length){let mx=0;for(const q of o.pixels)mx=Math.max(mx,(q[0]+q[1]+q[2])/765);v=Math.max(v,mx)} }
      row.push(v);
      row.push(o&&o.r!==undefined?o.r/255:0);
      row.push(o&&o.g!==undefined?o.g/255:0);
      row.push(o&&o.b!==undefined?o.b/255:0);
      row.push(o&&o.pan!==undefined?o.pan:0);
    }
    out.push(row);
  }
  return out;
}
function diff(a,b){
  const n=Math.min(a.length,b.length); if(!n) return 1;
  let s=0,c=0;
  for(let i=0;i<n;i++) for(let j=0;j<a[i].length;j++){ s+=Math.abs(a[i][j]-b[i][j]); c++ }
  return c? s/c : 0;
}
const rows={};
for(const song of SONGS){
  const base=fullMap(song);
  let ref;
  try{ ref=run(compact(base)) }catch(e){ console.log('  base failed for '+song+': '+e.message); continue }
  for(const [name,fn] of ABL){
    const m=JSON.parse(JSON.stringify(base));
    fn(m);
    let cm, res, err=null;
    try{ cm=compact(m); res=run(cm) }catch(e){ err=e.message }
    const d = err? null : diff(ref,res);
    (rows[name]=rows[name]||[]).push({d,err});
  }
}
console.log('\n=== what each map field is worth ===');
console.log('  field                        reader   mean change in the show');
const order=Object.keys(rows).map(k=>{
  const v=rows[k], ok=v.filter(x=>!x.err), br=v.filter(x=>x.err).length;
  const mean=ok.length? ok.reduce((a,b)=>a+b.d,0)/ok.length : null;
  return {k,mean,br,n:v.length};
}).sort((a,b)=>(b.mean||0)-(a.mean||0));
for(const o of order){
  const bar='#'.repeat(Math.round((o.mean||0)*900));
  console.log('  '+o.k.padEnd(28)+(o.br? ('BREAKS x'+o.br).padEnd(9) : 'ok       ')+
    (o.mean===null?'   -':(o.mean*100).toFixed(3)+'%').padStart(9)+'  '+bar);
}
console.log('\n  "BREAKS" = the reader threw without the field, which rule 7 forbids.');
console.log('  A field worth ~0 changes nothing: the reader is not using it.');
