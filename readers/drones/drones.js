/* ================= reader: DRONES =================
   A second reader, sharing nothing with the lighting one. It reads the same map
   and emits a different frame -- which is the point: FRAME.md always said the
   lighting frame was the lighting reader's, not universal.

     lighting frame : {id, r,g,b, level, pan, tilt, strobe, pixels}
     drone frame    : {id, x,y,z, r,g,b, level}

   Same purity rule. Position is a function of t, so the show can be scrubbed,
   joined late, and tested. Different physics: drones have a top speed and a
   minimum separation instead of a motor slew limit. */
const N_DRONE = 120;
const SKY = {w:120, h:90, d:70};          // metres
const DRONE_LIMITS = {max_speed:7.5, min_sep:2.6, floor:8, ceil:88};

/* ---- formations. Each is a parametric function of the drone's index. ---- */
function fGrid(u,i){const c=12, r=Math.floor(i/c), k=i%c;
  return [(k/(c-1)-0.5)*46, 30+r*3.4, (r%2?2.5:-2.5)]}
function fRings(u,i){const g=i%3, j=Math.floor(i/3), n=N_DRONE/3;
  const a=2*Math.PI*(j/n), rad=[11,17,23][g];
  return [Math.cos(a)*rad, 40+g*4.5, Math.sin(a)*rad*0.55]}
function fHelix(u,i){const a=2*Math.PI*u*3.0;
  return [Math.cos(a)*17, 22+u*38, Math.sin(a)*17*0.6]}
function fColumn(u,i){const a=2*Math.PI*u*7.0, rad=5+u*9;
  return [Math.cos(a)*rad, 20+u*46, Math.sin(a)*rad*0.6]}
function fSphere(u,i){const y=1-2*(i+0.5)/N_DRONE, r=Math.sqrt(Math.max(0,1-y*y));
  const a=Math.PI*(1+Math.sqrt(5))*i;
  return [Math.cos(a)*r*21, 46+y*21, Math.sin(a)*r*21*0.6]}
function fShell(u,i){const y=1-2*(i+0.5)/N_DRONE, r=Math.sqrt(Math.max(0,1-y*y));
  const a=Math.PI*(1+Math.sqrt(5))*i;
  return [Math.cos(a)*r*27, 48+y*25, Math.sin(a)*r*27*0.6]}
function fWave(u,i){const c=15, r=Math.floor(i/c), k=i%c;
  return [(k/(c-1)-0.5)*52, 34+Math.sin(k*0.8+r*1.1)*7+r*2.6, (r/7-0.5)*22]}
function fFall(u,i){const c=12, r=Math.floor(i/c), k=i%c;
  return [(k/(c-1)-0.5)*44, 14+r*2.6, (r/9-0.5)*18]}
const FORM={A:fGrid, B:fWave, C:fRings, D:fColumn, E:fSphere, F:fShell, G:fFall, H:fFall};
const formOf=id=>FORM[id]||fGrid;

/* ---- morph time DERIVED from distance, not guessed ----
   The first version morphed every transition over two bars, which asked drones
   to cross forty metres in 3.8 s -- 59.6 m/s against a 7.5 limit. Both
   formations are deterministic functions of the drone index, so the largest
   displacement of any transition is computable once, and the morph time follows
   from it. Rounded UP to a whole number of bars, so it is still musical. */
const MORPH_T=(function(){
  const ids=Object.keys(FORM), out={};
  ids.forEach(a=>ids.forEach(b=>{
    let mx=0;
    for(let i=0;i<N_DRONE;i++){
      const u=(i+0.5)/N_DRONE, p=FORM[a](u,i), q=FORM[b](u,i);
      mx=Math.max(mx,Math.hypot(q[0]-p[0],q[1]-p[1],q[2]-p[2]))}
    // 1.5 is the peak slope of the smoothstep, and 0.55 leaves room for the
    // lift and the beat breathing, which add to the same velocity budget
    const need=mx*1.5/(DRONE_LIMITS.max_speed*0.55);
    out[a+b]=Math.max(1,Math.ceil(need/BAR))}));
  return out})();
function morphBars(a,b){return (MORPH_T[a+b]||2)}

/* ---- position as a WEIGHTED BLEND over every section ----
   Blending only previous -> current cannot be continuous: when a section is
   shorter than its own morph time the next boundary arrives mid-morph and the
   position snaps, which is how a 7.5 m/s show reached 883 m/s. Instead every
   section carries a smooth weight bump over t, and the position is their
   weighted mean. That is continuous no matter how the sections are arranged,
   short ones simply never reach full weight, and the velocity is bounded by how
   fast the weights can change -- which is set once, from the largest formation
   displacement in the whole show. */
const MSOFT=(function(){
  const ids=Object.keys(FORM); let mx=0;
  ids.forEach(x=>ids.forEach(y=>{
    for(let i=0;i<N_DRONE;i++){
      const u=(i+0.5)/N_DRONE, p=FORM[x](u,i), q=FORM[y](u,i);
      mx=Math.max(mx,Math.hypot(q[0]-p[0],q[1]-p[1],q[2]-p[2]))}}));
  // a weight edge of width Wd moves a drone at most mx*1.5/Wd; solve for Wd,
  // leaving 45% of the speed budget for lift and beat breathing
  return mx*1.5/(DRONE_LIMITS.max_speed*0.55)})();

function sectionWeights(t){
  const S=(MAP.sections||[]); const out=[]; let tot=0;
  for(let k=0;k<S.length;k++){
    const a=S[k].at, b=(k+1<S.length)?S[k+1].at:DUR;
    const w=ss(a-MSOFT*0.5,a+MSOFT*0.5,t)*(1-ss(b-MSOFT*0.5,b+MSOFT*0.5,t));
    if(w>1e-5){out.push([S[k].id,w]); tot+=w}}
  if(!out.length) return [['A',1]];
  return out.map(o=>[o[0],o[1]/tot])}

function dronePos(i,t,e){
  const u=(i+0.5)/N_DRONE, W=sectionWeights(t);
  let x=0,y=0,z=0;
  for(const [id,w] of W){const p=formOf(id)(u,i); x+=p[0]*w; y+=p[1]*w; z+=p[2]*w}
  /* lift and breathing draw on the same velocity budget, so both run off the
     SLOW energy and stay small */
  const eS=eMotion(t);
  const lift=(-4)+20*eS;
  const br=1+0.024*accent(bph(t),e)*(0.35+0.9*eS);
  const drift=panAt(t)*9;
  return [x*br+drift, cl(y*br+lift, DRONE_LIMITS.floor, DRONE_LIMITS.ceil), z*br]}

/* one drone per pitch class and octave, so the swarm PLAYS the melody: a drone
   brightens on the note it owns. Nothing in the lighting reader can do this. */
const NOTE_OWNER=(function(){
  const m={};
  for(let p=24;p<=108;p++) m[p]=(p*7)%N_DRONE;
  return m})();
function noteGlow(i,t){
  const src=(MAP.observations&&MAP.observations.notes&&MAP.observations.notes.sources)||{};
  let g=0;
  for(const k in src){
    const A=src[k];
    // narrow window scan; the arrays are time-sorted
    let lo=0,hi=A.length-1,st=0;
    while(lo<=hi){const mid=(lo+hi)>>1; if(A[mid][0]<=t){st=mid;lo=mid+1}else hi=mid-1}
    for(let j=st;j>=0&&j>st-40;j--){
      const n=A[j], dt=t-n[0];
      if(dt<0||dt>n[1]+0.28) continue;
      if(NOTE_OWNER[n[2]]!==i) continue;
      const env=dt<0.05?ss(0,0.05,dt):1-ss(0,1,cl((dt-0.05)/(n[1]+0.23)));
      g=Math.max(g,env*Math.min(1,n[4]*2.4))}}
  return cl(g)}

function droneFrame(t){
  const L=primaryLook(t), e=en(t), F=[];
  const col=fixColour(t,L,'par',0.5,e);
  const alt=fixColour(t,L,'head',0.5,e);
  const dip=(function(){ if(!ANT) return 1;
    const[d,dt]=until('drop',t,BAR); return d?1-0.55*ss(0,1,1-dt/BAR):1 })();
  const stab=accentHit(t);
  for(let i=0;i<N_DRONE;i++){
    const p=dronePos(i,t,e);
    const ng=noteGlow(i,t);
    const base=(L==='stop')?0.02:(0.12+0.42*e);
    const lv=cl((base+0.55*ng+0.22*stab)*dip);
    const mix=cl(0.25+0.75*ng);
    const c=[Math.round(lerp(col[0],alt[0],mix)),Math.round(lerp(col[1],alt[1],mix)),
             Math.round(lerp(col[2],alt[2],mix))];
    F.push({id:'d'+i, x:+p[0].toFixed(2), y:+p[1].toFixed(2), z:+p[2].toFixed(2),
            r:c[0], g:c[1], b:c[2], level:+lv.toFixed(3)})}
  return {t:+t.toFixed(3), look:L, drones:F}}
