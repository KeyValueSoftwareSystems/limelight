/* ================= renderer v3 =================
   v2 was hand-rolled canvas-2D: nested flat cones, and bloom faked with two
   blurred copies of the frame. The five faults it was written to fix are image
   faults, so they belong on a GPU. Same five, now done properly:
     volumetric beam cones with a hot core, UnrealBloom, ACES + sRGB, a room
     that is actually dark, a mirrored floor, floor pools, and a crowd.
   v2 is kept below, verbatim but renamed, and takes over whenever three.js or
   WebGL2 is missing. A CDN miss degrades; it never blanks the page.
   frame(t) is untouched -- this block only draws what it is handed.        */

/* ---------- facts both renderers share ---------- */
var ROOM={w:8,h:3.4,d:6};
/* lower, wider, in the crowd looking up at the trusses -- an eye-level box at
   56 degrees reads as an architectural diagram */
const VIEWS=[{eye:[4.0,1.35,-3.4],at:[4.0,2.05,4.2],fov:74},
             {eye:[-1.4,1.15,-1.2],at:[4.6,1.90,4.6],fov:76},
             {eye:[4.0,3.15,-1.2],at:[4.0,0.20,4.0],fov:78},
             {eye:[4.0,1.05,5.2],at:[4.0,2.60,-1.5],fov:80}];
let POS={};
LAYOUT.fixtures.forEach(f=>{POS[f.id]=[f.at[0],f.at[1],f.at[2]]});
const OF=k=>LAYOUT.fixtures.filter(f=>f.kind===k).map(f=>f.id);
let R_PARS=OF('par'),R_UPS=OF('uplight'),R_HEADS=OF('head'),
      R_STROBES=OF('strobe').concat(OF('blinder')),R_STRIPS=OF('strip');
let PAR_AIM={};
R_PARS.forEach(function(id){const p=POS[id];
  PAR_AIM[id]=[p[0]+(4.0-p[0])*0.34,0,Math.max(0.9,p[2]-3.9)]});
const UP_AIM={};
R_UPS.forEach(function(id){UP_AIM[id]=[POS[id][0],ROOM.h,ROOM.d-0.12]});
const STROBE_AIM={};
R_STROBES.forEach(function(id){STROBE_AIM[id]=[POS[id][0]<4?2.4:5.6,0.30,4.4]});
const TRUSS=(function(){const m={};LAYOUT.fixtures.forEach(function(f){
  if(f.kind==='head'||f.kind==='strobe'){const k=f.at[2].toFixed(1);
    m[k]=Math.max(m[k]||0,f.at[1])}});return m})();
/* tight beams. A real head is 5-15 degrees; v1 used a wide cone that read as a blob */
const SPREAD={head:0.19,par:0.62,uplight:0.34,strobe:1.25,blinder:2.20};      // metres at the aim point (v2)
const HALF={blinder:26.0,head:0.070,par:0.300,uplight:0.160,strobe:0.400};    // half-angle in radians (v3)
/* NPXof comes from the recipe */

function headAim(id,pan,tilt){
  const p=POS[id];
  const yaw=(pan-0.5)*2*(58*Math.PI/180);
  const pit=0.20+tilt*1.10;
  const dir=[Math.sin(pit)*Math.sin(yaw),-Math.cos(pit),Math.sin(pit)*Math.cos(yaw)];
  const s=Math.min(10.5,p[1]/Math.max(Math.cos(pit),0.10));
  return [p[0]+dir[0]*s,Math.max(0,p[1]+dir[1]*s),p[2]+dir[2]*s]}

function hazeAt(t){
  let h=HAZE;
  for(const m of MO) if(m.kind==='drop'){
    const on0=m.at-9,on1=m.at-7;
    if(t>on0){const filled=Math.min(1,(Math.min(t,on1)-on0)/2);
      h+=0.42*filled*Math.exp(-Math.max(0,t-on1)/45)}}
  return Math.min(1,h)}

let CWv=0,CHv=0,DPR=Math.min(2,window.devicePixelRatio||1);
let cv=$('#room');                  /* the surface snap() saves; re-pointed if we fall back */
let RMODE='pending';                 /* 'pending' | 'gl' | '2d' */
/* strobe: chop the level rather than the fixture, exactly as v2 did */
const chop=(t,hz,duty,lo)=>(((t*hz)%1)<duty?1:lo);

function note(msg){
  try{
    let el=document.getElementById('glnote');
    if(!el){const h=document.querySelector('.hud.t'); if(!h) return;
      el=document.createElement('span');el.id='glnote';el.className='chip2';
      el.style.color='#f0b429';h.appendChild(el)}
    el.textContent=msg;
  }catch(e){}}
function fogChip(on){
  try{
    let el=document.getElementById('fogchip');
    if(!el){const h=document.querySelector('.hud.t'); if(!h) return;
      el=document.createElement('span');el.id='fogchip';el.className='chip2';
      el.style.color='#28c98a';el.style.display='none';
      el.textContent='fog — commanded 9 s early';h.appendChild(el)}
    const d=on?'':'none';
    if(el.style.display!==d) el.style.display=d;
  }catch(e){}}

/* ================= v2, the canvas-2D fallback =================
   Byte-for-byte the old renderer apart from the names: fit -> fit2D,
   scene -> scene2D, drawRoom -> drawRoom2D, and a context taken lazily so the
   #room canvas is not claimed for 2D before we know whether WebGL is coming. */
let cx=null,OC=null,ox=null,g=null;
let CAM={...VIEWS[0]};
function init2D(){
  cx=cv.getContext('2d');
  OC=document.createElement('canvas'); ox=OC.getContext('2d');   // scene buffer
  g=cx}
function fit2D(){
  cv.width=Math.round(CWv*DPR);cv.height=Math.round(CHv*DPR);
  OC.width=cv.width;OC.height=cv.height;
  cx.setTransform(DPR,0,0,DPR,0,0);ox.setTransform(DPR,0,0,DPR,0,0)}

function proj(p,cam){
  const f=[cam.at[0]-cam.eye[0],cam.at[1]-cam.eye[1],cam.at[2]-cam.eye[2]];
  const fl=Math.hypot(f[0],f[1],f[2]), fz=[f[0]/fl,f[1]/fl,f[2]/fl];
  let rx=[fz[2],0,-fz[0]]; const rl=Math.hypot(rx[0],rx[1],rx[2])||1;
  rx=[rx[0]/rl,rx[1]/rl,rx[2]/rl];
  const uy=[rx[1]*fz[2]-rx[2]*fz[1],rx[2]*fz[0]-rx[0]*fz[2],rx[0]*fz[1]-rx[1]*fz[0]];
  const d=[p[0]-cam.eye[0],p[1]-cam.eye[1],p[2]-cam.eye[2]];
  const zz=d[0]*fz[0]+d[1]*fz[1]+d[2]*fz[2];
  if(zz<=0.06) return null;
  const xx=d[0]*rx[0]+d[1]*rx[1]+d[2]*rx[2];
  const yy=d[0]*uy[0]+d[1]*uy[1]+d[2]*uy[2];
  const k=(CHv*0.5)/Math.tan(cam.fov*Math.PI/360);
  return {x:CWv/2+k*xx/zz,y:CHv/2-k*yy/zz,z:zz,s:k/zz}}

function poly(pts,fill){for(const q of pts) if(!q) return;
  g.beginPath();g.moveTo(pts[0].x,pts[0].y);
  for(let i=1;i<pts.length;i++)g.lineTo(pts[i].x,pts[i].y);
  g.closePath();g.fillStyle=fill;g.fill()}

/* A beam is three nested cones -- wide and faint, medium, and a narrow hot core.
   Additive, so the profile across the beam falls off instead of banding. */
function cone(src,aim,c,lv,haze,spread,mul){
  const dir=[aim[0]-src[0],aim[1]-src[1],aim[2]-src[2]];
  const len=Math.hypot(dir[0],dir[1],dir[2]); if(len<0.05) return;
  const u=[dir[0]/len,dir[1]/len,dir[2]/len];
  let pv=[u[2],0,-u[0]]; const pl=Math.hypot(pv[0],pv[1],pv[2])||1; pv=[pv[0]/pl,0,pv[2]/pl];
  const R=QUAL?6:3;
  for(let i=0;i<R;i++){
    const t0=i/R,t1=(i+1)/R;
    const mk=(tt,rr)=>{const q=[src[0]+u[0]*len*tt,src[1]+u[1]*len*tt,src[2]+u[2]*len*tt];
      return [proj([q[0]-pv[0]*rr,q[1],q[2]-pv[2]*rr],CAM),
              proj([q[0]+pv[0]*rr,q[1],q[2]+pv[2]*rr],CAM)]};
    const r0=0.035*mul, r1=spread*mul;
    const A=mk(t0,r0+(r1-r0)*t0), B=mk(t1,r0+(r1-r0)*t1);
    const al=lv*Math.pow(1-t0,1.6)*(0.09+0.52*haze)/mul;
    poly([A[0],A[1],B[1],B[0]],'rgba('+c[0]+','+c[1]+','+c[2]+','+al.toFixed(4)+')')}}
function beam(src,aim,c,lv,haze,spread){
  if(lv<0.006) return;
  g.globalCompositeOperation='lighter';
  cone(src,aim,c,lv,haze,spread,2.6);          // outer glow
  cone(src,aim,c,lv,haze,spread,1.0);          // body
  cone(src,aim,[Math.min(255,c[0]+70),Math.min(255,c[1]+70),Math.min(255,c[2]+70)],
       lv,haze,spread,0.34);                    // hot core
  g.globalCompositeOperation='source-over'}

/* a polished floor is geometrically exact: mirror source and aim through y=0 */
function beamRefl(src,aim,c,lv,haze,spread){
  if(lv<0.010) return;
  beam([src[0],-src[1],src[2]],[aim[0],-aim[1],aim[2]],c,lv*0.32,haze*0.85,spread)}

function pool(a,c,lv,rr){
  if(lv<0.006) return;
  const K=QUAL?20:12;
  g.globalCompositeOperation='lighter';
  for(const [k,al] of [[1.0,0.095],[0.55,0.13],[0.26,0.185]]){
    const pts=[];
    for(let i=0;i<K;i++){const th=i/K*Math.PI*2;
      pts.push(proj([a[0]+Math.cos(th)*rr*k,0.004,a[2]+Math.sin(th)*rr*k*0.78],CAM))}
    poly(pts,'rgba('+c[0]+','+c[1]+','+c[2]+','+(al*lv).toFixed(4)+')')}
  g.globalCompositeOperation='source-over'}

function wallGlow(x,c,lv){
  if(lv<0.006) return;
  const a=proj([x-0.95,0.0,ROOM.d-0.02],CAM), b=proj([x+0.95,0.0,ROOM.d-0.02],CAM),
        t2=proj([x+0.95,ROOM.h,ROOM.d-0.02],CAM), t1=proj([x-0.95,ROOM.h,ROOM.d-0.02],CAM);
  if(!a||!b||!t1||!t2) return;
  g.globalCompositeOperation='lighter';
  const gr=g.createLinearGradient(a.x,a.y,t1.x,t1.y);
  gr.addColorStop(0,'rgba('+c[0]+','+c[1]+','+c[2]+','+(0.34*lv).toFixed(4)+')');
  gr.addColorStop(0.55,'rgba('+c[0]+','+c[1]+','+c[2]+','+(0.10*lv).toFixed(4)+')');
  gr.addColorStop(1,'rgba(0,0,0,0)');
  g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b.x,b.y);g.lineTo(t2.x,t2.y);g.lineTo(t1.x,t1.y);
  g.closePath();g.fillStyle=gr;g.fill();g.globalCompositeOperation='source-over'}

function body(id,c,lv,kind){
  const q=proj(POS[id],CAM); if(!q) return;
  const R=Math.max(2.4,(kind==='head'?8:kind==='strobe'?11:6)*q.s/170);
  g.fillStyle='#0a0d12';g.strokeStyle='rgba(255,255,255,.10)';g.lineWidth=1;
  if(kind==='strobe'){g.beginPath();g.roundRect(q.x-R*1.6,q.y-R*0.6,R*3.2,R*1.2,2);g.fill();g.stroke()}
  else{g.beginPath();g.arc(q.x,q.y,R,0,7);g.fill();g.stroke()}
  if(lv>0.01){g.globalCompositeOperation='lighter';
    g.fillStyle='rgba('+c[0]+','+c[1]+','+c[2]+','+Math.pow(lv,0.55).toFixed(3)+')';
    g.beginPath();g.arc(q.x,q.y,R*0.66,0,7);g.fill();
    g.globalCompositeOperation='source-over'}}

function stripDraw(id,px){
  const f=LAYOUT.fixtures.find(x=>x.id===id), y=f.at[1], z=f.at[2], n=px.length;
  g.globalCompositeOperation='lighter';
  for(let i=0;i<n;i++){const c=px[i]; if(c[0]+c[1]+c[2]<8) continue;
    const x0=0.25+(ROOM.w-0.5)*i/n, x1=0.25+(ROOM.w-0.5)*(i+1)/n;
    poly([proj([x0,y-0.04,z],CAM),proj([x1,y-0.04,z],CAM),
          proj([x1,y+0.07,z],CAM),proj([x0,y+0.07,z],CAM)],
         'rgba('+c[0]+','+c[1]+','+c[2]+',0.95)');
    poly([proj([x0,-y+0.04,z],CAM),proj([x1,-y+0.04,z],CAM),
          proj([x1,-y-0.07,z],CAM),proj([x0,-y-0.07,z],CAM)],
         'rgba('+c[0]+','+c[1]+','+c[2]+',0.30)');}
  g.globalCompositeOperation='source-over'}

/* a dark crowd in the foreground: scale, occlusion, and instantly a room */
const CROWD=(function(){const r=[],R=(s=>()=>(s=(s*16807)%2147483647)/2147483647)(7);
  for(let i=0;i<34;i++){const u=R();
    // depth biased AWAY from the camera so the crowd recedes instead of forming
    // a fence, and shoulders vary, and the height is a real human height
    r.push([0.30+R()*7.4, 0.55+Math.pow(u,0.55)*4.15, 1.52+R()*0.34, R(), 0.80+R()*0.46])}
  return r.sort((a,b)=>b[1]-a[1])})();
function crowd(t,e){
  CROWD.forEach(function(p){
    const bob=0.035*Math.sin(2*Math.PI*(t/(2*BAR))+p[3]*6.3)*(0.4+0.9*e);
    const h=p[2]+bob, q=proj([p[0],h,p[1]],CAM), f=proj([p[0],0,p[1]],CAM);
    if(!q||!f) return;
    const w=Math.max(3,0.30*q.s*(p[4]||1)), hh=Math.abs(f.y-q.y);
    g.fillStyle='#000';
    g.beginPath();
    g.moveTo(q.x-w*0.62,f.y); g.lineTo(q.x-w*0.62,q.y+hh*0.30);
    g.quadraticCurveTo(q.x-w*0.60,q.y,q.x,q.y);
    g.quadraticCurveTo(q.x+w*0.60,q.y,q.x+w*0.62,q.y+hh*0.30);
    g.lineTo(q.x+w*0.62,f.y); g.closePath(); g.fill()})}

function scene2D(f){
  const t=f.t;
  g.clearRect(0,0,CWv,CHv);
  g.fillStyle='#000';g.fillRect(0,0,CWv,CHv);                 // near-black, no wash
  const G={};f.fixtures.forEach(o=>G[o.id]=o);
  const ZED={id:'-',r:0,g:0,b:0,level:0,strobe:0,pan:0.5,tilt:0.5,zoom:0.5,pixels:[]};
  const get=id=>G[id]||ZED;
  const hz=hazeAt(t), gm=v=>Math.pow(Math.max(0,v),1/1.7);
  const stro=id=>{const o=get(id);return o.strobe>0?o.level*((((t*o.strobe)%1)<0.42)?1:0.03):o.level};

  // trusses, barely there
  g.strokeStyle='rgba(255,255,255,.055)';g.lineWidth=2.5;
  Object.keys(TRUSS).forEach(function(z){
    const a=proj([0.25,TRUSS[z],+z],CAM),b=proj([ROOM.w-0.25,TRUSS[z],+z],CAM);
    if(a&&b){g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b.x,b.y);g.stroke()}});
  {const a=proj([0.25,2.90,5.20],CAM),b=proj([ROOM.w-0.25,2.90,5.20],CAM);
   if(a&&b){g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b.x,b.y);g.stroke()}}

  R_UPS.forEach(function(id){const o=get(id),lv=gm(o.level);
    wallGlow(POS[id][0],[o.r,o.g,o.b],lv);
    beam(POS[id],[POS[id][0],ROOM.h,ROOM.d-0.12],[o.r,o.g,o.b],lv,hz,SPREAD.uplight)});
  R_PARS.forEach(function(id){const o=get(id);pool(PAR_AIM[id],[o.r,o.g,o.b],gm(o.level),1.30)});
  R_HEADS.forEach(function(id){const o=get(id);
    pool(headAim(id,o.pan,o.tilt),[o.r,o.g,o.b],gm(o.level),0.42)});
  // reflections under the floor, then the real thing on top
  R_HEADS.forEach(function(id){const o=get(id);let lv=gm(o.level);
    if(o.strobe>0) lv*=(((t*o.strobe)%1)<0.45)?1:0.06;
    beamRefl(POS[id],headAim(id,o.pan,o.tilt),[o.r,o.g,o.b],lv,hz,SPREAD.head)});
  R_PARS.forEach(function(id){const o=get(id);
    beamRefl(POS[id],PAR_AIM[id],[o.r,o.g,o.b],gm(o.level),hz,SPREAD.par)});
  R_PARS.forEach(function(id){const o=get(id);
    beam(POS[id],PAR_AIM[id],[o.r,o.g,o.b],gm(o.level),hz,SPREAD.par)});
  R_HEADS.forEach(function(id){const o=get(id);let lv=gm(o.level);
    if(o.strobe>0) lv*=(((t*o.strobe)%1)<0.45)?1:0.06;
    beam(POS[id],headAim(id,o.pan,o.tilt),[o.r,o.g,o.b],lv,hz,SPREAD.head)});
  let sf=0;
  R_STROBES.forEach(function(id){const on=stro(id); sf=Math.max(sf,on);
    const tx=POS[id][0]<4?2.4:5.6;
    beam(POS[id],[tx,0.30,4.4],[255,252,246],on,hz,SPREAD.strobe)});
  R_STRIPS.forEach(function(id){stripDraw(id,get(id).pixels)});
  R_PARS.forEach(function(id){const o=get(id);body(id,[o.r,o.g,o.b],gm(o.level),'par')});
  R_UPS.forEach(function(id){const o=get(id);body(id,[o.r,o.g,o.b],gm(o.level),'par')});
  R_HEADS.forEach(function(id){const o=get(id);body(id,[o.r,o.g,o.b],gm(o.level),'head')});
  R_STROBES.forEach(function(id){body(id,[255,252,246],stro(id),'strobe')});
  crowd(t,en(t));
  if(hz>0.02){g.globalCompositeOperation='lighter';
    g.fillStyle='rgba(96,116,158,'+(0.008+0.016*hz).toFixed(4)+')';g.fillRect(0,0,CWv,CHv);
    g.globalCompositeOperation='source-over'}
  window.__haze=hz; window.__sf=sf;
  if(get('fog_1').level>0){g.fillStyle='#28c98a';g.font='600 12px ui-sans-serif';g.textAlign='left';
    g.fillText('fog — commanded 9 s early',16,CHv-46)}}

/* the 2-D path had no exposure control at all, so a drop simply clipped. Same
   idea as the GL path: measure the frame's own emitted light and stop down. */
function load2D(f){let s=0,n=0;
  for(const o of f.fixtures){ if(o.id==='fog_1'||o.held_back) continue;
    if('level'in o){s+=o.level;n++}
    else if(o.pixels){let m=0;for(const q of o.pixels)m=Math.max(m,(q[0]+q[1]+q[2])/765);s+=m;n++}}
  return n?s/n:0}
function drawRoom2D(f){
  if(DRIFT){const w=0.26*Math.sin(f.t*0.094),hh=0.10*Math.sin(f.t*0.067+1.1);
    CAM={...VIEWS[VIEW]};
    CAM.eye=[VIEWS[VIEW].eye[0]+w,VIEWS[VIEW].eye[1]+hh,VIEWS[VIEW].eye[2]]}
  else CAM={...VIEWS[VIEW]};
  if(!QUAL){ g=cx; scene2D(f); return }
  g=ox; scene2D(f);                                 // draw into the buffer
  g=cx;
  cx.setTransform(1,0,0,1,0,0);
  cx.globalCompositeOperation='source-over';
  cx.clearRect(0,0,cv.width,cv.height);
  cx.drawImage(OC,0,0);
  /* bloom: two blurred additive passes. Every real club image has glare around
     a bright source; without it light reads as coloured plastic. */
  cx.globalCompositeOperation='lighter';
  const EX2=1.25/(1+1.0*load2D(f));
  cx.filter='blur('+Math.round(7*DPR)+'px)'; cx.globalAlpha=0.42*EX2; cx.drawImage(OC,0,0);
  cx.filter='blur('+Math.round(26*DPR)+'px)';cx.globalAlpha=0.26*EX2; cx.drawImage(OC,0,0);
  cx.filter='none';cx.globalAlpha=1;cx.globalCompositeOperation='source-over';
  cx.setTransform(DPR,0,0,DPR,0,0);
  const sf=window.__sf||0;
  if(sf>0.02){cx.globalCompositeOperation='lighter';
    cx.fillStyle='rgba(255,252,246,'+(0.06*sf).toFixed(3)+')';cx.fillRect(0,0,CWv,CHv);
    cx.globalCompositeOperation='source-over'}}

/* ================= v3, WebGL ================= */
const CDN='https://cdn.jsdelivr.net/npm/three@0.132.2/';
/* classic global scripts, not modules: this page is opened over file://.
   Order matters -- ShaderPass/RenderPass/UnrealBloomPass do
   `class X extends THREE.Pass`, and THREE.Pass is defined by EffectComposer.js,
   so that has to be in memory before they parse. */
const CDN_FILES=[
  ['build/three.min.js'],
  ['examples/js/shaders/CopyShader.js',
   'examples/js/shaders/LuminosityHighPassShader.js',
   'examples/js/postprocessing/EffectComposer.js'],
  ['examples/js/postprocessing/ShaderPass.js',
   'examples/js/postprocessing/RenderPass.js',
   'examples/js/postprocessing/UnrealBloomPass.js']];

/* One beam = one cone shell, drawn additively from both sides. Alpha falls off
   along the beam (uD/vT) and away from its axis: the shell's own normal, dotted
   with the eye, is ~1 where the view ray runs down the middle of the cone and
   ~0 at the silhouette, which is a cheap stand-in for the path length through
   the volume. Two exponents -- a soft body and a tight core. */
const BEAM_VS=[
'varying float vT;','varying vec3 vN;','varying vec3 vE;',
'void main(){',
'  vT = position.y;',
'  vec4 mv = modelViewMatrix * vec4( position, 1.0 );',
'  vN = normalMatrix * normal;',
'  vE = -mv.xyz;',
'  gl_Position = projectionMatrix * mv;',
'}'].join('\n');
const BEAM_FS=[
'uniform vec3 uColor;','uniform float uI;','uniform float uD;','uniform float uCore;',
'varying float vT;','varying vec3 vN;','varying vec3 vE;',
'void main(){',
'  float t = clamp( vT, 0.0, 1.0 );',
'  float along = mix( 1.0, pow( 1.0 - t, 1.9 ), 0.80 );',
'  float d = clamp( abs( dot( normalize( vN ), normalize( vE ) ) ), 0.0, 1.0 );',
'  float a = uI * uD * ( 0.11 + 0.55 * pow( d, 2.0 ) + 1.30 * pow( d, uCore ) ) * along;',
'  a *= smoothstep( 0.0, 0.04, t ) * ( 1.0 - smoothstep( 0.93, 1.0, t ) );',
'  gl_FragColor = vec4( uColor * a, 1.0 );',
'  #include <tonemapping_fragment>',
'  #include <encodings_fragment>',
'}'].join('\n');

/* The scene renders linear and untone-mapped into the composer's half-float
   buffer, so bloom sees real HDR. This last pass is where the picture becomes
   an image: ACES, then sRGB. In the fast path the composer is bypassed and the
   renderer's own ACES + sRGB do the same job, which is why the beam shader
   carries three's tonemapping/encodings includes -- they are no-ops when
   rendering into a linear target and live when rendering to the canvas. */
const ACES_SHADER={
  uniforms:{tDiffuse:{value:null},exposure:{value:1.0},air:{value:0.0}},
  vertexShader:[
  'varying vec2 vUv;',
  'void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }'
  ].join('\n'),
  fragmentShader:[
  'uniform sampler2D tDiffuse;','uniform float exposure;','uniform float air;',
  'varying vec2 vUv;',
  'vec3 aces( vec3 x ){',
  '  return clamp( ( x * ( 2.51 * x + 0.03 ) ) / ( x * ( 2.43 * x + 0.59 ) + 0.14 ), 0.0, 1.0 );',
  '}',
  'vec3 srgb( vec3 c ){',
  '  vec3 hi = 1.055 * pow( max( c, vec3( 0.0 ) ), vec3( 0.41666 ) ) - 0.055;',
  '  return mix( hi, c * 12.92, vec3( lessThanEqual( c, vec3( 0.0031308 ) ) ) );',
  '}',
  'void main(){',
  '  vec3 c = texture2D( tDiffuse, vUv ).rgb;',
  '  c += air * vec3( 0.004, 0.005, 0.009 );',
  '  gl_FragColor = vec4( srgb( aces( c * exposure ) ), 1.0 );',
  '}'].join('\n')};

const GAIN={par:1.05,up:0.92,head:1.45,strobe:1.30};   // beam brightness per kind
/* AUTO-EXPOSURE. The old chain raised exposure with brightness (1.05 + 0.35*haze
   + 0.30*strobe), multiplied a 2.30 strobe gain, and fed a bloom at strength
   1.135 -- so a drop went pure white and nothing was judgeable. A camera in a
   club stops down. `load` is the frame's own emitted light, so this is still a
   pure function of t with no state. */
function frameLoad(f){
  let sum=0,n=0;
  for(let i=0;i<f.fixtures.length;i++){const o=f.fixtures[i];
    if(o.id==='fog_1') continue;
    if('level' in o){sum+=o.level;n++}
    else if(o.pixels){let m=0;for(let j=0;j<o.pixels.length;j++){
      const q=o.pixels[j];m=Math.max(m,(q[0]+q[1]+q[2])/765)} sum+=m;n++}}
  return n?sum/n:0}
const CORE={par:5.0,up:6.0,head:9.0,strobe:4.0};       // core exponent: tighter beam, tighter core
const POOLK={par:0.24,head:0.40,strobe:0.20};   // was a carpet, not light on a floor
const MIRROR=0.30;                                     // the floor's share
let GL=null,GLTRIED=false,GLSTRIKE=0;

function sRGBtoLin(x){return x<=0.04045?x/12.92:Math.pow((x+0.055)/1.055,2.4)}

function radialTex(T3,p){
  const c=document.createElement('canvas'); c.width=c.height=128;
  const x=c.getContext('2d');
  const gr=x.createRadialGradient(64,64,0,64,64,64);
  for(let i=0;i<=12;i++){const u=i/12;
    gr.addColorStop(u,'rgba(255,255,255,'+Math.pow(1-u,p).toFixed(4)+')')}
  x.fillStyle=gr;x.fillRect(0,0,128,128);
  const t=new T3.CanvasTexture(c);
  t.minFilter=T3.LinearFilter;t.magFilter=T3.LinearFilter;
  t.wrapS=t.wrapT=T3.ClampToEdgeWrapping;
  return t}
/* the back-wall wash: brightest at the skirting, fading up, with a soft edge
   sideways. Painted once into a 64px alpha map rather than another shader. */
function washTex(T3){
  const N=64,c=document.createElement('canvas'); c.width=c.height=N;
  const x=c.getContext('2d'),d=x.createImageData(N,N);
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){
    const u=(i+0.5)/N, v=(j+0.5)/N;                     // row 0 is the top of the plane
    const hv=Math.exp(-Math.pow((u-0.5)*2.5,2)*2.0);
    const vv=0.10*v+0.90*Math.pow(v,2.4);
    const a=Math.max(0,Math.min(1,hv*vv));
    const k=(j*N+i)*4;
    d.data[k]=255;d.data[k+1]=255;d.data[k+2]=255;d.data[k+3]=Math.round(a*255)}
  x.putImageData(d,0,0);
  const t=new T3.CanvasTexture(c);
  t.minFilter=T3.LinearFilter;t.magFilter=T3.LinearFilter;
  t.wrapS=t.wrapT=T3.ClampToEdgeWrapping;
  return t}

/* cone opening along +Y: apex at y=0, mouth of radius 1 at y=1, so a beam is
   position = the lamp, quaternion = +Y onto the aim direction, scale =
   (radius, length, radius). One geometry for all of them. */
function coneGeom(T3,rs,hs){
  const gm=new T3.CylinderGeometry(1,0.085,1,rs,hs,true);
  gm.translate(0,0.5,0);
  return gm}

/* 24 segments as one geometry: a face toward the room and a face toward the
   ceiling, so the strips read from eye level and from above. Colour lives in a
   vertex attribute, which is unclamped, so a segment can be brighter than white
   and bloom. The mirrored copy shares the attribute and gets it for free. */
function stripGeom(T3,id){
  const f=LAYOUT.fixtures.find(x=>x.id===id), y=f.at[1], z=f.at[2], n=NPXof(id);
  const pos=new Float32Array(n*12*3), col=new Float32Array(n*12*3);
  const yb=y-0.012, yt=y+0.030, z0=z-0.022, z1=z+0.022;
  let k=0;
  const put=(a,b,c)=>{pos[k++]=a;pos[k++]=b;pos[k++]=c};
  for(let i=0;i<n;i++){
    const x0=0.25+(ROOM.w-0.5)*i/n, x1=0.25+(ROOM.w-0.5)*(i+1)/n;
    put(x0,yb,z0);put(x1,yb,z0);put(x1,yt,z0);
    put(x0,yb,z0);put(x1,yt,z0);put(x0,yt,z0);
    put(x0,yt,z0);put(x1,yt,z0);put(x1,yt,z1);
    put(x0,yt,z0);put(x1,yt,z1);put(x0,yt,z1)}
  const gm=new T3.BufferGeometry();
  gm.setAttribute('position',new T3.BufferAttribute(pos,3));
  const ca=new T3.BufferAttribute(col,3);
  gm.setAttribute('color',ca);
  return {geom:gm,attr:ca,col:col,n:n}}

function initGL(){
  GLTRIED=true;
  const T3=window.THREE;
  const w0=Math.max(1,CWv||1000), h0=Math.max(1,CHv||600);

  const R=new T3.WebGLRenderer({canvas:cv,antialias:true,alpha:false,stencil:false,
    powerPreference:'high-performance',preserveDrawingBuffer:true});
  R.setClearColor(0x000000,1);
  R.outputEncoding=T3.sRGBEncoding;
  R.toneMapping=T3.NoToneMapping;       // the composer's last pass tone maps instead
  R.toneMappingExposure=1.0;
  R.setPixelRatio(DPR);
  R.setSize(w0,h0,false);

  const SC=new T3.Scene();
  const CM=new T3.PerspectiveCamera(VIEWS[0].fov,w0/h0,0.05,90);

  /* four transparent layers, in this order: the floor's reflection, the floor
     glass over it, then everything that emits. Three sorts the transparent list
     by a Group's renderOrder before anything else, which is the whole trick --
     the semi-opaque floor is what dims the reflection, so it has to be drawn
     between the two. Nothing in these layers writes depth. */
  const gOp=new T3.Group(); gOp.renderOrder=0;
  const gMi=new T3.Group(); gMi.renderOrder=1; gMi.scale.set(1,-1,1);
  const gFl=new T3.Group(); gFl.renderOrder=2;
  const gAd=new T3.Group(); gAd.renderOrder=3;
  SC.add(gOp); SC.add(gMi); SC.add(gFl); SC.add(gAd);

  /* ---- the room. Walls face inwards and are single-sided, so the three
     cameras that stand outside the box see straight through them. ---- */
  const PL=new T3.PlaneGeometry(1,1);
  const MAT_WALL=new T3.MeshBasicMaterial({color:0x000103,side:T3.FrontSide});
  const MAT_CEIL=new T3.MeshBasicMaterial({color:0x000104,side:T3.FrontSide});
  function panel(mat,w,h,px,py,pz,rx,ry){
    const m=new T3.Mesh(PL,mat);
    m.scale.set(w,h,1); m.position.set(px,py,pz); m.rotation.set(rx,ry,0);
    gOp.add(m); return m}
  panel(MAT_WALL,ROOM.w,ROOM.h,ROOM.w/2,ROOM.h/2,ROOM.d,0,Math.PI);        // back wall
  panel(MAT_WALL,14,ROOM.h,0,ROOM.h/2,2.0,0,Math.PI/2);                    // left
  panel(MAT_WALL,14,ROOM.h,ROOM.w,ROOM.h/2,2.0,0,-Math.PI/2);              // right
  panel(MAT_CEIL,ROOM.w+2,14,ROOM.w/2,ROOM.h,2.0,Math.PI/2,0);             // ceiling

  const MAT_FLOOR=new T3.MeshBasicMaterial({color:0x010208,transparent:true,opacity:0.34,
    depthWrite:false,side:T3.DoubleSide});
  const floor=new T3.Mesh(PL,MAT_FLOOR);
  floor.scale.set(20,18,1); floor.position.set(4,0,1); floor.rotation.x=-Math.PI/2;
  floor.renderOrder=2; gFl.add(floor);

  /* ---- truss: a tube per hang height, on two drop rods. Barely there. ---- */
  const MAT_TRUSS=new T3.MeshBasicMaterial({color:0x020305});   // was reading as grey scaffolding
  const TUBE=new T3.CylinderGeometry(0.042,0.042,1,8,1,false);
  const ROD=new T3.CylinderGeometry(0.012,0.012,1,5,1,false);
  function trussAt(y,z){
    const m=new T3.Mesh(TUBE,MAT_TRUSS);
    m.scale.set(1,ROOM.w-0.5,1); m.rotation.z=Math.PI/2;
    m.position.set(ROOM.w/2,y,z); gOp.add(m);
    [0.42,ROOM.w-0.42].forEach(function(x){
      const hh=Math.max(0.02,ROOM.h-y), r=new T3.Mesh(ROD,MAT_TRUSS);
      r.scale.set(1,hh,1); r.position.set(x,y+hh/2,z); gOp.add(r)})}
  Object.keys(TRUSS).forEach(function(z){trussAt(TRUSS[z],+z)});
  trussAt(2.90,5.20);

  /* ---- the crowd: two instanced meshes, near-black, bobbing on the bar
     clock. This is what makes the picture a room instead of a diagram. ---- */
  const CN=36;
  const CB=new T3.CylinderGeometry(0.165,0.115,1,11,1,false); CB.translate(0,0.5,0);
  const CH_=new T3.SphereGeometry(0.115,8,6);
  const MAT_CROWD=new T3.MeshBasicMaterial({color:0x000000});   // linear, and it must be 0
  const cbody=new T3.InstancedMesh(CB,MAT_CROWD,CN);
  const chead=new T3.InstancedMesh(CH_,MAT_CROWD,CN);
  cbody.frustumCulled=false; chead.frustumCulled=false;
  gOp.add(cbody); gOp.add(chead);
  const PEOPLE=[];
  (function(){let s=7;const rnd=function(){s=(s*16807)%2147483647;return s/2147483647};
    for(let i=0;i<CN;i++){
      const u=rnd();
      PEOPLE.push({x:0.30+rnd()*7.4,
        // bias depth AWAY from the camera: u^0.55 puts more of the crowd further
        // back, so they get smaller and the front row stops being a fence
        z:0.55+Math.pow(u,0.55)*4.15,
        h:1.52+rnd()*0.34, w:0.80+rnd()*0.46, ph:rnd()})}})();

  /* ---- beams. One geometry, one program; per fixture only a transform and
     three uniforms change. The mirrored twin copies the same local transform
     into a group scaled by -1 in y, which is an exact reflection. ---- */
  const coneHi=coneGeom(T3,28,6), coneLo=coneGeom(T3,12,2);
  const beams={};
  function mkBeam(id,core){
    const mk=function(host,c0){
      const u={uColor:{value:new T3.Color(1,1,1)},uI:{value:0},uD:{value:0.5},
               uCore:{value:c0}};
      const mat=new T3.ShaderMaterial({uniforms:u,vertexShader:BEAM_VS,fragmentShader:BEAM_FS,
        transparent:true,depthWrite:false,depthTest:true,side:T3.DoubleSide,
        blending:T3.AdditiveBlending});
      const m=new T3.Mesh(coneHi,mat);
      m.frustumCulled=false; m.visible=false; m.renderOrder=3; host.add(m);
      return {m:m,u:u}};
    const a=mk(gAd,core), b=mk(gMi,core);
    beams[id]={m:a.m,u:a.u,mm:b.m,mu:b.u}}

  const DISC=new T3.CircleGeometry(1,30);
  const RAD=radialTex(T3,2.2), WASH=washTex(T3);
  const pools={},lens={},washes={};
  function mkPool(id){
    const mat=new T3.MeshBasicMaterial({map:RAD,color:new T3.Color(0,0,0),transparent:true,
      depthWrite:false,side:T3.DoubleSide,blending:T3.AdditiveBlending});
    const m=new T3.Mesh(DISC,mat);
    m.rotation.x=-Math.PI/2; m.position.set(0,0.012,0);
    m.frustumCulled=false; m.visible=false; m.renderOrder=3; gAd.add(m);
    pools[id]=m}
  function mkLens(id,s){
    const mat=new T3.SpriteMaterial({map:RAD,color:new T3.Color(0,0,0),transparent:true,
      depthWrite:false,blending:T3.AdditiveBlending});
    const sp=new T3.Sprite(mat);
    sp.scale.set(s,s,1); sp.position.set(POS[id][0],POS[id][1],POS[id][2]);
    sp.renderOrder=3; gAd.add(sp); lens[id]=sp}
  function mkWash(id){
    const mat=new T3.MeshBasicMaterial({map:WASH,color:new T3.Color(0,0,0),transparent:true,
      depthWrite:false,side:T3.DoubleSide,blending:T3.AdditiveBlending});
    const m=new T3.Mesh(PL,mat);
    m.scale.set(2.6,ROOM.h,1); m.position.set(POS[id][0],ROOM.h/2,ROOM.d-0.015);
    m.rotation.y=Math.PI; m.frustumCulled=false; m.renderOrder=3; gAd.add(m);
    washes[id]=m}

  /* ---- fixture bodies: dark cans, plus an additive lens flare that carries
     the fixture's own colour. ---- */
  const MAT_BODY=new T3.MeshBasicMaterial({color:0x090c12});
  const G_CAN=new T3.CylinderGeometry(0.085,0.105,0.20,10,1,false);
  const G_HEAD=new T3.BoxGeometry(0.15,0.21,0.15);
  const G_STROBE=new T3.BoxGeometry(0.34,0.11,0.13);
  const G_UP=new T3.BoxGeometry(0.15,0.15,0.15);
  const _bq=new T3.Quaternion(), _bv=new T3.Vector3(), _by=new T3.Vector3(0,1,0);
  function can(id,gm,aim){
    const m=new T3.Mesh(gm,MAT_BODY);
    m.position.set(POS[id][0],POS[id][1],POS[id][2]);
    if(aim){const p=POS[id];
      _bv.set(aim[0]-p[0],aim[1]-p[1],aim[2]-p[2]).normalize();
      _bq.setFromUnitVectors(_by,_bv); m.quaternion.copy(_bq)}
    gOp.add(m); return m}

  R_PARS.forEach(function(id){mkBeam(id,CORE.par);mkPool(id);mkLens(id,0.30);
    can(id,G_CAN,PAR_AIM[id])});
  R_UPS.forEach(function(id){mkBeam(id,CORE.up);mkLens(id,0.22);mkWash(id);
    can(id,G_UP,null)});
  R_HEADS.forEach(function(id){mkBeam(id,CORE.head);mkPool(id);mkLens(id,0.24);
    can(id,G_HEAD,null)});
  R_STROBES.forEach(function(id){mkBeam(id,CORE.strobe);mkPool(id);mkLens(id,0.42);
    can(id,G_STROBE,null)});

  /* ---- strips ---- */
  const MAT_STRIP=new T3.MeshBasicMaterial({vertexColors:true,transparent:true,
    depthWrite:false,side:T3.DoubleSide,blending:T3.AdditiveBlending});
  const MAT_STRIP_M=new T3.MeshBasicMaterial({vertexColors:true,transparent:true,
    depthWrite:false,side:T3.DoubleSide,blending:T3.AdditiveBlending,
    color:new T3.Color(MIRROR,MIRROR,MIRROR)});
  const strips={};
  R_STRIPS.forEach(function(id){
    const s=stripGeom(T3,id);
    const m=new T3.Mesh(s.geom,MAT_STRIP); m.frustumCulled=false; m.renderOrder=3; gAd.add(m);
    const mm=new T3.Mesh(s.geom,MAT_STRIP_M); mm.frustumCulled=false; mm.renderOrder=1; gMi.add(mm);
    strips[id]=s});

  /* ---- composer: linear half-float buffer -> bloom -> ACES + sRGB.
     The buffer is a little larger than the canvas on 1x displays, which the
     final pass resolves back down; cheap supersampling, no extra script. ---- */
  let composer=null,bloom=null,aces=null,SS=(DPR>1.5?1.0:1.3);
  try{
    const pw=Math.max(1,Math.round(w0*DPR*SS)), ph=Math.max(1,Math.round(h0*DPR*SS));
    const rt=new T3.WebGLRenderTarget(pw,ph,{minFilter:T3.LinearFilter,magFilter:T3.LinearFilter,
      format:T3.RGBAFormat,type:T3.HalfFloatType,depthBuffer:true,stencilBuffer:false});
    composer=new T3.EffectComposer(R,rt);
    composer.addPass(new T3.RenderPass(SC,CM));
    bloom=new T3.UnrealBloomPass(new T3.Vector2(pw,ph),0.58,0.70,0.92);
    try{[bloom.renderTargetBright].concat(bloom.renderTargetsHorizontal,
      bloom.renderTargetsVertical).forEach(function(x){x.texture.type=T3.HalfFloatType})}catch(e){}
    composer.addPass(bloom);
    aces=new T3.ShaderPass(ACES_SHADER);
    composer.addPass(aces);
  }catch(e){console.error('bloom unavailable',e);composer=null;bloom=null;aces=null}

  GL={T3:T3,r:R,scene:SC,cam:CM,gOp:gOp,gMi:gMi,gFl:gFl,gAd:gAd,
      coneHi:coneHi,coneLo:coneLo,beams:beams,pools:pools,lens:lens,washes:washes,
      strips:strips,cbody:cbody,chead:chead,people:PEOPLE,crowdN:CN,
      composer:composer,bloom:bloom,aces:aces,ss:SS,qual:-1,map:{},
      q:new T3.Quaternion(),d:new T3.Vector3(),up:new T3.Vector3(0,1,0),
      c:new T3.Color(),m4:new T3.Matrix4(),p3:new T3.Vector3(),s3:new T3.Vector3(1,1,1),
      idq:new T3.Quaternion(),end:{x:0,y:0,z:0,r:0}};
  applyQual();
  try{cv.addEventListener('webglcontextlost',function(ev){ev.preventDefault();
    to2D('webgl context lost')},false)}catch(e){}
  if(!composer) note('bloom off — postprocessing unavailable');
}

function applyQual(){
  if(!GL) return;
  const T3=GL.T3;
  GL.qual=QUAL;
  const gm=QUAL?GL.coneHi:GL.coneLo;
  for(const id in GL.beams){const B=GL.beams[id];B.m.geometry=gm;B.mm.geometry=gm}
  if(GL.bloom) GL.bloom.enabled=!!QUAL;
  const n=QUAL?GL.crowdN:Math.max(8,Math.round(GL.crowdN*0.45));
  GL.cbody.count=n; GL.chead.count=n;
  try{GL.r.toneMapping=(QUAL&&GL.composer)?T3.NoToneMapping:T3.ACESFilmicToneMapping}catch(e){}}

function fitGL(){
  if(!GL) return;
  GL.r.setPixelRatio(DPR);
  GL.r.setSize(Math.max(1,CWv),Math.max(1,CHv),false);
  GL.cam.aspect=Math.max(0.2,CWv/Math.max(1,CHv));
  GL.cam.updateProjectionMatrix();
  if(GL.composer){
    const pw=Math.max(1,Math.round(CWv*DPR*GL.ss)), ph=Math.max(1,Math.round(CHv*DPR*GL.ss));
    GL.composer.setSize(pw,ph)}}

function camApply(t){
  const V=VIEWS[VIEW]||VIEWS[0];
  let ex=V.eye[0],ey=V.eye[1],ez=V.eye[2];
  if(DRIFT){ex+=0.26*Math.sin(t*0.094);ey+=0.10*Math.sin(t*0.067+1.1);
            ez+=0.16*Math.sin(t*0.053+2.2)}
  GL.cam.position.set(ex,ey,ez);
  GL.cam.lookAt(V.at[0],V.at[1],V.at[2]);
  if(GL.cam.fov!==V.fov){GL.cam.fov=V.fov;GL.cam.updateProjectionMatrix()}}

/* stop a beam at the first wall it meets, so nothing shoots out of the room */
function beamLen(sx,sy,sz,dx,dy,dz,len){
  let L=len;
  const lim=function(p,d,lo,hi){
    if(d>1e-6){const q=(hi-p)/d;if(q<L)L=q}
    else if(d<-1e-6){const q=(lo-p)/d;if(q<L)L=q}};
  lim(sx,dx,-0.05,ROOM.w+0.05);
  lim(sy,dy,-0.05,ROOM.h+0.05);
  lim(sz,dz,-0.05,ROOM.d+0.05);
  return Math.max(0.06,L)}

function setBeam(id,src,aim,cr,cg,cb,I,half,dens){
  const B=GL.beams[id]; if(!B) return null;
  let dx=aim[0]-src[0],dy=aim[1]-src[1],dz=aim[2]-src[2];
  let len=Math.sqrt(dx*dx+dy*dy+dz*dz);
  if(I<0.004||len<0.06){B.m.visible=false;B.mm.visible=false;return null}
  dx/=len;dy/=len;dz/=len;
  len=beamLen(src[0],src[1],src[2],dx,dy,dz,len);
  const rad=Math.max(0.02,len*Math.tan(half));
  GL.q.setFromUnitVectors(GL.up,GL.d.set(dx,dy,dz));
  GL.c.setRGB(cr/255,cg/255,cb/255).convertSRGBToLinear();
  B.m.visible=true;
  B.m.position.set(src[0],src[1],src[2]);
  B.m.quaternion.copy(GL.q);
  B.m.scale.set(rad,len,rad);
  B.u.uColor.value.copy(GL.c); B.u.uI.value=I; B.u.uD.value=dens;
  B.mm.visible=true;
  B.mm.position.copy(B.m.position); B.mm.quaternion.copy(GL.q); B.mm.scale.copy(B.m.scale);
  B.mu.uColor.value.copy(GL.c); B.mu.uI.value=I*MIRROR; B.mu.uD.value=dens*0.9;
  const e=GL.end;
  e.x=src[0]+dx*len; e.y=src[1]+dy*len; e.z=src[2]+dz*len; e.r=rad;
  return e}

function setPool(id,e,cr,cg,cb,I){
  const m=GL.pools[id]; if(!m) return;
  if(!e||I<0.004){m.visible=false;return}
  const grounded=1-Math.min(1,Math.max(0,(e.y-0.05)/0.65));
  const q=I*grounded;
  if(q<0.004){m.visible=false;return}
  m.visible=true;
  m.position.set(e.x,0.012,e.z);
  const rr=Math.max(0.22,e.r*1.9);
  m.scale.set(rr,rr,1);
  GL.c.setRGB(cr/255,cg/255,cb/255).convertSRGBToLinear();
  m.material.color.setRGB(GL.c.r*q,GL.c.g*q,GL.c.b*q)}

function setLens(id,cr,cg,cb,I){
  const sp=GL.lens[id]; if(!sp) return;
  if(I<0.004){sp.visible=false;return}
  sp.visible=true;
  GL.c.setRGB(cr/255,cg/255,cb/255).convertSRGBToLinear();
  sp.material.color.setRGB(GL.c.r*I,GL.c.g*I,GL.c.b*I)}

function setWash(id,cr,cg,cb,I){
  const m=GL.washes[id]; if(!m) return;
  if(I<0.004){m.visible=false;return}
  m.visible=true;
  GL.c.setRGB(cr/255,cg/255,cb/255).convertSRGBToLinear();
  m.material.color.setRGB(GL.c.r*I,GL.c.g*I,GL.c.b*I)}

function setStrip(id,px){
  const S=GL.strips[id]; if(!S||!px) return;
  const col=S.col, n=Math.min(S.n,px.length), K=1.35;
  for(let i=0;i<n;i++){
    const c=px[i]||[0,0,0];
    const r=sRGBtoLin(c[0]/255)*K, g2=sRGBtoLin(c[1]/255)*K, b=sRGBtoLin(c[2]/255)*K;
    const base=i*36;
    for(let k=0;k<12;k++){const o=base+k*3;col[o]=r;col[o+1]=g2;col[o+2]=b}}
  S.attr.needsUpdate=true}

function crowdGL(t,e){
  const P=GL.people, n=GL.cbody.count, amp=0.055*(0.35+0.95*e);
  for(let i=0;i<n;i++){
    const p=P[i];
    const bob=amp*(0.5+0.5*Math.sin(2*Math.PI*(t/(2*BAR))+p.ph*6.283));
    const hb=p.h-0.22;
    GL.p3.set(p.x,bob,p.z); GL.s3.set(p.w,hb,p.w);
    GL.m4.compose(GL.p3,GL.idq,GL.s3); GL.cbody.setMatrixAt(i,GL.m4);
    GL.p3.set(p.x,bob+p.h-0.115,p.z); GL.s3.set(p.w,p.w,p.w);
    GL.m4.compose(GL.p3,GL.idq,GL.s3); GL.chead.setMatrixAt(i,GL.m4)}
  GL.cbody.instanceMatrix.needsUpdate=true;
  GL.chead.instanceMatrix.needsUpdate=true}

function drawRoomGL(f){
  const t=f.t, hz=hazeAt(t), e=en(t);
  window.__haze=hz;
  if(QUAL!==GL.qual) applyQual();
  camApply(t);
  const G=GL.map, F=f.fixtures;
  for(let i=0;i<F.length;i++) G[F[i].id]=F[i];
  const dens=0.34+0.66*hz;
  let sf=0;

  for(let i=0;i<R_PARS.length;i++){const id=R_PARS[i],o=get(id);
    const I=Math.pow(cl(o.level),0.80)*GAIN.par;
    const end=setBeam(id,POS[id],PAR_AIM[id],o.r,o.g,o.b,I,HALF.par,dens);
    setPool(id,end,o.r,o.g,o.b,I*POOLK.par);
    setLens(id,o.r,o.g,o.b,I*0.45)}

  for(let i=0;i<R_UPS.length;i++){const id=R_UPS[i],o=get(id);
    const I=Math.pow(cl(o.level),0.80)*GAIN.up;
    setBeam(id,POS[id],UP_AIM[id],o.r,o.g,o.b,I,HALF.uplight,dens);
    setWash(id,o.r,o.g,o.b,I*1.30);
    setLens(id,o.r,o.g,o.b,I*0.40)}

  for(let i=0;i<R_HEADS.length;i++){const id=R_HEADS[i],o=get(id);
    let lv=cl(o.level);
    if(o.strobe>0) lv*=chop(t,o.strobe,0.45,0.06);
    const I=Math.pow(lv,0.80)*GAIN.head;
    const end=setBeam(id,POS[id],headAim(id,o.pan,o.tilt),o.r,o.g,o.b,I,HALF.head,dens);
    setPool(id,end,o.r,o.g,o.b,I*POOLK.head);
    setLens(id,o.r,o.g,o.b,I*0.55)}

  for(let i=0;i<R_STROBES.length;i++){const id=R_STROBES[i],o=get(id);
    const on=o.strobe>0?o.level*chop(t,o.strobe,0.42,0.03):o.level;
    if(on>sf) sf=on;
    const I=Math.pow(cl(on),0.80)*GAIN.strobe;
    const end=setBeam(id,POS[id],STROBE_AIM[id],255,252,246,I,HALF.strobe,dens);
    setPool(id,end,255,252,246,I*POOLK.strobe);
    setLens(id,255,252,246,I*0.60)}

  for(let i=0;i<R_STRIPS.length;i++){const id=R_STRIPS[i];setStrip(id,get(id).pixels)}

  crowdGL(t,e);
  window.__sf=sf;
  fogChip(!!(get('fog_1')&&get('fog_1').level>0));

  const load=frameLoad(f);
  const ex=(1.28+0.18*hz)/(1.0+1.05*load);
  GL.r.toneMappingExposure=ex;
  if(QUAL&&GL.composer){
    if(GL.bloom) GL.bloom.strength=0.46+0.26*hz;
    if(GL.aces){GL.aces.uniforms.exposure.value=ex;GL.aces.uniforms.air.value=hz}
    GL.composer.render();
  }else{
    GL.r.setRenderTarget(null);
    GL.r.render(GL.scene,GL.cam)}}

/* ================= the interface the rest of the page uses ================= */
function fit(){
  const st=document.getElementById('stage');
  CWv=st.clientWidth||1000; CHv=st.clientHeight||Math.round(CWv*0.585);
  if(RMODE==='gl') fitGL(); else if(RMODE==='2d') fit2D()}
new ResizeObserver(function(){fit();if(typeof render==='function')render()})
  .observe(document.getElementById('stage'));
function fullscreen(){const st=document.getElementById('stage');
  if(document.fullscreenElement) document.exitFullscreen();
  else if(st.requestFullscreen) st.requestFullscreen();
  else if(st.webkitRequestFullscreen) st.webkitRequestFullscreen()}
document.addEventListener('fullscreenchange',function(){setTimeout(function(){fit();
  if(typeof render==='function')render()},60)});
function setView(i){VIEW=i;[0,1,2,3].forEach(j=>{const b=$('#v'+j);if(b)b.classList.toggle('on',i===j)});
  CAM={...VIEWS[i]};
  if(typeof render==='function')render()}
let ROOMJS=true;
function drawRoom(f){
  if(RMODE==='gl'){
    try{drawRoomGL(f);GLSTRIKE=0}
    catch(err){
      console.error(err);
      /* degrade a step at a time: drop postprocessing first, and only give up
         on WebGL entirely if the plain path is broken too */
      GLSTRIKE++;
      if(GLSTRIKE===3&&GL&&GL.composer){GL.composer=null;GL.qual=-1;
        note('bloom off — postprocessing failed')}
      else if(GLSTRIKE>5) to2D('webgl render failed — 2D fallback')}
    return}
  if(RMODE==='2d'){
    const LR=(typeof window!=='undefined')&&window.LimelightRoom;
    if(ROOMJS&&LR&&LR.drawRoom){
      try{ LR.drawRoom(cv,f,LAYOUT); window.__haze=hazeAt(f.t); return }
      catch(err){ ROOMJS=false; console.error(err); note('room.js failed — built-in 2D') }
    }
    drawRoom2D(f);return}
  window.__haze=hazeAt(f.t)}          // still loading: the HUD keeps working

/* ---------- choosing a renderer ---------- */
function to2D(why){
  if(RMODE==='2d') return;
  RMODE='2d';
  try{if(GL&&GL.r)GL.r.dispose()}catch(e){}
  GL=null;
  /* a canvas cannot hand back a 2D context once WebGL has had it, so if we got
     as far as making a context we draw into a fresh canvas over the top and
     point `cv` -- the surface snap() saves -- at that instead */
  try{
    if(GLTRIED&&cv&&cv.parentNode){
      const n=document.createElement('canvas');
      n.id='room2d';
      n.style.cssText='position:absolute;left:0;top:0;width:100%;height:100%;display:block;z-index:1';
      cv.style.display='none';
      cv.parentNode.insertBefore(n,cv);
      cv=n}
  }catch(e){}
  init2D();
  note(why);
  fit();
  try{if(typeof render==='function')render()}catch(e){console.error(e)}}

let BOOTED=false;
function boot(why){
  if(BOOTED) return; BOOTED=true;
  let bad=null;
  const T3=window.THREE;
  if(!T3||!T3.WebGLRenderer)
    bad=(why==='slow')?'three.js did not load in time — 2D fallback'
                      :'three.js did not load — 2D fallback';
  else{
    const miss=['EffectComposer','RenderPass','ShaderPass','UnrealBloomPass','CopyShader',
                'LuminosityHighPassShader'].filter(function(k){return !T3[k]});
    if(miss.length) bad='missing '+miss[0]+' — 2D fallback'}
  if(!bad){
    try{
      const probe=document.createElement('canvas').getContext('webgl2');
      if(!probe) bad='no webgl2 — 2D fallback';
      else{const x=probe.getExtension('WEBGL_lose_context'); if(x)x.loseContext()}
    }catch(e){bad='no webgl2 — 2D fallback'}}
  if(bad){to2D(bad);return}
  try{initGL();RMODE='gl'}
  catch(e){console.error(e);to2D('webgl init failed — 2D fallback');return}
  fit();
  try{if(typeof render==='function')render()}
  catch(e){console.error(e);to2D('webgl render failed — 2D fallback')}}

(function loadCDN(){
  let gi=0;
  const nextGroup=function(){
    if(gi>=CDN_FILES.length){boot('');return}
    const list=CDN_FILES[gi++];
    let left=list.length;
    const step=function(){if(--left===0) nextGroup()};
    list.forEach(function(p){
      const s=document.createElement('script');
      s.src=CDN+p; s.async=false; s.onload=step; s.onerror=step;
      document.head.appendChild(s)})};
  setTimeout(function(){if(!BOOTED)boot('slow')},9000);   // a hung CDN falls back too
  nextGroup()})();



/* A venue switch changes which fixtures exist; these lists were built once. */
function rendererReset(){
  POS={}; LAYOUT.fixtures.forEach(f=>{POS[f.id]=[f.at[0],f.at[1],f.at[2]]});
  R_PARS=OF('par'); R_UPS=OF('uplight'); R_HEADS=OF('head').concat(OF('wash'));
  R_STROBES=OF('strobe').concat(OF('blinder')); R_STRIPS=OF('strip');
  PAR_AIM={}; R_PARS.forEach(function(id){const p=POS[id];
    PAR_AIM[id]=[p[0]+(ROOM.w/2-p[0])*0.32,0,Math.max(0.9,p[2]-3.6)]});
  ROOM.w=LAYOUT.size_m.w; ROOM.h=LAYOUT.size_m.h; ROOM.d=LAYOUT.size_m.d;
  if(typeof GL!=='undefined'&&GL){GL=null;BOOTED=false;RMODE='pending';boot('venue change')}}
