/* ================= renderer v2 =================
   v1 optimised the data and neglected the image. Five things were wrong and all
   five are image problems, not frame problems:
     no bloom, a room that was not dark, flat banded beams, no floor reflection,
     and no sense of a place.                                                  */
const cv=$('#room'),cx=cv.getContext('2d');
const OC=document.createElement('canvas'), ox=OC.getContext('2d');   // scene buffer
let CWv=0,CHv=0,DPR=Math.min(2,window.devicePixelRatio||1),QUAL=1;
let g=cx;                                        // the context currently drawn into
function fit(){const st=document.getElementById('stage');
  CWv=st.clientWidth||1000; CHv=st.clientHeight||Math.round(CWv*0.585);
  cv.width=Math.round(CWv*DPR);cv.height=Math.round(CHv*DPR);
  OC.width=cv.width;OC.height=cv.height;
  cx.setTransform(DPR,0,0,DPR,0,0);ox.setTransform(DPR,0,0,DPR,0,0)}
new ResizeObserver(function(){fit();if(typeof render==='function')render()})
  .observe(document.getElementById('stage'));
function fullscreen(){const st=document.getElementById('stage');
  if(document.fullscreenElement) document.exitFullscreen();
  else if(st.requestFullscreen) st.requestFullscreen();
  else if(st.webkitRequestFullscreen) st.webkitRequestFullscreen()}
document.addEventListener('fullscreenchange',function(){setTimeout(function(){fit();render()},60)});

var ROOM={w:8,h:3.4,d:6};
/* lower, wider, in the crowd looking up at the trusses -- an eye-level box at
   56 degrees reads as an architectural diagram */
const VIEWS=[{eye:[4.0,1.35,-3.4],at:[4.0,2.05,4.2],fov:74},
             {eye:[-1.4,1.15,-1.2],at:[4.6,1.90,4.6],fov:76},
             {eye:[4.0,3.15,-1.2],at:[4.0,0.20,4.0],fov:78},
             {eye:[4.0,1.05,5.2],at:[4.0,2.60,-1.5],fov:80}];
let CAM={...VIEWS[0]};
function setView(i){VIEW=i;[0,1,2,3].forEach(j=>{const b=$('#v'+j);if(b)b.classList.toggle('on',i===j)});
  CAM={...VIEWS[i]};render()}

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

let POS={};
LAYOUT.fixtures.forEach(f=>{POS[f.id]=[f.at[0],f.at[1],f.at[2]]});
const OF=k=>LAYOUT.fixtures.filter(f=>f.kind===k).map(f=>f.id);
let R_PARS=OF('par'),R_UPS=OF('uplight'),R_HEADS=OF('head'),
      R_STROBES=OF('strobe'),R_STRIPS=OF('strip');
let PAR_AIM={};
R_PARS.forEach(function(id){const p=POS[id];
  PAR_AIM[id]=[p[0]+(4.0-p[0])*0.34,0,Math.max(0.9,p[2]-3.9)]});
let TRUSS=(function(){const m={};LAYOUT.fixtures.forEach(function(f){
  if(f.kind==='head'||f.kind==='strobe'){const k=f.at[2].toFixed(1);
    m[k]=Math.max(m[k]||0,f.at[1])}});return m})();
/* tight beams. A real head is 5-15 degrees; v1 used a wide cone that read as a blob */
const SPREAD={head:0.19,par:0.62,uplight:0.34,strobe:1.25,blinder:2.20};

function headAim(id,pan,tilt){
  const p=POS[id];
  const yaw=(pan-0.5)*2*(58*Math.PI/180);
  const pit=0.20+tilt*1.10;
  const dir=[Math.sin(pit)*Math.sin(yaw),-Math.cos(pit),Math.sin(pit)*Math.cos(yaw)];
  const s=Math.min(10.5,p[1]/Math.max(Math.cos(pit),0.10));
  return [p[0]+dir[0]*s,Math.max(0,p[1]+dir[1]*s),p[2]+dir[2]*s]}

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
    const al=lv*Math.pow(1-t0,1.6)*(0.06+0.40*haze)/mul;
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
  beam([src[0],-src[1],src[2]],[aim[0],-aim[1],aim[2]],c,lv*0.34,haze*0.85,spread)}

function pool(a,c,lv,rr){
  if(lv<0.006) return;
  const K=QUAL?20:12;
  g.globalCompositeOperation='lighter';
  for(const [k,al] of [[1.0,0.13],[0.55,0.17],[0.26,0.24]]){
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
  for(let i=0;i<34;i++) r.push([0.35+R()*7.3, 0.9+R()*2.6, 0.80+R()*0.22, R()]);
  return r.sort((a,b)=>b[1]-a[1])})();
function crowd(t,e){
  CROWD.forEach(function(p){
    const bob=0.035*Math.sin(2*Math.PI*(t/(2*BAR))+p[3]*6.3)*(0.4+0.9*e);
    const h=p[2]+bob, q=proj([p[0],h,p[1]],CAM), f=proj([p[0],0,p[1]],CAM);
    if(!q||!f) return;
    const w=Math.max(3,0.30*q.s), hh=Math.abs(f.y-q.y);
    g.fillStyle='rgba(0,0,0,0.94)';
    g.beginPath();
    g.moveTo(q.x-w*0.62,f.y); g.lineTo(q.x-w*0.62,q.y+hh*0.30);
    g.quadraticCurveTo(q.x-w*0.60,q.y,q.x,q.y);
    g.quadraticCurveTo(q.x+w*0.60,q.y,q.x+w*0.62,q.y+hh*0.30);
    g.lineTo(q.x+w*0.62,f.y); g.closePath(); g.fill()})}

function hazeAt(t){
  let h=HAZE;
  for(const m of MO) if(m.kind==='drop'){
    const on0=m.at-9,on1=m.at-7;
    if(t>on0){const filled=Math.min(1,(Math.min(t,on1)-on0)/2);
      h+=0.42*filled*Math.exp(-Math.max(0,t-on1)/45)}}
  return Math.min(1,h)}

function scene(f){
  const t=f.t;
  g.clearRect(0,0,CWv,CHv);
  g.fillStyle='#000';g.fillRect(0,0,CWv,CHv);                 // near-black, no wash
  const G={};f.fixtures.forEach(o=>G[o.id]=o);
  /* A fixture id that is not in this frame must not crash the room. It happens
     the moment anyone changes rigs, and it did. */
  const ZED={id:'-',r:0,g:0,b:0,level:0,strobe:0,pan:0.5,tilt:0.5,zoom:0.5,pixels:[]};
  const get=id=>G[id]||ZED;
  const hz=hazeAt(t), gm=v=>Math.pow(Math.max(0,v),1/1.7);
  const stro=id=>{const o=get(id); if(!o) return 0; return o.strobe>0?o.level*((((t*o.strobe)%1)<0.42)?1:0.03):o.level};

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

function drawRoom(f){
  if(DRIFT){const w=0.26*Math.sin(f.t*0.094),hh=0.10*Math.sin(f.t*0.067+1.1);
    CAM={...VIEWS[VIEW]};
    CAM.eye=[VIEWS[VIEW].eye[0]+w,VIEWS[VIEW].eye[1]+hh,VIEWS[VIEW].eye[2]]}
  else CAM={...VIEWS[VIEW]};
  if(!QUAL){ g=cx; scene(f); return }
  g=ox; scene(f);                                   // draw into the buffer
  g=cx;
  cx.setTransform(1,0,0,1,0,0);
  cx.globalCompositeOperation='source-over';
  cx.clearRect(0,0,cv.width,cv.height);
  cx.drawImage(OC,0,0);
  /* bloom: two blurred additive passes. Every real club image has glare around
     a bright source; without it light reads as coloured plastic. */
  cx.globalCompositeOperation='lighter';
  cx.filter='blur('+Math.round(7*DPR)+'px)'; cx.globalAlpha=0.62; cx.drawImage(OC,0,0);
  cx.filter='blur('+Math.round(26*DPR)+'px)';cx.globalAlpha=0.40; cx.drawImage(OC,0,0);
  cx.filter='none';cx.globalAlpha=1;cx.globalCompositeOperation='source-over';
  cx.setTransform(DPR,0,0,DPR,0,0);
  const sf=window.__sf||0;
  if(sf>0.02){cx.globalCompositeOperation='lighter';
    cx.fillStyle='rgba(255,252,246,'+(0.13*sf).toFixed(3)+')';cx.fillRect(0,0,CWv,CHv);
    cx.globalCompositeOperation='source-over'}}

/* A venue switch changes which fixtures exist. The renderer keeps its own lists
   and its own scene, and rebuilding only the recipe's tables left this one
   looking up ids that were no longer in the frame -- which crashed the room the
   first time anyone changed rigs. */
function rendererReset(){
  POS={}; LAYOUT.fixtures.forEach(f=>{POS[f.id]=[f.at[0],f.at[1],f.at[2]]});
  R_PARS=OF('par'); R_UPS=OF('uplight'); R_HEADS=OF('head').concat(OF('wash'));
  R_STROBES=OF('strobe').concat(OF('blinder')); R_STRIPS=OF('strip');
  PAR_AIM={};
  R_PARS.forEach(function(id){const p=POS[id];
    PAR_AIM[id]=[p[0]+(LAYOUT.size_m.w/2-p[0])*0.32, 0, Math.max(0.9,p[2]-3.6)]});
  TRUSS={}; LAYOUT.fixtures.forEach(function(f){
    if(f.kind==='head'||f.kind==='strobe'||f.kind==='wash'||f.kind==='blinder'){
      const k=f.at[2].toFixed(1); TRUSS[k]=Math.max(TRUSS[k]||0,f.at[1])}});
  ROOM.w=LAYOUT.size_m.w; ROOM.h=LAYOUT.size_m.h; ROOM.d=LAYOUT.size_m.d;
}
