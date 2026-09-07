/* Would the show run the same way without the song?

   Every other measurement here asks whether one FIELD earns its place. This
   asks the question underneath that: how much of what the rig does comes from
   the record at all, and how much is a timer that would run the same on
   silence.

   Three comparisons, all against the same reader and rig:

     SAME      the song's own map, twice. Zero by construction; a non-zero
               number here means the reader is not a pure function and every
               other row is noise.
     STRIPPED  the grid and nothing else. No chapters, no moments, no energy,
               no accents, no stems, no observations. Whatever the show still
               does is what a metronome alone produces.
     OTHER     another song's map, its times rescaled onto this song's length
               so the grid still fits the room. If this is small, the rig is
               not listening to the record, it is counting bars.

   The number is mean |change| per channel per frame, same as the ablation, so
   the rows can be read against it. */
const fs=require('fs'), path=require('path'), cp=require('child_process');
const ROOT=path.resolve(__dirname,'..');
const RECIPE=fs.readFileSync(path.join(ROOT,'readers/src/recipe4.js'),'utf8');
const RIG=JSON.parse(fs.readFileSync(path.join(ROOT,'readers/lights/festival/layout.json'),'utf8'));
const SONGS=['levels','the-nights','mizhiyoram','starlight','dont-look-down'];
const mapPath=s=>{const f=path.join(ROOT,'maps/model/'+s+'.full.map.json');
  return fs.existsSync(f)?f:path.join(ROOT,'maps/model/'+s+'.map.json')};
const full=s=>JSON.parse(fs.readFileSync(mapPath(s),'utf8'));
function compact(m){
  return JSON.parse(cp.execFileSync('python3',['-c',
    'import sys,json;sys.path.insert(0,sys.argv[1]);from compact import compact;'+
    'print(json.dumps(compact(json.load(sys.stdin))))', path.join(ROOT,'readers/src')],
    {input:JSON.stringify(m), maxBuffer:1<<28}).toString());
}
function stripped(m){
  return {grid:m.grid, beats:m.beats, downbeats:m.downbeats, song:m.song,
          chapters:[], spans:[], moments:[], energy:[], made_by:m.made_by};
}
/* Another song's map, rescaled so its grid lands in this song's clock. The
   point is to keep a *plausible* map and change only which record it describes. */
function rescale(other, host){
  const od=(other.song||{}).length || (other.beats||[]).slice(-1)[0] || 1;
  const hd=(host.song||{}).length  || (host.beats||[]).slice(-1)[0]  || 1;
  const k=hd/od;
  const T=x=>(typeof x==='number')? +(x*k).toFixed(4) : x;
  const m=JSON.parse(JSON.stringify(other));
  if(m.grid){ if(m.grid.period) m.grid.period=T(m.grid.period);
              if(m.grid.phase)  m.grid.phase =T(m.grid.phase) }
  m.beats=(m.beats||[]).map(T); m.downbeats=(m.downbeats||[]).map(T);
  m.chapters=(m.chapters||[]).map(c=>({...c, at:T(c.at)}));
  m.spans=(m.spans||[]).map(s=>({...s, from:T(s.from), to:T(s.to)}));
  m.moments=(m.moments||[]).map(x=>({...x, at:T(x.at)}));
  if(m.accents&&m.accents.events) m.accents.events=m.accents.events.map(a=>({...a, at:T(a.at)}));
  const ob=m.observations||{};
  for(const k in ob) if(ob[k]&&Array.isArray(ob[k].at)) ob[k]={...ob[k], at:ob[k].at.map(T)};
  if(ob.chords&&ob.chords.events) ob.chords.events=ob.chords.events.map(e=>({...e, at:T(e.at)}));
  if(ob.phrases&&ob.phrases.events) ob.phrases.events=ob.phrases.events.map(e=>({...e, at:T(e.at), to:T(e.to)}));
  m.observations=ob;
  m.song={...(m.song||{}), length:hd};
  return m;
}
function run(cm){
  const g={MAP:cm,LAYOUT:RIG,ENERGY:'medium',STOP_REAL:true,ANT:true,HAZE:0.28,DRIFT:true,
    PER:cm.period,PH:cm.phase,DUR:cm.dur,DBP:cm.bar_phase,BAR:4*cm.period,BEATS:[],
    CH:(cm.chapters&&cm.chapters.length?cm.chapters:[[0,'verse']]).map(c=>c.slice()),
    SP:(cm.spans||[]).map(s=>({kind:s[0],from:s[1],to:s[2],rise:s[3]})),
    MO:(cm.moments||[]).map(m=>({at:m[0],kind:m[1],v:m[2]})), EN:cm.energy||[]};
  for(let t=cm.phase;t<cm.dur;t+=cm.period) g.BEATS.push(+t.toFixed(4));
  for(const k in g) global[k]=g[k];
  (0,eval)(RECIPE+';global.__frame=frame;');
  const F=global.__frame, out=[];
  for(let t=0;t<g.DUR;t+=0.10){
    const f=F(t), row=[];
    for(const fx of RIG.fixtures){
      const o=f.fixtures.find(x=>x.id===fx.id);
      let v=0;
      if(o){ v=o.level||0;
        if(o.pixels&&o.pixels.length){let mx=0;for(const q of o.pixels)mx=Math.max(mx,(q[0]+q[1]+q[2])/765);v=Math.max(v,mx)} }
      row.push(v, o&&o.r!==undefined?o.r/255:0, o&&o.g!==undefined?o.g/255:0,
                  o&&o.b!==undefined?o.b/255:0, o&&o.pan!==undefined?o.pan:0);
    }
    out.push(row);
  }
  return out;
}
/* What does 13% mean? Nothing, without a ceiling. Two shows with no
   relationship at all still agree wherever both are dark, so the scale is not
   0..100. SHUFFLED holds the show's own frames and destroys only their order:
   same fixtures, same palette, same brightness distribution, no timing. That is
   the most two versions of this rig can differ while still being this rig, and
   every other column should be read as a fraction of it. */
function shuffle(a){
  const out=a.slice(); let seed=12345;
  const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff};
  for(let i=out.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1)); const t=out[i];out[i]=out[j];out[j]=t}
  return out;
}
function diff(a,b){
  const n=Math.min(a.length,b.length); if(!n) return 1;
  let s=0,c=0;
  for(let i=0;i<n;i++) for(let j=0;j<a[i].length;j++){ s+=Math.abs(a[i][j]-b[i][j]); c++ }
  return s/c;
}
console.log('\n=== would this show run the same without the song? ===');
console.log('  mean |change| per channel per frame, same scale as the ablation\n');
console.log('  '+'song'.padEnd(16)+'SAME'.padStart(9)+'STRIPPED'.padStart(11)+
  'OTHER'.padStart(10)+'SHUFFLED'.padStart(11)+'  OTHER as % of ceiling');
const rows=[];
for(const s of SONGS){
  const host=full(s);
  const ref=run(compact(host));
  const same=diff(ref, run(compact(host)));
  const strip=diff(ref, run(compact(stripped(host))));
  const others=SONGS.filter(x=>x!==s);
  let acc=0;
  for(const o of others) acc+=diff(ref, run(compact(rescale(full(o), host))));
  const oth=acc/others.length;
  const ceil=diff(ref, shuffle(ref));
  rows.push([s,same,strip,oth,ceil]);
  console.log('  '+s.padEnd(16)+((100*same).toFixed(2)+'%').padStart(9)+
    ((100*strip).toFixed(2)+'%').padStart(11)+((100*oth).toFixed(2)+'%').padStart(10)+
    ((100*ceil).toFixed(2)+'%').padStart(11)+
    ((100*oth/(ceil||1)).toFixed(0)+'%').padStart(14));
}
const mn=i=>rows.reduce((a,r)=>a+r[i],0)/rows.length;
console.log('  '+'MEAN'.padEnd(16)+((100*mn(1)).toFixed(2)+'%').padStart(9)+
  ((100*mn(2)).toFixed(2)+'%').padStart(11)+((100*mn(3)).toFixed(2)+'%').padStart(10)+
  ((100*mn(4)).toFixed(2)+'%').padStart(11)+
  ((100*mn(3)/(mn(4)||1)).toFixed(0)+'%').padStart(14));
console.log('\n  SAME must be 0.00: the reader is meant to be a pure function.');
console.log('  STRIPPED is how far the show moves when the record is taken away.');
console.log('  OTHER is how far it moves when a DIFFERENT record is put in.');
console.log('  SHUFFLED is the ceiling: this show with its frames reordered.');
console.log('  The last column is OTHER as a fraction of that ceiling -- how much');
console.log('  of the available difference a DIFFERENT RECORD actually produces.');
