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


/* ---- fixtures, up close ------------------------------------------------------
   Not a room. One tile per fixture, big enough to read, for checking that the
   output is what you meant rather than for seeing what it would look like.
   A lamp shows its colour at its brightness; a head also shows where it points.
*/
function drawFixtures(cv, fr, layout){
  const W = cv.clientWidth, H = cv.clientHeight || 240, dpr = window.devicePixelRatio || 1;
  if(cv.width !== W*dpr || cv.height !== H*dpr){ cv.width = W*dpr; cv.height = H*dpr }
  const g = cv.getContext("2d"); g.setTransform(dpr,0,0,dpr,0,0);
  g.fillStyle = "#0b0d12"; g.fillRect(0,0,W,H);
  if(!fr || !layout) return;

  const fx = (layout.fixtures||[]).filter(f => f.kind !== "fog");
  const by = {}; for(const o of fr.fixtures) by[o.id] = o;
  const fogs = (layout.fixtures||[]).filter(f => f.kind === "fog")
                 .map(f => by[f.id]).filter(Boolean);
  const haze = fogs.length ? Math.max(...fogs.map(o => o.level||0)) : 0;

  const n = fx.length || 1;
  const gap = 10, pad = 12;
  const tw = (W - pad*2 - gap*(n-1)) / n;
  const th = Math.min(H - pad*2 - 26, tw * 1.35);
  const top = pad;

  fx.forEach((f, i) => {
    const o = by[f.id] || {};
    const L = o.level || 0;
    const r = o.r!==undefined?o.r:255, gg = o.g!==undefined?o.g:255, b = o.b!==undefined?o.b:255;
    const x = pad + i*(tw+gap), y = top;

    g.fillStyle = "#12151d"; g.strokeStyle = "#232838"; g.lineWidth = 1;
    g.beginPath(); g.roundRect(x, y, tw, th, 5); g.fill(); g.stroke();

    // the lens: colour at brightness, with a glow that scales with level
    const head = o.pan !== undefined;
    const cx = x + tw/2, cy = y + th*(head?0.30:0.40);
    const rad = Math.min(tw, th)*(head?0.19:0.24);
    if(L > 0.01){
      const glow = g.createRadialGradient(cx,cy,0,cx,cy,rad*2.6);
      glow.addColorStop(0, `rgba(${r},${gg},${b},${(0.55*L).toFixed(3)})`);
      glow.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      g.fillStyle = glow; g.beginPath(); g.arc(cx,cy,rad*2.6,0,6.2832); g.fill();
    }
    g.fillStyle = L > 0.01 ? `rgb(${(r*L)|0},${(gg*L)|0},${(b*L)|0})` : "#191d27";
    g.beginPath(); g.arc(cx,cy,rad,0,6.2832); g.fill();
    g.strokeStyle = "#2c3242"; g.stroke();

    // A head gets a position pad, which is how a lighting desk shows one: pan
    // across, tilt down, and a dot where the beam is aimed. A stub sticking out
    // of the lens told you the direction and nothing about the range it sits in.
    if(o.pan !== undefined){
      const pw = tw*0.62, ph = Math.min(th*0.26, pw*0.55);
      const px0 = cx - pw/2, py0 = y + th*0.60;
      g.fillStyle = "#0a0c11"; g.strokeStyle = "#242a38"; g.lineWidth = 1;
      g.beginPath(); g.roundRect(px0, py0, pw, ph, 3); g.fill(); g.stroke();
      g.strokeStyle = "#1b2029";
      g.beginPath(); g.moveTo(px0+pw/2, py0); g.lineTo(px0+pw/2, py0+ph);
      g.moveTo(px0, py0+ph/2); g.lineTo(px0+pw, py0+ph/2); g.stroke();
      const ax = px0 + o.pan*pw, ay = py0 + (o.tilt!==undefined?o.tilt:0.5)*ph;
      // a line from the lens to the aim point, so the pad reads as the beam
      g.strokeStyle = L>0.01 ? `rgba(${r},${gg},${b},0.35)` : "#232838";
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(cx, cy+rad*0.7); g.lineTo(ax, ay); g.stroke();
      if(L > 0.01){
        const dg = g.createRadialGradient(ax,ay,0,ax,ay,9);
        dg.addColorStop(0, `rgba(${r},${gg},${b},0.95)`);
        dg.addColorStop(1, `rgba(${r},${gg},${b},0)`);
        g.fillStyle = dg; g.beginPath(); g.arc(ax,ay,9,0,6.2832); g.fill();
      }
      g.fillStyle = L>0.01 ? `rgb(${r},${gg},${b})` : "#39414f";
      g.beginPath(); g.arc(ax,ay,2.6,0,6.2832); g.fill();
    }
    if(o.strobe > 0){
      g.fillStyle = "#f0a93c"; g.font = "600 10px ui-monospace,monospace";
      g.fillText(o.strobe.toFixed(1)+" Hz", x+8, y+16);
    }

    // the numbers, because this view exists to be checked against
    g.textAlign = "center";
    g.fillStyle = "#e6e9f1"; g.font = "600 12px ui-monospace,monospace";
    g.fillText(f.id, cx, y + th - 34);
    g.fillStyle = "#959bac"; g.font = "11px ui-monospace,monospace";
    g.fillText(L.toFixed(3), cx, y + th - 19);
    g.fillStyle = "#666c7e"; g.font = "9.5px ui-monospace,monospace";
    if(o.pan !== undefined)
      g.fillText(`pan ${o.pan.toFixed(2)}  tilt ${(o.tilt||0).toFixed(2)}`, cx, y + th - 6);
    else if(o.r !== undefined)
      g.fillText(`${r} ${gg} ${b}`, cx, y + th - 6);
    g.textAlign = "left";
  });

  // one line for the things that are not a lamp
  g.fillStyle = "#666c7e"; g.font = "10.5px ui-monospace,monospace";
  const lit = fx.filter(f => (by[f.id]||{}).level > 0.012).length;
  g.fillText(`haze ${haze.toFixed(2)}   ·   ${lit}/${fx.length} lit   ·   look ${fr.look||"—"}`,
             pad, H - 8);
}

if (typeof window !== "undefined") {
  window.LimelightRoom = { mkReader, prep, drawRoom, drawFixtures, frameDiff, pearson, totalLight };
}
