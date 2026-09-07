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
const has=(o,p)=>{let c=o;for(const k of p.split('.')){if(c===null||c===undefined)return false;c=c[k]}
  return c!==undefined&&c!==null&&!(Array.isArray(c)&&!c.length)
    &&!(typeof c==='object'&&!Array.isArray(c)&&!Object.keys(c).length)};
/* [label, how to remove it, where to look to say whether this song carries it]

   The probe matters more than it looks. Only the-nights carries chords, so
   averaging its real 0.37% against four songs where deleting the field is a
   no-op reported 0.073% and made a working field look like decoration. */
const ABL=[
  ['observations.mood',      m=>del(m,'observations.mood'),    'observations.mood'],
  ['observations.novelty',   m=>del(m,'observations.novelty'), 'observations.novelty'],
  ['observations.lyrics',    m=>del(m,'observations.lyrics'),  'observations.lyrics'],
  ['observations.key',       m=>del(m,'observations.key'),     'observations.key'],
  ['observations.melody',    m=>del(m,'observations.melody'),  'observations.melody'],
  ['observations.harmony',   m=>del(m,'observations.harmony'), 'observations.harmony'],
  ['observations.voice',     m=>del(m,'observations.voice'),   'observations.voice'],
  ['observations.chords',    m=>del(m,'observations.chords'),  'observations.chords'],
  ['stems (all)',            m=>del(m,'stems'),                'stems'],
  ['stems.vocals',           m=>{if(m.stems&&m.stems.sources)delete m.stems.sources.vocals}, 'stems.sources.vocals'],
  ['stems.drums',            m=>{if(m.stems&&m.stems.sources)delete m.stems.sources.drums},  'stems.sources.drums'],
  ['stems.bass',             m=>{if(m.stems&&m.stems.sources)delete m.stems.sources.bass},   'stems.sources.bass'],
  ['accents (all)',          m=>del(m,'accents'),              'accents'],
  ['accents: kick only gone',m=>{if(m.accents)m.accents.events=m.accents.events.filter(a=>a.of!=='kick')}, 'accents'],
  ['sections',               m=>del(m,'sections'),             'sections'],
  ['spans',                  m=>{m.spans=[]},                  'spans'],
  ['moments',                m=>{m.moments=[]},                'moments'],
  ['moments: drops only gone',m=>{m.moments=(m.moments||[]).filter(x=>x.kind!=='drop')}, 'moments'],
  ['energy',                 m=>{m.energy=[]},                 'energy'],
  ['downbeats',              m=>{m.downbeats=[]},              'downbeats'],
  ['chapters',               m=>{m.chapters=[{at:0.0,name:'verse'}]}, 'chapters'],
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
  const F=global.__frame, STEP=0.05, out=[];
  const WINS=[]; for(let w=0;w<4;w++){ const a=g.DUR*(0.10+0.20*w); WINS.push([a, Math.min(g.DUR, a+14)]) }
  const TS=[]; for(const [a,b] of WINS) for(let t=a;t<b;t+=STEP) TS.push(t);
  for(const t of TS){
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
const FAMOF = RIG.fixtures.map(f=>f.kind);
function diff(a,b){
  const n=Math.min(a.length,b.length); if(!n) return {all:1, per:{}};
  let s=0,c=0; const ps={}, pc={};
  for(let i=0;i<n;i++) for(let j=0;j<a[i].length;j++){
    const d=Math.abs(a[i][j]-b[i][j]); s+=d; c++;
    const k=FAMOF[(j/5)|0]; ps[k]=(ps[k]||0)+d; pc[k]=(pc[k]||0)+1;
  }
  const per={}; for(const k in ps) per[k]=ps[k]/pc[k];
  return {all: c? s/c : 0, per};
}
const rows={};
for(const song of SONGS){
  const base=fullMap(song);
  let ref;
  try{ ref=run(compact(base)) }catch(e){ console.log('  base failed for '+song+': '+e.message); continue }
  for(const [name,fn,probe] of ABL){
    if(probe && !has(base, probe)){ (rows[name]=rows[name]||[]).push({absent:true}); continue }
    const m=JSON.parse(JSON.stringify(base));
    fn(m);
    let cm, res, err=null;
    try{ cm=compact(m); res=run(cm) }catch(e){ err=e.message }
    const D = err? null : diff(ref,res);
    (rows[name]=rows[name]||[]).push({d:D&&D.all, per:D&&D.per, err});
  }
}
console.log('\n=== what each map field is worth ===');
console.log('  field                        reader   mean change in the show');
const order=Object.keys(rows).map(k=>{
  const v=rows[k], ok=v.filter(x=>!x.err&&!x.absent), br=v.filter(x=>x.err).length;
  const mean=ok.length? ok.reduce((a,b)=>a+b.d,0)/ok.length : null;
  const agg={}; for(const o of ok) for(const f in (o.per||{})) agg[f]=Math.max(agg[f]||0,o.per[f]);
  const top=Object.keys(agg).filter(f=>agg[f]>0.004).sort((a,b)=>agg[b]-agg[a]).slice(0,5)
              .map(f=>f+':'+(agg[f]*100).toFixed(1));
  return {k,mean,br,n:v.length,top,carried:ok.length};
}).sort((a,b)=>(b.mean||0)-(a.mean||0));
for(const o of order){
  const bar='#'.repeat(Math.round((o.mean||0)*900));
  console.log('  '+o.k.padEnd(28)+(o.br? ('BREAKS x'+o.br).padEnd(9) : 'ok       ')+
    (o.mean===null?'   -':(o.mean*100).toFixed(3)+'%').padStart(9)+
    ('  '+o.carried+'/'+o.n+' songs').padEnd(13)+
    (o.top&&o.top.length? o.top.join(' ') : bar));
}
console.log('\n  "BREAKS" = the reader threw without the field, which rule 7 forbids.');
console.log('  n/5 songs = how many maps carry the field. The mean is over those only.');
console.log('  The families named are the ones the field actually moved.');
console.log('  A field worth ~0 changes nothing: the reader is not using it.');
