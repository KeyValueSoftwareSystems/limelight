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
(0,eval)(fs.readFileSync('readers/src/recipe4.js','utf8')+';global.frame=frame;global.PL=primaryLook;');
const KOF={};L.fixtures.forEach(f=>KOF[f.id]=f.kind);
const IDS=L.fixtures.filter(f=>KOF[f.id]!=='fog'&&KOF[f.id]!=='video').map(f=>f.id);
const STEP=16;                       // samples per bar
function barVec(b){                  // b = bar index from the first downbeat
  const v=[];
  for(let k=0;k<STEP;k++){
    const t=PH+DBP*PER+(b+k/STEP)*BAR;
    if(t>=DUR) return null;
    const f=frame(t), by={};
    for(const o of f.fixtures){ let x=o.level||0;
      if(o.pixels&&o.pixels.length){let m=0;for(const q of o.pixels)m=Math.max(m,(q[0]+q[1]+q[2])/765);x=Math.max(x,m)}
      by[o.id]=x }
    for(const id of IDS) v.push(by[id]||0);
  }
  return v;
}
function cos(a,b){let d=0,na=0,nb=0;for(let i=0;i<a.length;i++){d+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i]}
  return (na>1e-9&&nb>1e-9)?d/Math.sqrt(na*nb):0}
const nBars=Math.floor((DUR-PH)/BAR)-1;
const vecs=[]; for(let b=0;b<nBars;b++) vecs.push(barVec(b));
function lookAtBar(b){ return PL(PH+DBP*PER+(b+0.5)*BAR) }
const within=[], across=[], phraseIn=[], phraseOut=[];
for(let b=1;b<nBars;b++){
  if(!vecs[b]||!vecs[b-1]) continue;
  const s=cos(vecs[b],vecs[b-1]);
  (lookAtBar(b)===lookAtBar(b-1) ? within : across).push(s);
  // inside a 4-bar phrase vs crossing its boundary
  (Math.floor(b/4)===Math.floor((b-1)/4) ? phraseIn : phraseOut).push(s);
}
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
// same-labelled sections: is the second one like the first?
const byLook={};
for(let b=0;b<nBars;b++){ if(!vecs[b])continue; const k=lookAtBar(b); (byLook[k]=byLook[k]||[]).push(vecs[b]) }
console.log('\n=== '+song+': does the same music make the same light? ===');
console.log('  consecutive bars, same look      '+mean(within).toFixed(3)+'   ('+within.length+' pairs)');
console.log('  consecutive bars, look changed   '+mean(across).toFixed(3)+'   ('+across.length+' pairs)');
console.log('  inside a 4-bar phrase            '+mean(phraseIn).toFixed(3));
console.log('  crossing a phrase boundary       '+mean(phraseOut).toFixed(3));
for(const k of Object.keys(byLook)){
  const v=byLook[k]; if(v.length<4) continue;
  let s=0,n=0; for(let i=0;i<v.length;i++)for(let j=i+1;j<v.length;j++){s+=cos(v[i],v[j]);n++}
  console.log('  all "'+k+'" bars resemble each other  '+(s/n).toFixed(3)+'   ('+v.length+' bars)');
}
