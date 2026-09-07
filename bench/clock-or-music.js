/* How much of this show is a function of where we are in the bar?

   "Even if we remove the song, it would go the same way." That is a claim about
   PREDICTABILITY, not about difference, and the diff-based test could not see
   it: two rotating chases at different phases differ maximally in bytes while
   being equally unmusical.

   So: for each fixture, take its level over the whole song and try to predict it
   from one thing only -- position within the bar. Average the fixture's level in
   each of 32 bins across the bar, then use that periodic template as the
   prediction for every bar in the song. The variance it explains is the share of
   that fixture's behaviour that a metronome could have produced.

     R2_clock near 1  ->  the fixture repeats the same bar forever. Remove the
                          song and it does the same thing.
     R2_clock near 0  ->  what it does cannot be guessed from the bar position,
                          so it is coming from the record.

   Compared against R2 from a musical predictor built the same way: bin by the
   fixture's own instrument envelope instead of by bar position. Same machinery,
   same fixture, so the two numbers are comparable. */
const fs=require('fs'), path=require('path'), cp=require('child_process');
const ROOT=path.resolve(__dirname,'..');
const RECIPE=fs.readFileSync(path.join(ROOT,'readers/src/recipe4.js'),'utf8');
const RIG=JSON.parse(fs.readFileSync(path.join(ROOT,'readers/lights/festival/layout.json'),'utf8'));
const SONGS=process.argv[2]?[process.argv[2]]:['levels','the-nights','mizhiyoram','starlight','dont-look-down'];
const mapPath=s=>{const f=path.join(ROOT,'maps/model/'+s+'.full.map.json');
  return fs.existsSync(f)?f:path.join(ROOT,'maps/model/'+s+'.map.json')};
function loadMap(s){
  return JSON.parse(cp.execFileSync('python3',['-c',
    'import sys,json;sys.path.insert(0,sys.argv[1]);from compact import compact;'+
    'print(json.dumps(compact(json.load(open(sys.argv[2])))))',
    path.join(ROOT,'readers/src'), mapPath(s)],{maxBuffer:1<<28}).toString());
}
const NB=32;
function r2(y, key){
  // key(i) -> bin index; predict each sample by its bin's mean
  const sum=new Float64Array(NB), cnt=new Float64Array(NB);
  for(let i=0;i<y.length;i++){ const b=key(i); if(b<0||b>=NB) continue; sum[b]+=y[i]; cnt[b]++ }
  let mean=0; for(let i=0;i<y.length;i++) mean+=y[i]; mean/=y.length||1;
  let ssr=0, sst=0;
  for(let i=0;i<y.length;i++){
    const b=key(i), pred=(b>=0&&b<NB&&cnt[b]>0)? sum[b]/cnt[b] : mean;
    ssr+=(y[i]-pred)*(y[i]-pred); sst+=(y[i]-mean)*(y[i]-mean);
  }
  return sst>1e-9 ? Math.max(0, 1-ssr/sst) : 0;
}
console.log('\n=== is it the clock, or is it the record? ===');
console.log('  R2 = share of a fixture\'s behaviour a predictor explains\n');
console.log('  '+'song'.padEnd(16)+'family'.padEnd(10)+
  'lvl clk'.padStart(9)+'lvl mus'.padStart(9)+
  'pan clk'.padStart(9)+'pan mus'.padStart(9)+'  cycle'+'   verdict');
const tot={c:0,m:0,n:0};
for(const song of SONGS){
  const cm=loadMap(song);
  const g={MAP:cm,LAYOUT:RIG,ENERGY:'medium',STOP_REAL:true,ANT:true,HAZE:0.28,DRIFT:true,
    PER:cm.period,PH:cm.phase,DUR:cm.dur,DBP:cm.bar_phase,BAR:4*cm.period,BEATS:[],
    CH:(cm.chapters&&cm.chapters.length?cm.chapters:[[0,'verse']]).map(c=>c.slice()),
    SP:(cm.spans||[]).map(s=>({kind:s[0],from:s[1],to:s[2],rise:s[3]})),
    MO:(cm.moments||[]).map(m=>({at:m[0],kind:m[1],v:m[2]})), EN:cm.energy||[]};
  for(let t=cm.phase;t<cm.dur;t+=cm.period) g.BEATS.push(+t.toFixed(4));
  for(const k in g) global[k]=g[k];
  (0,eval)(RECIPE+';global.__frame=frame;global.__voice=(typeof voiceRaw==="function")?voiceRaw:null;'+
           'global.__part=(typeof partEnv==="function")?partEnv:null;'+
           'global.__fam=(typeof fam==="function")?fam:(f=>f.kind);');
  const STEP=0.04, T=[]; for(let t=0;t<g.DUR;t+=STEP) T.push(t);
  const lv={}, pn={}, hasPan={};
  for(const f of RIG.fixtures){ lv[f.id]=new Float64Array(T.length); pn[f.id]=new Float64Array(T.length) }
  for(let i=0;i<T.length;i++){
    const fr=global.__frame(T[i]);
    for(const o of fr.fixtures){ if(!lv[o.id]) continue;
      let v=o.level||0;
      if(o.pixels&&o.pixels.length){let m=0;for(const q of o.pixels)m=Math.max(m,(q[0]+q[1]+q[2])/765);v=Math.max(v,m)}
      lv[o.id][i]=v;
      if(o.pan!==undefined){ pn[o.id][i]=o.pan; hasPan[o.id]=1 } }
  }
  const BAR=g.BAR, t0=g.PH+g.DBP*g.PER;
  /* A one-bar template is blind to a four-bar sweep, and the recipe's motion
     rates are quantised to 1, 2, 4 and 8 bars. Testing only one bar reported
     head pan as unpredictable from the clock when it is a slow sweep on a fixed
     multi-bar cycle -- which is precisely the "regular intervals" being
     complained about. Any fixed period counts as a metronome, so try them all
     and keep the worst case. */
  const CLOCK_PERIODS=[1,2,4,8,16];
  const clockKeyFor=bars=>{ const P=BAR*bars;
    return i=>{ let x=((T[i]-t0)%P)/P; if(x<0)x+=1; return Math.min(NB-1,(x*NB)|0) } };
  const r2clock=y=>{ let best=0, at=1;
    for(const b of CLOCK_PERIODS){ const v=r2(y, clockKeyFor(b)); if(v>best){best=v; at=b} }
    return [best, at] };
  const byFam={}, seen={};
  for(const f of RIG.fixtures){
    const fm=global.__fam(f);
    if(fm==='fog') continue;
    const ki=(seen[fm]=(seen[fm]===undefined?0:seen[fm]+1));
    const y=lv[f.id];
    let any=false; for(let i=0;i<y.length;i++) if(y[i]>0.02){any=true;break}
    if(!any) continue;
    /* Ask the fixture about ITS OWN voice first -- that is what the recipe
       assigned it -- and only fall back to the family envelope. Keying this on
       the family after the parts were split measured the wrong thing and made a
       real improvement look like a regression. */
    const own = global.__part ? global.__part(fm, ki, 0) : -1;
    const env = (own >= 0) ? (tt=>global.__part(fm, ki, tt))
              : (global.__voice && global.__voice(fm,0) >= 0 ? (tt=>global.__voice(fm,tt)) : null);
    const musicKey = env ? (i=>Math.min(NB-1, Math.max(0,(env(T[i])*NB)|0))) : null;
    const [rc, rcBars]=r2clock(y);
    const rm=musicKey? r2(y, musicKey) : NaN;
    /* Where a head POINTS, measured the same way. Movement was named first in
       the complaint, and a head sweeping on a fixed cycle is the most visible
       metronome in a light show: brightness can look musical while the movement
       underneath it is a clock. */
    const pcr = hasPan[f.id] ? r2clock(pn[f.id]) : [NaN,NaN];
    const pc = pcr[0], pcBars = pcr[1];
    const pm = (hasPan[f.id] && musicKey) ? r2(pn[f.id], musicKey) : NaN;
    (byFam[fm]=byFam[fm]||[]).push([rc,rm,pc,pm,rcBars,pcBars]);
  }
  for(const fm of Object.keys(byFam).sort()){
    const a=byFam[fm];
    const rc=a.reduce((x,y)=>x+y[0],0)/a.length;
    const rms=a.filter(x=>!Number.isNaN(x[1]));
    const rm=rms.length? rms.reduce((x,y)=>x+y[1],0)/rms.length : NaN;
    const v = Number.isNaN(rm) ? 'no instrument assigned'
            : (rc > rm*1.4 ? 'CLOCK' : rm > rc*1.4 ? 'record' : 'both');
    const av=(i)=>{const q=a.filter(x=>!Number.isNaN(x[i]));
      return q.length? q.reduce((x,y)=>x+y[i],0)/q.length : NaN};
    const pc=av(2), pm=av(3);
    const f3=x=>Number.isNaN(x)?'   --':x.toFixed(3);
    const cyc=a[0][5]; const lcyc=a[0][4];
    console.log('  '+song.padEnd(16)+fm.padEnd(10)+f3(rc).padStart(9)+f3(rm).padStart(9)+
      f3(pc).padStart(9)+f3(pm).padStart(9)+
      ((Number.isNaN(pc)?lcyc:cyc)+'bar').padStart(7)+'   '+
      (Number.isNaN(pc)? v : (pc > Math.max(pm,0)*1.4 ? v+', PAN IS CLOCK' : v)));
    tot.c+=rc; if(!Number.isNaN(rm)){tot.m+=rm; tot.n++}
  }
}
console.log('\n  mean R2 clock '+(tot.c/Math.max(1,tot.n)).toFixed(3)+
            '   mean R2 music '+(tot.m/Math.max(1,tot.n)).toFixed(3));
console.log('  A family marked CLOCK repeats the same bar whatever the record does.');
