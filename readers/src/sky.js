/* ================= renderer: SKY =================
   Drones are points of light against black, which is a much easier thing to draw
   convincingly than volumetric beams -- an additive glow per drone, sorted back
   to front, is most of the way there. */
const skyCv=$('#sky'), sx=skyCv.getContext('2d');
let SW=0,SH=0;
const SKYVIEWS=[{eye:[0,4,-150],at:[0,42,0],fov:38},
                {eye:[-118,16,-86],at:[0,44,0],fov:40},
                {eye:[0,132,-30],at:[0,30,0],fov:52},
                {eye:[0,6,-72],at:[0,50,0],fov:56}];
function skyFit(){SW=window.innerWidth;SH=window.innerHeight;
  const d=Math.min(2,window.devicePixelRatio||1);
  skyCv.width=SW*d;skyCv.height=SH*d;sx.setTransform(d,0,0,d,0,0)}
function sproj(p,cam){
  const f=[cam.at[0]-cam.eye[0],cam.at[1]-cam.eye[1],cam.at[2]-cam.eye[2]];
  const fl=Math.hypot(f[0],f[1],f[2]), fz=[f[0]/fl,f[1]/fl,f[2]/fl];
  let rx=[fz[2],0,-fz[0]]; const rl=Math.hypot(rx[0],rx[1],rx[2])||1;
  rx=[rx[0]/rl,0,rx[2]/rl];
  const uy=[rx[1]*fz[2]-rx[2]*fz[1],rx[2]*fz[0]-rx[0]*fz[2],rx[0]*fz[1]-rx[1]*fz[0]];
  const d=[p[0]-cam.eye[0],p[1]-cam.eye[1],p[2]-cam.eye[2]];
  const z=d[0]*fz[0]+d[1]*fz[1]+d[2]*fz[2]; if(z<=0.5) return null;
  const x=d[0]*rx[0]+d[1]*rx[1]+d[2]*rx[2], y=d[0]*uy[0]+d[1]*uy[1]+d[2]*uy[2];
  const k=(SH*0.5)/Math.tan(cam.fov*Math.PI/360);
  return {x:SW/2+k*x/z, y:SH/2-k*y/z, z:z, s:k/z}}
function drawSky(f){
  const t=f.t;
  let cam={...SKYVIEWS[VIEW%SKYVIEWS.length]};
  if(DRIFT){cam.eye=[cam.eye[0]+7*Math.sin(t*0.045),cam.eye[1]+2.5*Math.sin(t*0.031+1.1),cam.eye[2]]}
  const g=sx.createLinearGradient(0,0,0,SH);
  g.addColorStop(0,'#020306');g.addColorStop(0.62,'#04060c');g.addColorStop(1,'#070a12');
  sx.fillStyle=g;sx.fillRect(0,0,SW,SH);
  // a horizon and a hint of ground, so altitude reads
  const h=sproj([0,0,0],cam);
  if(h){sx.fillStyle='rgba(255,255,255,.022)';sx.fillRect(0,h.y,SW,SH-h.y);
    sx.fillStyle='rgba(255,255,255,.06)';sx.fillRect(0,h.y,SW,1)}
  const pts=[];
  for(const d of f.drones){const q=sproj([d.x,d.y,d.z],cam); if(q) pts.push([q,d])}
  pts.sort((a,b)=>b[0].z-a[0].z);
  sx.globalCompositeOperation='lighter';
  for(const [q,d] of pts){
    const lv=Math.pow(d.level,1/1.6); if(lv<0.004) continue;
    /* A drone ninety metres away is a POINT. The radius must be a small pixel
       size that falls off with distance, not the raw projection scale -- that
       gave 38 px cores and 340 px glows, and a hundred and twenty of them
       additively is a sun. And the per-drone alpha has to be low enough that a
       dense formation stays a swarm rather than a white mass. */
    const R=Math.max(1.1,Math.min(5.0, 190/q.z));
    const GLOW=R*4.0;
    const gr=sx.createRadialGradient(q.x,q.y,0,q.x,q.y,GLOW);
    gr.addColorStop(0,'rgba('+d.r+','+d.g+','+d.b+','+(0.60*lv).toFixed(3)+')');
    gr.addColorStop(0.30,'rgba('+d.r+','+d.g+','+d.b+','+(0.16*lv).toFixed(3)+')');
    gr.addColorStop(1,'rgba(0,0,0,0)');
    sx.fillStyle=gr;sx.beginPath();sx.arc(q.x,q.y,GLOW,0,7);sx.fill();
    sx.fillStyle='rgba('+d.r+','+d.g+','+d.b+','+(0.85*lv).toFixed(3)+')';
    sx.beginPath();sx.arc(q.x,q.y,R,0,7);sx.fill();
    if(lv>0.55){sx.fillStyle='rgba(255,255,255,'+(0.55*(lv-0.55)/0.45).toFixed(3)+')';
      sx.beginPath();sx.arc(q.x,q.y,R*0.5,0,7);sx.fill()}}
  sx.globalCompositeOperation='source-over';
  /* a soft ceiling: dim the whole frame back when a lot of drones are bright at
     once, which is the additive equivalent of stopping a camera down */
  const load=f.drones.reduce((a,d)=>a+d.level,0)/f.drones.length;
  if(load>0.42){sx.globalCompositeOperation='multiply';
    const k=Math.max(0.45,1-(load-0.42)*1.3);
    sx.fillStyle='rgba('+Math.round(255*k)+','+Math.round(255*k)+','+Math.round(255*k)+',1)';
    sx.fillRect(0,0,SW,SH);sx.globalCompositeOperation='source-over'}}
