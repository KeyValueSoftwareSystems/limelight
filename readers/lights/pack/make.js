#!/usr/bin/env node
/* Generate golden frames for the reader lane, from the CURRENT recipe.

     node readers/lights/pack/make.js

   The previous pack was pinned to recipe v0.2 and the recipe moved several
   versions past it, so any failure Dheeraj saw was ours and not his. This
   script exists so that never happens again: golden frames are generated, never
   hand-kept, and regenerating them is one command.

   Frames are a pure function of (map, layout, recipe, t), so this is a
   deterministic transform of committed inputs. Nothing here is a measurement. */
const fs=require('fs'), zlib=require('zlib'), path=require('path');
const ROOT=path.resolve(__dirname,'../../..');
const FPS=20, R=v=>Math.round(v*1e4)/1e4;

const CASES=[
  {name:'first-light', map:'synth/songs/first-light.map.json', how:'synthetic — canonical'},
  {name:'the-nights', map:'synth/maps/amal/the-nights.map.json',   how:'model — real record, structure disputed'},
  // opus and strobe were in the v0.2 pack and are dropped: they are sketches with
  // no grid field, so nothing can generate frames from them and the frames that
  // shipped for them cannot be reproduced from anything in this repo

];

function reader(m, layout){
  const src=fs.readFileSync(path.join(ROOT,'readers/src/recipe4.js'),'utf8');
  const PER=m.grid.period, PH=m.grid.phase, D=m.song.length;
  const BEATS=[]; for(let t=PH;t<D;t+=PER) BEATS.push(+t.toFixed(3));
  const sections=Array.isArray(m.sections)?m.sections:((m.sections&&m.sections.entries)||[]);
  return new Function('MAP','LAYOUT','CH','SP','MO','EN','BEATS','PER','PH','DUR','BAR','DBP',
                      'STOP_REAL','ANT', src+'\n;return frame;')(
    {accents:m.accents, obs:m.observations, sections, stems:m.stems},
    layout,
    (m.chapters||[]).map(c=>[c.at,c.name]),
    (m.spans||[]).map(s=>({kind:s.kind,from:s.from,to:s.to,rise:s.rise})),
    (m.moments||[]).map(x=>({at:x.at,kind:x.kind,v:x.size!==undefined?x.size:x.holds})),
    m.energy||[], BEATS, PER, PH, D, 4*PER, m.grid.bar_phase, true, true);
}

const clean=fr=>({t:R(fr.t), look:fr.look, fixtures:fr.fixtures.map(o=>{
  const out={id:o.id};
  for(const k of ['r','g','b']) if(o[k]!==undefined) out[k]=Math.round(o[k]);
  for(const k of ['level','pan','tilt','strobe','zoom']) if(o[k]!==undefined) out[k]=R(o[k]);
  if(o.pixels) out.pixels=o.pixels.map(p=>p.map(Math.round));
  return out})});

const layout=JSON.parse(fs.readFileSync(path.join(ROOT,'readers/lights/club/layout.json'),'utf8'));
const outDir=path.join(__dirname,'expected');
fs.mkdirSync(outDir,{recursive:true});
const lines=[];
for(const c of CASES){
  const p=path.join(ROOT,c.map);
  if(!fs.existsSync(p)){ console.log(`  ${c.name}: no map at ${c.map} — skipped`); continue }
  const m=JSON.parse(fs.readFileSync(p,'utf8'));
  if(!m.grid||!m.grid.period){
    // the sketch maps predate the grid field, so no reader can run on them --
    // a fixed input for a reader test still has to be a valid map
    console.log(`  ${c.name.padEnd(12)} skipped — no grid, so no reader can run on it`); continue }
  const f=reader(m,layout), D=m.song.length, n=Math.floor(D*FPS);
  const rows=[], keys=[];
  for(let i=0;i<n;i++){
    const fr=clean(f(i/FPS)); rows.push(JSON.stringify(fr));
    if(i%FPS===0) keys.push(fr);                       // one per second, for a quick check
  }
  const gz=path.join(outDir,`${c.name}.frames.jsonl.gz`);
  fs.writeFileSync(gz, zlib.gzipSync(rows.join('\n')+'\n',{level:9}));
  fs.writeFileSync(path.join(outDir,`${c.name}.keyframes.json`), JSON.stringify(keys,null,1));
  console.log(`  ${c.name.padEnd(12)} ${String(D.toFixed(1)).padStart(6)}s  ${String(n).padStart(5)} frames  `
    +`${(fs.statSync(gz).size/1024).toFixed(0).padStart(4)} KB   ${c.how}`);
  lines.push({name:c.name, map:c.map, how:c.how, frames:n, fps:FPS, seconds:R(D)});
}
fs.writeFileSync(path.join(__dirname,'CASES.json'), JSON.stringify(
  {generated_by:'readers/lights/pack/make.js', fps:FPS, layout:'readers/lights/club/layout.json',
   note:'Golden frames are GENERATED from committed inputs at the current recipe. Never hand-kept. '
       +'Regenerate with: node readers/lights/pack/make.js',
   cases:lines}, null, 1));
