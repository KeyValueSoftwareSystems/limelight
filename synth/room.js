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
/* ---- the room ---------------------------------------------------------------
   A front elevation, drawn for a rig you can count on two hands. Seven fixtures
   have to look real; ninety-four can hide behind their own number.

   What makes a beam read as light in air rather than a coloured triangle:
     - it is drawn three times, wide and faint, then narrower, then a bright
       core. Real scattering falls off across the cone, and one flat gradient
       cannot show that.
     - everything is additive, so where two beams cross they brighten, which is
       the single most recognisable thing about a hazed room.
     - the whole thing is scaled by how much haze is in the air. No fog, no
       beam -- you only ever see the pool on the floor, which is exactly what
       happens in a room with the foggers off.
     - the lens itself glows, the floor takes an elliptical pool, and both are
       drawn separately from the beam because they survive when the haze does not.
*/
function drawRoom(cv, fr, layout){
  const W = cv.clientWidth, Hpx = cv.clientHeight || 200, dpr = window.devicePixelRatio || 1;
  if(cv.width !== W*dpr || cv.height !== Hpx*dpr){ cv.width = W*dpr; cv.height = Hpx*dpr }
  const g = cv.getContext("2d"); g.setTransform(dpr,0,0,dpr,0,0);
  g.fillStyle = "#05060a"; g.fillRect(0,0,W,Hpx);
  if(!fr || !layout) return;

  const fx = layout.fixtures || [];
  const size = layout.size_m || {w:8,h:3.4};
  const pad = Math.max(18, W*0.045);
  const sx = v => pad + (v/size.w) * (W - 2*pad);
  const floorY = Hpx * 0.80;
  const sy = v => floorY - (v/(size.h||3.4)) * (floorY - Hpx*0.06);

  const by = {}; for(const o of fr.fixtures) by[o.id] = o;
  const C = o => [o.r!==undefined?o.r:255, o.g!==undefined?o.g:255, o.b!==undefined?o.b:255];
  const lit = o => o && (o.level||0) > 0.012;

  // haze comes from the foggers, and everything airborne is scaled by it
  let haze = 0;
  for(const f of fx) if(f.kind==="fog" && by[f.id]) haze = Math.max(haze, by[f.id].level||0);
  haze = 0.30 + 0.70*haze;                       // never quite zero: rooms are dusty

  // the air itself, thicker near the floor
  const air = g.createLinearGradient(0, Hpx*0.05, 0, floorY);
  air.addColorStop(0, `rgba(120,140,190,${(0.010*haze).toFixed(4)})`);
  air.addColorStop(1, `rgba(120,140,190,${(0.055*haze).toFixed(4)})`);
  g.fillStyle = air; g.fillRect(0,0,W,floorY);

  g.globalCompositeOperation = "lighter";
  for(const f of fx){
    const o = by[f.id];
    if(!lit(o) || f.kind==="fog" || f.kind==="strip") continue;
    const [r,gr,b] = C(o), L = o.level;
    const px = sx(f.at[0]), py = sy(f.at[1]);

    // where it points. A head sweeps across the room and down; a par hangs.
    const pan  = o.pan  !== undefined ? o.pan  : 0.5;
    const tilt = o.tilt !== undefined ? o.tilt : 0.62;
    const reachY = floorY - py;
    const tx = f.kind === "head"
      ? px + (pan - 0.5) * (W - 2*pad) * 1.15
      : px + (pan - 0.5) * (W - 2*pad) * 0.14;
    // a par hangs and lights the floor; a head can aim short or long. Either way
    // the beam has to REACH the floor or there is no pool, and the pool is the
    // part that survives when the haze thins
    const ty = f.kind === "head" ? py + reachY * (0.62 + 0.52*tilt) : floorY;

    const spread = Math.tan(((f.beam_deg || 22) * Math.PI/180) / 2);
    const len = Math.hypot(tx-px, ty-py) || 1;
    const half = Math.max(5, spread * len);

    // three passes: wide and faint, mid, then a bright core
    for(const [wf, af, lf] of [[1.00, 0.42, 1.00], [0.52, 0.58, 0.98], [0.18, 0.85, 0.95]]){
      const ex = px + (tx-px)*lf, ey = py + (ty-py)*lf, hw = half*wf;
      const grad = g.createLinearGradient(px,py,ex,ey);
      const a0 = Math.min(0.92, af * (0.35 + 0.65*L) * haze);
      grad.addColorStop(0,    `rgba(${r},${gr},${b},${a0.toFixed(3)})`);
      grad.addColorStop(0.55, `rgba(${r},${gr},${b},${(a0*0.45).toFixed(3)})`);
      grad.addColorStop(1,    `rgba(${r},${gr},${b},0)`);
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(px - 2.5, py); g.lineTo(px + 2.5, py);
      g.lineTo(ex + hw, ey);  g.lineTo(ex - hw, ey);
      g.closePath(); g.fill();
    }

    // the pool on the floor survives with no haze at all
    if(ty > floorY - reachY*0.25){
      const pw = Math.max(14, half*1.7), ph = Math.max(6, half*0.40);
      const pool = g.createRadialGradient(tx,floorY,0,tx,floorY,pw);
      pool.addColorStop(0,   `rgba(${r},${gr},${b},${(0.60*L).toFixed(3)})`);
      pool.addColorStop(0.5, `rgba(${r},${gr},${b},${(0.22*L).toFixed(3)})`);
      pool.addColorStop(1,   `rgba(${r},${gr},${b},0)`);
      g.fillStyle = pool;
      g.beginPath(); g.ellipse(tx, floorY, pw, ph, 0, 0, 6.2832); g.fill();
    }

    // the lens
    const gl = g.createRadialGradient(px,py,0,px,py,16 + 26*L);
    gl.addColorStop(0, `rgba(${r},${gr},${b},${Math.min(0.95,0.85*L).toFixed(3)})`);
    gl.addColorStop(1, `rgba(${r},${gr},${b},0)`);
    g.fillStyle = gl; g.beginPath(); g.arc(px,py,16+26*L,0,6.2832); g.fill();
  }
  g.globalCompositeOperation = "source-over";

  // floor, then a black crowd so brightness has something to read against
  g.strokeStyle = "rgba(200,215,255,.13)"; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0,floorY); g.lineTo(W,floorY); g.stroke();
  g.fillStyle = "#020306";
  const n = Math.max(14, (W/34)|0);
  for(let i=0;i<n;i++){
    const hx = (i+0.5)/n*W + ((i*37)%11 - 5);
    const hh = (Hpx-floorY)*(0.34 + ((i*53)%7)/26);
    g.beginPath(); g.ellipse(hx, floorY + hh*0.55, Math.max(3,W/n*0.30), hh*0.62, 0, 0, 6.2832);
    g.fill();
  }

  // the bodies of the fixtures, so an unlit rig is still visible
  for(const f of fx){
    if(f.kind==="fog") continue;
    const o = by[f.id], px = sx(f.at[0]), py = sy(f.at[1]);
    g.fillStyle = lit(o) ? "#0c0e14" : "#151924";
    g.beginPath(); g.arc(px,py,f.kind==="head"?4.6:3.6,0,6.2832); g.fill();
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
