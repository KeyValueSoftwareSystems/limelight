/* ================= the app =================
   Three readers of one file. The switch between them is the demonstration. */
let T=0, playing=false, lastTs=0, LASTF=null, fps=0, fc=0, fT=0;
const mm=t=>Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0');
const mms=t=>mm(t)+'.'+Math.floor(t*10%10);

/* bi() comes from the recipe */
function chAtT(t){let n=CH[0][1];for(const c of CH){if(c[0]<=t)n=c[1];else break}return n}

/* ---- modes ---- */
function mode(i){
  MODE=i;
  document.querySelectorAll('#modes button').forEach((b,j)=>b.setAttribute('aria-selected',i===j));
  $('#room').classList.toggle('hide',i!==0);
  $('#sky').classList.toggle('hide',i!==1);
  $('#score').classList.toggle('hide',i!==2);
  $('#tools').children[0].style.display=(i===2?'none':'');
  if(i===2) buildScore();
  fit(); skyFit(); render()}
function cycleView(){VIEW=(VIEW+1)%4;
  if(typeof setView==='function'&&MODE===0) setView(VIEW); else render()}
function full(){const e=document.documentElement;
  if(document.fullscreenElement) document.exitFullscreen(); else e.requestFullscreen&&e.requestFullscreen()}
function drawer(){$('#drawer').classList.toggle('open');
  $('#tools').children[2].classList.toggle('on')}


const SAFE=(function(){
  const M=(typeof MAP_FULL!=='undefined'&&MAP_FULL)?MAP_FULL:{};
  const O=M.observations||{};
  const arr=x=>Array.isArray(x)?x:[];
  const title=(typeof SONG_TITLE==='string'&&SONG_TITLE)?SONG_TITLE
    :((M.song&&M.song.title)?String(M.song.title).replace(/\.[a-z0-9]+$/i,''):'Limelight');
  const bpm=(M.grid&&M.grid.bpm)!==undefined?M.grid.bpm
    :(typeof PER==='number'&&PER>0?(60/PER).toFixed(1):'?');
  const key=(O.key&&O.key.estimate)?O.key.estimate:'';
  const acc=arr(M.accents&&M.accents.events);
  const beats=arr(M.beats);
  const vec=(M.vectors&&M.vectors.rows&&M.vectors.dim)?M.vectors:null;
  function rows(){
    const out=[['beats',beats.length],['grid','<b>'+bpm+'</b> bpm']];
    if(key) out.push(['key','<b>'+key+'</b>']);
    const mt=O.microtiming;
    if(mt&&typeof mt.quantisation==='string')
      out.push(['quantised','1/'+mt.quantisation.split('/').pop()+' of a beat'
        +(mt.within_15ms_pct!==undefined?', '+mt.within_15ms_pct+'% inside 15 ms':'')]);
    const learned=M.segmentation_proposal&&arr(M.segmentation_proposal.sections).length;
    out.push(['sections',(typeof SEC!=='undefined'?SEC.length:0)+' mine'
      +(learned?', '+learned+' learned':'')]);
    if(O.chords) out.push(['chords',arr(O.chords.events).length+' bars']);
    if(M.stems&&M.stems.sources) out.push(['stems',Object.keys(M.stems.sources).length]);
    if(acc.length) out.push(['accents','<b>'+acc.length+'</b>, '
      +Math.round(100*acc.filter(a=>!a.on_grid).length/acc.length)+'% off-grid']);
    if(O.lyrics) out.push(['lyrics',arr(O.lyrics.words).length+' word times']);
    for(const k of ['melody','harmony','voice'])
      if(O[k]&&arr(O[k].value).length) out.push([k,arr(O[k].value).length+' points']);
    if(vec) out.push(['vectors',vec.rows+'&times;'+vec.dim]);
    return out;
  }
  return {title:title,bpm:bpm,key:key,beats:beats,vectors:vec,rows:rows};
})();

/* ---- transport ---- */
function pick(inp){const f=inp.files[0]; if(!f) return;
  $('#audio').src=URL.createObjectURL(f);
  $('#hello').classList.add('hide');
  $('#audio2') && ($('#audio2').src=$('#audio').src);
  setTimeout(()=>{playing=true;$('#play').innerHTML='&#10074;&#10074;';$('#audio').play()},120)}
function toggle(){playing=!playing;$('#play').innerHTML=playing?'&#10074;&#10074;':'&#9654;';
  const a=$('#audio'); if(a.src){playing?a.play():a.pause()}}
function seek(v){T=Math.max(0,Math.min(DUR,v));const a=$('#audio');if(a.src)a.currentTime=T;render()}
function scrub(e){const r=$('#seekwrap').getBoundingClientRect();seek((e.clientX-r.left)/r.width*DUR)}

/* ---- the frame, per reader ---- */
function currentFrame(){
  if(MODE===1) return droneFrame(T);
  return frame(T)}

function render(){
  const f=currentFrame(); LASTF=f;
  if(MODE===0) drawRoom(f);
  else if(MODE===1) drawSky(f);
  else drawScoreCursor();
  const p=T/DUR*100;
  $('#fill').style.width=p+'%'; $('#knob').style.left=p+'%';
  $('#time').textContent=mms(T)+' / '+mm(DUR);
  const b=bi(T), bar=Math.floor((b-DBP)/4)+1;
  let cd='-'; for(const q of (MAP.chords||[])){if(q[0]<=T)cd=q[1];else break}
  const S=SEC.filter(s=>s.at<=T).pop();
  $('#where').textContent='bar '+bar+'  '+chAtT(T)+'  '+cd+(S?('  '+S.id+'#'+S.repeat):'')}

function loop(ts){
  const a=$('#audio');
  if(playing){ if(a.src&&!a.paused){T=a.currentTime}else{T+=(ts-lastTs)/1000} }
  lastTs=ts; if(T>DUR)T=0;
  fc++; if(ts-fT>1000){fps=fc;fc=0;fT=ts;
    const m=$('#metafps');
    if(m){const r=(typeof RMODE!=='undefined')?RMODE:'?';
      m.textContent=fps+' fps · '+(MODE===0?('room: '+(r==='gl'?'webgl':r==='2d'?'canvas 2d':'loading')):
        MODE===1?'sky: canvas 2d':'score')}}
  render(); requestAnimationFrame(loop)}

/* ---- score, built on demand ---- */
let scoreBuilt=false, PXS=8;
function buildScore(){
  if(scoreBuilt) return; scoreBuilt=true;
  const host=$('#score'); host.innerHTML='';
  const wrap=document.createElement('div');
  wrap.style.cssText='position:relative;padding:56px 0 96px';
  LANES.forEach(L=>{
    const row=document.createElement('div');
    row.style.cssText='display:flex;align-items:stretch;border-bottom:1px solid rgba(255,255,255,.04)';
    const lab=document.createElement('div');
    lab.style.cssText='position:sticky;left:0;z-index:5;width:126px;flex:0 0 126px;'
      +'background:var(--bg);border-right:1px solid var(--line);padding:5px 10px;'
      +'font:11px/1.35 ui-monospace,Menlo,monospace;color:var(--faint);display:flex;'
      +'flex-direction:column;justify-content:center';
    lab.innerHTML='<div style="color:var(--dim)">'+L.name+'</div><div>'+L.sub+'</div>';
    const c=document.createElement('canvas');
    const d=Math.min(2,window.devicePixelRatio||1), w=Math.ceil(DUR*PXS)+2;
    c.width=w*d;c.height=L.h*d;c.style.width=w+'px';c.style.height=L.h+'px';
    const g=c.getContext('2d'); g.setTransform(d,0,0,d,0,0);
    g.fillStyle='#08090c';g.fillRect(0,0,w,L.h);
    try{L.draw(g,w,L.h)}catch(e){g.fillStyle='#f0b429';g.font='10px monospace';
      g.fillText(L.name+': '+e.message,6,13)}
    row.appendChild(lab);const bd=document.createElement('div');
    bd.style.cssText='position:relative;flex:1';bd.appendChild(c);row.appendChild(bd);
    wrap.appendChild(row)});
  const cur=document.createElement('div'); cur.id='scur';
  cur.style.cssText='position:absolute;top:0;bottom:0;width:1px;background:var(--acc);'
    +'pointer-events:none;box-shadow:0 0 8px var(--acc)';
  wrap.appendChild(cur); host.appendChild(wrap);
  host.onclick=e=>{const r=wrap.getBoundingClientRect();
    seek((host.scrollLeft+e.clientX-r.left-126)/PXS)}}
function drawScoreCursor(){
  const c=$('#scur'); if(!c) return;
  c.style.left=(126+T*PXS)+'px';
  const h=$('#score');
  if(playing){const px=T*PXS;
    if(px<h.scrollLeft+180||px>h.scrollLeft+h.clientWidth-220)
      h.scrollLeft=Math.max(0,px-h.clientWidth*0.35)}}

/* ---- the drawer, which is where every remaining control went ---- */
function fillDrawer(){
  const O=(MAP_FULL&&MAP_FULL.observations)||{};
  const n=(O.notes&&O.notes.sources)
    ? Object.values(O.notes.sources).reduce((s,a)=>s+(Array.isArray(a)?a.length:0),0) : 0;
  const venues=Object.keys(LAYOUTS);
  $('#drawer').innerHTML=
   '<h2>Venue</h2><div class="row"><span>rig</span><div class="seg" id="vseg">'
   + venues.map((v,i)=>'<button class="'+(i===0?'on':'')+'" onclick="setVenue(\''+v+'\')">'
       +v+'</button>').join('') + '</div></div>'
   + '<div class="mono" id="vinfo"></div>'
   + '<h2>Look</h2>'
   + '<div class="row"><span>haze</span><input type="range" min="0" max="0.9" step="0.02" value="0.28"'
   + ' oninput="HAZE=+this.value;render()"></div>'
   + '<div class="row"><span>camera drift</span><div class="seg"><button class="on"'
   + ' onclick="DRIFT=!DRIFT;this.classList.toggle(\'on\');this.textContent=DRIFT?\'on\':\'off\'">on</button></div></div>'
   + '<div class="row"><span>quality</span><div class="seg"><button class="on"'
   + ' onclick="QUAL=QUAL?0:1;this.classList.toggle(\'on\');this.textContent=QUAL?\'high\':\'fast\';render()">high</button></div></div>'
   + '<div class="row"><span>anticipation</span><div class="seg"><button class="on"'
   + ' onclick="ANT=!ANT;this.classList.toggle(\'on\');render()">on</button></div></div>'
   + '<h2>Structure</h2>'
   + '<div class="row"><span>segmentation</span><div class="seg" id="sseg">'
   + '<button class="on" onclick="useStructure(0)">mine</button>'
   + '<button onclick="useStructure(1)">learned</button></div></div>'
   + '<p class="mono">Six methods say the hand segmentation is wrong between 1:03 and 1:47. The '
   + 'learned one carries <b>7</b> repeats to escalate against <b>1</b>.</p>'
   + '<h2>Take it away</h2>'
   + '<div class="row"><a class="link" href="#" onclick="dlScore();return false">the score, '+(SAFE.beats.length)+' beats &#8595;</a></div>'
   + (SAFE.vectors ? '<div class="row"><a class="link" href="#" onclick="dlVec();return false">the vectors, '
      + SAFE.vectors.rows+'&times;'+SAFE.vectors.dim+' &#8595;</a></div>' : '')
   + '<h2>What is in the file</h2><div class="mono">'
   + SAFE.rows().map(r=>'<div>'+r[0]+' &middot; '+r[1]+'</div>').join('')+'</div>'
   + '<h2>Keys</h2><div class="keys">'
   + [['space','play'],['&larr; &rarr;','a bar'],['1 2 3','room / sky / score'],
      ['c','camera'],['f','full screen'],['g','swap segmentation'],['.','more']]
     .map(k=>'<kbd>'+k[0]+'</kbd><span>'+k[1]+'</span>').join('')+'</div>'
   + '<h2>Audio</h2><audio id="audio2" controls></audio>';
  vinfo()}
function vinfo(){
  const c={}; LAYOUT.fixtures.forEach(f=>c[f.kind]=(c[f.kind]||0)+1);
  const dmx=LAYOUT.fixtures.reduce((s,f)=>s+(f.dmx_ch||0),0);
  $('#vinfo').innerHTML='<div><b>'+LAYOUT.fixtures.length+'</b> fixtures &middot; '
    + Object.keys(c).map(k=>c[k]+' '+k).join(', ')+'</div>'
    + '<div>'+LAYOUT.size_m.w+' &times; '+LAYOUT.size_m.d+' &times; '+LAYOUT.size_m.h+' m'
    + (dmx?(' &middot; '+dmx+' DMX ch, '+Math.ceil(dmx/512)+' universes'):'')+'</div>'
    + '<div>the same recipe drives all of these, unchanged</div>'}
function setVenue(v){
  LAYOUT=LAYOUTS[v];
  document.querySelectorAll('#vseg button').forEach(b=>b.classList.toggle('on',b.textContent===v));
  rebuildGeo();
  if(typeof rendererReset==='function') rendererReset();
  if(typeof GL!=='undefined'&&GL){GL=null;GLTRIED=false}   // the GL scene rebuilds itself
  vinfo(); fit(); render()}
function useStructure(i){
  document.querySelectorAll('#sseg button').forEach((b,j)=>b.classList.toggle('on',i===j));
  const src=i?MAP.proposal.sections:MAP.sections;
  const ch=i?MAP.proposal.chapters:MAP.chapters;
  CH.length=0; ch.forEach(c=>CH.push(c.slice?c.slice():[c.at,c.name]));
  SEC.length=0; src.forEach(s=>SEC.push(Object.assign({},s)));
  SEG=buildSegs(); render()}
function dlScore(){const b=new Blob([JSON.stringify(MAP_FULL,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(b);
  a.download='the-nights.map.json';a.click()}
function dlVec(){const r=atob(VEC_B64),u=new Uint8Array(r.length);
  for(let i=0;i<r.length;i++)u[i]=r.charCodeAt(i);
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([u]));
  a.download='the-nights.vec.f16';a.click()}

/* ---- meta, top left: four lines, no chrome ---- */
$('#meta').innerHTML='<div><b>'+SAFE.title+'</b></div>'
  +'<div>'+SAFE.bpm+' bpm'+(SAFE.key?' &middot; '+SAFE.key:'')
  +' &middot; '+BEATS.length+' beats</div>'
  +'<div id="metafps">&mdash;</div>';

document.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='AUDIO')return;
  const k=e.key;
  if(k===' '){toggle();e.preventDefault()}
  if(k==='ArrowLeft'){seek(T-BAR);e.preventDefault()}
  if(k==='ArrowRight'){seek(T+BAR);e.preventDefault()}
  if(k==='1'){mode(0)} if(k==='2'){mode(1)} if(k==='3'){mode(2)}
  if(k==='c'){cycleView()} if(k==='f'){full()} if(k==='.'){drawer()}
  if(k==='g'){const on=document.querySelectorAll('#sseg button')[1].classList.contains('on');
    useStructure(on?0:1)}});
window.addEventListener('resize',()=>{fit();skyFit();render()});
(function(){
  const m=$('#marks'); let h='';
  MO.forEach(x=>{h+='<i class="'+(x.kind==='drop'?'drop':'')+'" style="left:'
    +(x.at/DUR*100)+'%"></i>'});
  m.innerHTML=h})();
const AUD=document.createElement('audio'); AUD.id='audio'; document.body.appendChild(AUD);
fillDrawer(); fit(); skyFit(); mode(0); requestAnimationFrame(loop);

function serverAudio(){
  if(typeof SONG_SLUG!=='string'||!SONG_SLUG) return;
  const d=document;
  const a=d.getElementById('audio');
  const pick=d.getElementById('picker'), hint=d.getElementById('pickhint');
  if(!a||!pick||d.getElementById('playnow')) return;
  const url='/api/audio?song='+encodeURIComponent(SONG_SLUG);
  const b=d.createElement('button');
  b.id='playnow'; b.type='button'; b.textContent='Play';
  b.onclick=function(){
    try{
      if(!a.src) a.src=url;
      const two=d.getElementById('audio2'); if(two&&!two.src) two.src=url;
      const h=d.getElementById('hello'); if(h) h.classList.add('hide');
      playing=true;
      const pb=d.getElementById('play'); if(pb) pb.innerHTML='&#10074;&#10074;';
      const p=a.play(); if(p&&p.catch) p.catch(function(){});
    }catch(e){}
  };
  pick.parentNode.insertBefore(b,pick);
  pick.style.display='none';
  if(hint) hint.textContent='This machine already has the audio.';
  const alt=d.createElement('a');
  alt.href='#'; alt.textContent='choose a different file instead';
  alt.style.cssText='display:block;margin-top:12px;opacity:.55;font-size:13px;color:inherit';
  alt.onclick=function(e){e.preventDefault();pick.style.display='';b.remove();alt.remove()};
  if(hint&&hint.parentNode) hint.parentNode.insertBefore(alt,hint.nextSibling);
  a.src=url;
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',serverAudio);
else serverAudio();
