/* The room renderer and the frame comparison, in one place.

   Extracted from rooms.html so the editor can draw the same room. A second copy
   of a renderer is the specific bug that cost this project a day: the app shipped
   a stale twin of its own 2-D fallback and every fix went into the other one.
   Both pages load this file. */

function mkReader(map, layout){
  const g = prep(map);
  return new Function("MAP","LAYOUT","CH","SP","MO","EN","BEATS","PER","PH","DUR","BAR","DBP",
                      "STOP_REAL","ANT", RECIPE + "\n;return frame;")(
    g.MAP, layout, g.CH, g.SP, g.MO, g.EN, g.BEATS, g.PER, g.PH, g.DUR, g.BAR, g.DBP, true, true);
}
function prep(m){
  const PER=m.grid.period, PH=m.grid.phase, D=m.song.length;
  const BEATS=[]; for(let t=PH;t<D;t+=PER) BEATS.push(+t.toFixed(3));
  return {MAP:{accents:m.accents,obs:m.observations,sections:(m.sections&&m.sections.entries)||[],stems:m.stems},
    CH:(m.chapters||[]).map(c=>[c.at,c.name]),
    SP:(m.spans||[]).map(s=>({kind:s.kind,from:s.from,to:s.to,rise:s.rise})),
    MO:(m.moments||[]).map(x=>({at:x.at,kind:x.kind,v:x.size!==undefined?x.size:x.holds})),
    EN:m.energy||[], BEATS, PER, PH, DUR:D, BAR:4*PER, DBP:m.grid.bar_phase||0};
}
/* ---- the room: a front elevation, same projection both sides so a difference
   in the picture is a difference in the show and never in the drawing ---- */
function drawRoom(cv, fr, layout){
  const dpr=window.devicePixelRatio||1, W=cv.clientWidth, H=340;
  if(cv.width!==W*dpr||cv.height!==H*dpr){cv.width=W*dpr;cv.height=H*dpr}
  const g=cv.getContext("2d"); g.setTransform(dpr,0,0,dpr,0,0);
  g.fillStyle="#07080c"; g.fillRect(0,0,W,H);
  if(!fr) return;
  const fx=layout.fixtures, xs=fx.map(f=>f.at[0]), ys=fx.map(f=>f.at[1]);
  const x0=Math.min(...xs), x1=Math.max(...xs), y1=Math.max(...ys, 3.4);
  const pad=44, sx=v=>pad+(v-x0)/Math.max(0.1,x1-x0)*(W-2*pad);
  const floor=H-52, sy=v=>floor-(v/y1)*(floor-26);
  const byId={}; for(const o of fr.fixtures) byId[o.id]=o;
  const lit=o=>o&&(o.level||0)>0.012;
  // a strobe and a blinder emit white and carry no colour in the frame, which is
  // correct -- the frame only states what a fixture can actually be told
  const C=o=>[o.r!==undefined?o.r:255, o.g!==undefined?o.g:255, o.b!==undefined?o.b:255];

  // haze first, so beams read through it
  let load=0; for(const o of fr.fixtures) load+=(o.level||0); load/=Math.max(1,fr.fixtures.length);
  g.fillStyle="rgba(150,165,205,"+(0.012+0.05*load).toFixed(3)+")"; g.fillRect(0,0,W,floor);

  // beams: heads and pars, drawn additively so overlap brightens
  g.globalCompositeOperation="lighter";
  for(const f of fx){
    const o=byId[f.id]; if(!lit(o)) continue;
    if(f.kind!=="head"&&f.kind!=="par"&&f.kind!=="blinder") continue;
    const px=sx(f.at[0]), py=sy(f.at[1]);
    const pan=(o.pan!==undefined?o.pan:0.5), tilt=(o.tilt!==undefined?o.tilt:0.55);
    const ang=(pan-0.5)*1.55, reach=(0.34+0.66*tilt)*(floor-py)+34;
    const tx=px+Math.sin(ang)*reach*0.92, ty=py+Math.cos(ang*0.4)*reach;
    const half=(f.kind==="head"?10:20)+reach*0.055;
    const [cr,cg,cb]=C(o);
    const gr=g.createLinearGradient(px,py,tx,ty);
    const a=Math.min(0.5,0.44*o.level);
    gr.addColorStop(0,`rgba(${cr},${cg},${cb},${a.toFixed(3)})`);
    gr.addColorStop(1,`rgba(${cr},${cg},${cb},0)`);
    g.fillStyle=gr; g.beginPath(); g.moveTo(px-3,py); g.lineTo(px+3,py);
    g.lineTo(tx+half,ty); g.lineTo(tx-half,ty); g.closePath(); g.fill();
    const pool=g.createRadialGradient(tx,Math.min(ty,floor),0,tx,Math.min(ty,floor),half*1.7);
    pool.addColorStop(0,`rgba(${cr},${cg},${cb},${(0.30*o.level).toFixed(3)})`);
    pool.addColorStop(1,`rgba(${cr},${cg},${cb},0)`);
    g.fillStyle=pool; g.beginPath();
    g.ellipse(tx,Math.min(ty,floor),half*1.7,half*0.62,0,0,6.284); g.fill();
  }
  g.globalCompositeOperation="source-over";

  // floor and a black crowd, so brightness has something to read against
  g.strokeStyle="rgba(230,233,241,.16)"; g.lineWidth=1;
  g.beginPath(); g.moveTo(0,floor); g.lineTo(W,floor); g.stroke();
  g.fillStyle="#04050a";
  for(let i=0;i<46;i++){
    const hx=((i*97)%1000)/1000*W, hh=15+((i*53)%9);
    g.beginPath(); g.ellipse(hx,floor+11,4.6,hh*0.5,0,0,6.284); g.fill();
  }

  // the fixtures themselves
  for(const f of fx){
    const o=byId[f.id], px=sx(f.at[0]), py=sy(f.at[1]);
    if(f.kind==="strip"){
      const px2=o&&o.pixels?o.pixels:null, wid=(W-2*pad)/2.6, x=px-wid/2;
      g.fillStyle="#14161d"; g.fillRect(x,py-3,wid,6);
      if(px2) for(let i=0;i<px2.length;i++){
        const p=px2[i]; g.fillStyle=`rgb(${p[0]},${p[1]},${p[2]})`;
        g.fillRect(x+i/px2.length*wid,py-3,wid/px2.length+0.6,6)}
      continue;
    }
    const on=lit(o), rad=f.kind==="head"?5.4:f.kind==="strobe"?4.6:f.kind==="fog"?3:4.4;
    if(on){
      const [cr,cg,cb]=C(o);
      const gl=g.createRadialGradient(px,py,0,px,py,rad*4.6);
      gl.addColorStop(0,`rgba(${cr},${cg},${cb},${(0.85*o.level).toFixed(3)})`);
      gl.addColorStop(1,`rgba(${cr},${cg},${cb},0)`);
      g.fillStyle=gl; g.beginPath(); g.arc(px,py,rad*4.6,0,6.284); g.fill();
      g.fillStyle=`rgb(${cr},${cg},${cb})`;
    } else g.fillStyle="#1b1f2a";
    g.beginPath(); g.arc(px,py,rad,0,6.284); g.fill();
  }
}

function frameDiff(a,b){
  const A={}; for(const o of a.fixtures) A[o.id]=o;
  let n=0,s=0;
  for(const o of b.fixtures){
    const p=A[o.id]; if(!p) continue;
    if("level" in o && "level" in p){
      s+=Math.abs(o.level-p.level); n++;
      const la=(o.level+p.level)/2;
      if(la>0.02 && "r" in o && "r" in p){
        s+=(Math.abs(o.r-p.r)+Math.abs(o.g-p.g)+Math.abs(o.b-p.b))/765*la*2; n+=1 }
    }
    if("pan" in o && "pan" in p && "tilt" in o && "tilt" in p){
      s+=Math.abs(o.pan-p.pan)*0.5+Math.abs(o.tilt-p.tilt)*0.5; n++ }
    if(o.pixels&&p.pixels&&o.pixels.length===p.pixels.length){
      let d=0; for(let i=0;i<o.pixels.length;i++)
        d+=(Math.abs(o.pixels[i][0]-p.pixels[i][0])+Math.abs(o.pixels[i][1]-p.pixels[i][1])
           +Math.abs(o.pixels[i][2]-p.pixels[i][2]))/765;
      s+=d/o.pixels.length; n++;
    }
  }
  const r=n?s/n:0;
  return Number.isFinite(r)?r:0;
}
/* Averaging every channel over three minutes buries the only thing an audience
   actually sees. A light show reads as EVENTS: if the flashes land in the wrong
   place the show is wrong, however close the average brightness stays. A
   half-beat phase error scored 97.8% on the mean, which is a comfortable lie.
   So the headline compares the CHANGE in emitted light between the two rooms,
   which is what a transient is, and correlates the two sequences. Identical maps
   give 100%; a room flashing on the wrong half of the beat gives about zero. */
function pearson(a,b){
  const n=a.length, ma=a.reduce((x,y)=>x+y,0)/n, mb=b.reduce((x,y)=>x+y,0)/n;
  let sa=0,sb=0,sab=0;
  for(let i=0;i<n;i++){const da=a[i]-ma, db=b[i]-mb; sa+=da*da; sb+=db*db; sab+=da*db}
  return (sa&&sb)?sab/Math.sqrt(sa*sb):(sa===sb?1:0);
}
function totalLight(fr){ let s=0; for(const o of fr.fixtures) s+=(o.level||0); return s }


if (typeof window !== "undefined") {
  window.LimelightRoom = { mkReader, prep, drawRoom, frameDiff, pearson, totalLight };
}
