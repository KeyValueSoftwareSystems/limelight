/* The room renderer and the frame comparison, in one place.

   Extracted from rooms.html so the editor can draw the same room. A second copy
   of a renderer is the specific bug that cost this project a day: the app shipped
   a stale twin of its own 2-D fallback and every fix went into the other one.
   Both pages load this file. */

function mkReader(map, layout, drive, colour, ladder, knob, solo){
  const g = prep(map);
  return new Function("MAP","LAYOUT","CH","SP","MO","EN","BEATS","PER","PH","DUR","BAR","DBP",
                      "DOWN","PUMP","STOP_REAL","ANT","ENERGY","COLOUR","LADDER","KNOB","SOLORUNG", RECIPE + "\n;return frame;")(
    g.MAP, layout, g.CH, g.SP, g.MO, g.EN, g.BEATS, g.PER, g.PH, g.DUR, g.BAR, g.DBP, g.DOWN, g.PUMP, true, true,
    drive || "medium", colour || "sunset", ladder || 1,
    /* KNOB was numeric-only, and `+knob` turned any structured value into NaN --
       which made recipe_three's per-lamp assignment and recipe_gig's lead
       control silently fall back to their defaults while LOOKING like they
       worked. Strings now pass through untouched; recipe_steps.js does its own
       `+KNOB`, so numeric callers are unaffected. */
    (knob===undefined||knob===null) ? null
      : (typeof knob === "string" ? knob : +knob), solo || 0);
}
function prep(m){
  const PER=m.grid.period, PH=m.grid.phase, D=m.song.length;
  /* The file's beat list wins. This used to regenerate the beats from tempo and
     phase and throw away whatever the map actually said, which meant a map could
     not express a beat anywhere except where the formula put it -- and editing
     the list by hand did nothing at all. A map that carries beats is obeyed; one
     that does not still gets the formula. */
  const BEATS = (m.beats && m.beats.length) ? m.beats.slice().sort((a,b)=>a-b)
              : (()=>{ const b=[]; for(let t=PH;t<D;t+=PER) b.push(+t.toFixed(3)); return b })();
  return {MAP:{accents:m.accents,obs:m.observations,sections:(m.sections&&m.sections.entries)||[],stems:m.stems,
    /* the DECLARED tier: what a human with authority over the work says
       about it. Outranks measurement, stays visibly different from it. */
    declared:m.declared||null},
    CH:(m.chapters||[]).map(c=>[c.at,c.name]),
    SP:(m.spans||[]).map(s=>({kind:s.kind,from:s.from,to:s.to,rise:s.rise})),
    MO:(m.moments||[]).map(x=>({at:x.at,kind:x.kind,v:x.size!==undefined?x.size:x.holds})),
    EN:m.energy||[], BEATS, PER, PH, DUR:D, BAR:4*PER, DBP:m.grid.bar_phase||0,
    /* what the record does between kicks: the sidechain, measured not assumed */
    PUMP:((m.observations||{}).pump)||null,
    /* the downbeats the MAP names, not ones re-derived from bar_phase -- on Levels
       those two disagreed and the field was the one that was wrong */
    DOWN:(m.downbeats&&m.downbeats.length) ? m.downbeats.slice().sort((a,b)=>a-b)
         : BEATS.filter((_,i)=>((i-(m.grid.bar_phase||0))%4+4)%4===0)};
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
  const size = layout.size_m || {w:8, h:3.4, d:6};
  const pad = Math.max(14, W*0.030);
  const floorY = Hpx * 0.82, topY = Hpx * 0.035;
  const sx = v => pad + (v/size.w) * (W - 2*pad);
  const sy = v => floorY - (v/(size.h||3.4)) * (floorY - topY);

  /* A rig calls a light a Sharpy; the renderer only needs to know it is a hard
     narrow mover. Same table as the recipe, legacy names included. */
  const FAM = {beam:"beam", spot:"spot", head:"spot", sky:"sky", wash:"wash",
    par:"par", bar:"bar", strip:"bar", uplight:"uplight", blinder:"blinder",
    strobe:"strobe", wall:"wall", video:"wall", laser:"laser", co2:"co2",
    pyro:"pyro", confetti:"confetti", fog:"fog"};
  const fam = f => FAM[f.kind] || f.kind;
  const moves = f => (f.can||[]).indexOf("move") >= 0;

  /* Stage depth. Everything used to be drawn flat, so three trusses at three
     depths landed on one plane and the picture read as a wall of lamps rather
     than a stage. A vanishing point costs nothing and buys the whole geometry. */
  const VPX = W*0.5, VPY = floorY - (floorY - topY)*0.34;
  const depth = f => size.d ? Math.min(1, Math.max(0, (f.at[2]||0)/size.d)) : 0;
  const shrink = dz => 1/(1 + dz*0.62);
  const floorAt = k => VPY + (floorY - VPY)*k;

  const by = {}; for(const o of fr.fixtures) by[o.id] = o;
  const C = o => [o.r!==undefined?o.r:255, o.g!==undefined?o.g:255, o.b!==undefined?o.b:255];
  const lit = o => o && (o.level||0) > 0.012;
  const cl = (v,a,b) => v<a?a:v>b?b:v;

  // haze comes from the foggers, and everything airborne is scaled by it
  let haze = 0;
  for(const f of fx) if(fam(f)==="fog" && by[f.id]) haze = Math.max(haze, by[f.id].level||0);
  haze = 0.30 + 0.70*haze;                       // never quite zero: rooms are dusty

  // the air itself, thicker near the floor
  const air = g.createLinearGradient(0, topY, 0, floorY);
  air.addColorStop(0, `rgba(120,140,190,${(0.010*haze).toFixed(4)})`);
  air.addColorStop(1, `rgba(120,140,190,${(0.055*haze).toFixed(4)})`);
  g.fillStyle = air; g.fillRect(0,0,W,floorY);

  // ---- the upstage wall sits behind everything, so it is drawn first
  g.globalCompositeOperation = "source-over";
  for(const f of fx){
    if(fam(f) !== "wall") continue;
    const o = by[f.id]; if(!o) continue;
    const k = shrink(depth(f));
    const cx = VPX + (sx(f.at[0])-VPX)*k, cy = VPY + (sy(f.at[1])-VPY)*k;
    const wm = (f.size_m && f.size_m[0]) || size.w*0.7, hm = (f.size_m && f.size_m[1]) || size.h*0.5;
    const ww = (wm/size.w)*(W-2*pad)*k, hh = (hm/(size.h||3.4))*(floorY-topY)*k;
    g.fillStyle = "#04050a"; g.fillRect(cx-ww/2, cy-hh/2, ww, hh);
    const px = o.pixels && o.pixels.length ? o.pixels : null;
    if(px){
      const cols = Math.max(1, Math.round(Math.sqrt(px.length * (ww/Math.max(1,hh)))));
      const rows = Math.ceil(px.length/cols), cw = ww/cols, ch = hh/rows;
      for(let i=0;i<px.length;i++){
        const q = px[i];
        g.fillStyle = `rgb(${q[0]|0},${q[1]|0},${q[2]|0})`;
        g.fillRect(cx-ww/2 + (i%cols)*cw, cy-hh/2 + ((i/cols)|0)*ch, cw+0.6, ch+0.6);
      }
    } else if(lit(o)){
      const [r,gr,b] = C(o);
      g.fillStyle = `rgba(${r},${gr},${b},${(0.85*o.level).toFixed(3)})`;
      g.fillRect(cx-ww/2, cy-hh/2, ww, hh);
    }
  }

  // ---- the bodies of the battens, opaque, before anything additive is laid
  //      over them. An unlit cell then reads as a dark cell of a real fixture
  //      rather than a hole punched in the middle of it.
  for(const f of fx){
    if(fam(f) !== "bar") continue;
    const k = shrink(depth(f));
    const cx = VPX + (sx(f.at[0])-VPX)*k, cy = VPY + (sy(f.at[1])-VPY)*k;
    const vert = (f.axis || "v") === "v";
    const len = (vert ? (floorY-topY)*0.155 : (W-2*pad)*0.075) * k;
    g.fillStyle = "#12151f";
    if(vert) g.fillRect(cx-2.6*k, cy-len/2, Math.max(2,5.2*k), len);
    else     g.fillRect(cx-len/2, cy-2.6*k, len, Math.max(2,5.2*k));
  }

  g.globalCompositeOperation = "lighter";

  // ---- pixel bars: a bar is a row of cells, not a cone
  for(const f of fx){
    if(fam(f) !== "bar") continue;
    const o = by[f.id]; if(!o) continue;
    const k = shrink(depth(f));
    const cx = VPX + (sx(f.at[0])-VPX)*k, cy = VPY + (sy(f.at[1])-VPY)*k;
    const n = Math.max(1, f.pixels || 12);
    const vert = (f.axis || "v") === "v";
    const len = (vert ? (floorY-topY)*0.155 : (W-2*pad)*0.075) * k;
    const cellw = Math.max(1.6, (vert ? 5.0 : len/n) * k);
    const px = o.pixels && o.pixels.length ? o.pixels : null;
    for(let i=0;i<n;i++){
      let r,gr,b,L;
      if(px){ const q = px[Math.min(px.length-1, i)]; r=q[0]; gr=q[1]; b=q[2];
              L = (r+gr+b)/765; }
      else { const c = C(o); r=c[0]; gr=c[1]; b=c[2]; L = o.level||0; }
      if(L <= 0.02) continue;
      const u = (i+0.5)/n - 0.5;
      const ex = cx + (vert ? 0 : u*len), ey = cy + (vert ? u*len : 0);
      const cellh = Math.max(1.6, (vert ? len/n : 5.0*k));
      g.fillStyle = `rgba(${r|0},${gr|0},${b|0},${Math.min(1,0.30+0.70*L).toFixed(3)})`;
      g.fillRect(ex - cellw/2, ey - cellh/2, cellw, cellh);
      const gl = g.createRadialGradient(ex,ey,0,ex,ey,Math.max(cellw,cellh)*2.6);
      gl.addColorStop(0, `rgba(${r|0},${gr|0},${b|0},${(0.34*L).toFixed(3)})`);
      gl.addColorStop(1, `rgba(${r|0},${gr|0},${b|0},0)`);
      g.fillStyle = gl;
      g.beginPath(); g.arc(ex,ey,Math.max(cellw,cellh)*2.6,0,6.2832); g.fill();
    }
  }

  // ---- everything that throws light through air
  for(const f of fx){
    const F = fam(f);
    if(F==="fog" || F==="bar" || F==="wall") continue;
    const o = by[f.id];
    if(!lit(o)) continue;
    const [r,gr,b] = C(o), L = o.level;
    const k = shrink(depth(f));
    const px = VPX + (sx(f.at[0])-VPX)*k, py = VPY + (sy(f.at[1])-VPY)*k;
    const fy = floorAt(k);
    const pan  = o.pan  !== undefined ? o.pan  : 0.5;
    const tilt = o.tilt !== undefined ? o.tilt : 0.62;
    const face = f.face || "down";

    // ---- audience-facing fixtures do not put a cone into the room; they glare
    //      at the viewer. Drawing a blinder as a downward beam was why the rig
    //      never read as a stage pointed at a crowd.
    if(F==="blinder" || F==="strobe"){
      const rad = (F==="strobe" ? 26 : 44) * k * (0.45 + 0.55*L);
      const gl = g.createRadialGradient(px,py,0,px,py,rad);
      gl.addColorStop(0,   `rgba(${r},${gr},${b},${Math.min(0.98,0.92*L).toFixed(3)})`);
      gl.addColorStop(0.35,`rgba(${r},${gr},${b},${(0.34*L).toFixed(3)})`);
      gl.addColorStop(1,   `rgba(${r},${gr},${b},0)`);
      g.fillStyle = gl; g.beginPath(); g.arc(px,py,rad,0,6.2832); g.fill();
      // spill toward the viewer, washing the crowd
      const spill = g.createLinearGradient(px,py,px,Hpx);
      spill.addColorStop(0, `rgba(${r},${gr},${b},${(0.085*L*haze).toFixed(3)})`);
      spill.addColorStop(1, `rgba(${r},${gr},${b},0)`);
      g.fillStyle = spill;
      g.beginPath(); g.moveTo(px-rad*0.4,py); g.lineTo(px+rad*0.4,py);
      g.lineTo(px+rad*1.7,Hpx); g.lineTo(px-rad*1.7,Hpx); g.closePath(); g.fill();
      continue;
    }

    // ---- plumes and falls: CO2 and pyro rise, confetti falls
    if(F==="co2" || F==="pyro" || F==="confetti"){
      const rise = F==="confetti" ? -1 : 1;
      const reach = (F==="pyro" ? 0.72 : F==="co2" ? 0.58 : 0.85) * (py - topY) * L;
      const ty = py - rise*reach;
      const wideTop = (F==="co2" ? 34 : F==="pyro" ? 14 : 60) * k;
      const col = F==="co2" ? [235,240,255] : F==="pyro" ? [255,196,96] : [r,gr,b];
      const grad = g.createLinearGradient(px,py,px,ty);
      grad.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${(0.70*L).toFixed(3)})`);
      grad.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
      g.fillStyle = grad;
      g.beginPath(); g.moveTo(px-4*k,py); g.lineTo(px+4*k,py);
      g.lineTo(px+wideTop,ty); g.lineTo(px-wideTop,ty); g.closePath(); g.fill();
      if(F==="confetti"){
        for(let i=0;i<26;i++){
          const u=((i*Math.PI*7.3)%1), v=((i*Math.PI*3.1)%1);
          const fxp = px + (u-0.5)*wideTop*2, fyp = py + v*reach;
          g.fillStyle = `rgba(${r},${gr},${b},${(0.75*L).toFixed(3)})`;
          g.fillRect(fxp, fyp, 2.2*k, 3.4*k);
        }
      }
      continue;
    }

    /* Which way it throws.

       A moving head does not use its whole mechanical range on a show, and it
       is never parked horizontal -- that aims it straight into the audience's
       eyes. A head hung on a truss works from straight down to a little above
       horizontal; a head standing on the deck works from straight up to well
       off vertical. Mapping tilt 0.5 to dead horizontal instead put two dozen
       beams flat across the room in a hairline and it read as scratches.

       vert is +1 for straight up, -1 for straight down. */
    const T = cl(tilt, 0, 1);
    let vert;
    if(moves(f))          vert = (face === "up") ? (1.00 - 0.55*T)    // deck: up
                                                 : (-1.00 + 1.55*T);  // truss: down
    else if(face==="up")    vert = 1;
    else if(face==="cross") vert = 0.12;
    else                    vert = -1;

    /* The throw is a direction and a length, not an x from pan and a y from
       tilt. Setting them independently let a nearly-level beam travel the
       whole width of the room while barely rising. */
    const span = (W - 2*pad) * k;
    const swing = moves(f) ? 0.92 : (face==="cross" ? 0.9 : 0.12);
    const ux = (pan - 0.5) * 2 * swing, uy = -vert;
    const un = Math.hypot(ux, uy) || 1;
    const reach = Math.max(py - topY, fy - py) * 1.30;
    const tx = px + (ux/un) * reach * 1.45;
    const ty = py + (uy/un) * reach;

    const deg = f.beam_deg !== undefined ? f.beam_deg
              : (F==="beam"?4 : F==="sky"?2.5 : F==="spot"?15 : F==="wash"?40 : F==="laser"?1 : 25);
    const spread = Math.tan((deg*Math.PI/180)/2);
    const len = Math.hypot(tx-px, ty-py) || 1;
    const hard = (F==="beam"||F==="sky"||F==="laser");
    const half = Math.max(hard ? 1.1*k : 4*k, spread*len);

    // a laser is a line, not a cone, and it is the one thing in the rig that
    // does not soften with distance
    if(F==="laser"){
      const grad = g.createLinearGradient(px,py,tx,ty);
      grad.addColorStop(0, `rgba(${r},${gr},${b},${Math.min(0.95,0.95*L).toFixed(3)})`);
      grad.addColorStop(1, `rgba(${r},${gr},${b},${(0.30*L*haze).toFixed(3)})`);
      g.strokeStyle = grad; g.lineWidth = Math.max(1, 1.4*k);
      const cxm = px + (tx-px)*0.35;          // the fan leans, it does not fly
      for(let i=-3;i<=3;i++){
        g.beginPath(); g.moveTo(px,py);
        g.lineTo(cxm + i*span*0.038, ty); g.stroke();
      }
      continue;
    }

    /* Three passes: wide and faint, mid, then a bright core. Real scattering
       falls off across the cone and one flat gradient cannot show it. A hard
       fixture gets a tighter, brighter core than a wash. */
    const passes = hard ? [[1.00,0.34,1.00],[0.46,0.62,1.00],[0.14,0.95,1.00]]
                        : [[1.00,0.42,1.00],[0.52,0.58,0.98],[0.18,0.85,0.95]];
    for(const [wf, af, lf] of passes){
      const ex = px + (tx-px)*lf, ey = py + (ty-py)*lf, hw = half*wf;
      const grad = g.createLinearGradient(px,py,ex,ey);
      const areaK = hard ? 1 : Math.min(1, 13/Math.max(5, deg));
      const a0 = Math.min(0.95, af * (0.35 + 0.65*L) * haze * areaK);
      grad.addColorStop(0,    `rgba(${r},${gr},${b},${a0.toFixed(3)})`);
      grad.addColorStop(0.55, `rgba(${r},${gr},${b},${(a0*(hard?0.72:0.45)).toFixed(3)})`);
      grad.addColorStop(1,    `rgba(${r},${gr},${b},${hard?(a0*0.30).toFixed(3):0})`);
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(px - 2.5*k, py); g.lineTo(px + 2.5*k, py);
      g.lineTo(ex + hw, ey);    g.lineTo(ex - hw, ey);
      g.closePath(); g.fill();
    }

    // the pool on the floor survives with no haze at all -- but only if the
    // fixture is actually aimed down
    if(vert < -0.15 && ty > fy - (fy-py)*0.30){
      const pw = Math.max(12*k, half*1.7), ph = Math.max(5*k, half*0.40);
      const pool = g.createRadialGradient(tx,fy,0,tx,fy,pw);
      pool.addColorStop(0,   `rgba(${r},${gr},${b},${(0.60*L).toFixed(3)})`);
      pool.addColorStop(0.5, `rgba(${r},${gr},${b},${(0.22*L).toFixed(3)})`);
      pool.addColorStop(1,   `rgba(${r},${gr},${b},0)`);
      g.fillStyle = pool;
      g.beginPath(); g.ellipse(tx, fy, pw, ph, 0, 0, 6.2832); g.fill();
    }

    // the lens
    const lr = Math.max(2.0, (4 + 8*L)*k);
    const gl = g.createRadialGradient(px,py,0,px,py,lr);
    gl.addColorStop(0, `rgba(${r},${gr},${b},${Math.min(0.95,0.85*L).toFixed(3)})`);
    gl.addColorStop(1, `rgba(${r},${gr},${b},0)`);
    g.fillStyle = gl; g.beginPath(); g.arc(px,py,lr,0,6.2832); g.fill();
  }
  g.globalCompositeOperation = "source-over";

  // the deck edge, then a black crowd so brightness has something to read against
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

  // the bodies of the fixtures, so an unlit rig is still visible as a rig
  for(const f of fx){
    const F = fam(f);
    if(F==="fog" || F==="wall") continue;
    const o = by[f.id];
    if(lit(o)) continue;
    const k = shrink(depth(f));
    const px = VPX + (sx(f.at[0])-VPX)*k, py = VPY + (sy(f.at[1])-VPY)*k;
    g.fillStyle = "#141824";
    if(F==="bar"){
      const vert = (f.axis||"v")==="v";
      const len = (vert ? (floorY-topY)*0.155 : (W-2*pad)*0.075) * k;
      g.fillRect(px - (vert?2:len/2), py - (vert?len/2:2), vert?4:len, vert?len:4);
    } else {
      g.beginPath(); g.arc(px,py,Math.max(1.1,(F==="beam"||F==="spot"?3.0:2.2)*k),0,6.2832); g.fill();
    }
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
  g.fillStyle = "#1a1e28"; g.fillRect(0,0,W,H);
  if(!fr || !layout) return;

  const fx = (layout.fixtures||[]).filter(f => f.kind !== "fog");
  const by = {}; for(const o of fr.fixtures) by[o.id] = o;
  const fogs = (layout.fixtures||[]).filter(f => f.kind === "fog")
                 .map(f => by[f.id]).filter(Boolean);
  const haze = fogs.length ? Math.max(...fogs.map(o => o.level||0)) : 0;

  const n = fx.length || 1;
  const pad = 12, gap = n > 60 ? 3 : (n > 24 ? 6 : 10);
  const availW = Math.max(40, W - pad*2), availH = Math.max(40, H - pad*2 - 26);
  const minTile = n > 120 ? 22 : (n > 60 ? 30 : 44);
  const cols = Math.max(1, Math.min(n, Math.floor((availW + gap) / (minTile + gap))));
  const rows = Math.max(1, Math.ceil(n / cols));
  const tw = Math.max(6, (availW - gap*(cols-1)) / cols);
  const th = Math.max(6, Math.min(tw * 1.35, (availH - gap*(rows-1)) / rows));
  const top = pad;

  const showText = tw >= 64 && th >= 56;
  const showPad = tw >= 46 && th >= 42;
  fx.forEach((f, i) => {
    const o = by[f.id] || {};
    const L = o.level || 0;
    const r = o.r!==undefined?o.r:255, gg = o.g!==undefined?o.g:255, b = o.b!==undefined?o.b:255;
    const x = pad + (i % cols)*(tw+gap), y = top + Math.floor(i / cols)*(th+gap);

    g.fillStyle = "#252b39"; g.strokeStyle = "#3c4457"; g.lineWidth = 1;
    g.beginPath(); g.roundRect(x, y, tw, th, 5); g.fill(); g.stroke();

    // the lens: colour at brightness, with a glow that scales with level
    const head = o.pan !== undefined;
    const cx = x + tw/2, cy = y + th*(head?0.30:0.40);
    const rad = Math.max(1, Math.min(tw, th)*(head?0.19:0.24));
    if(L > 0.01){
      const glow = g.createRadialGradient(cx,cy,0,cx,cy,rad*2.6);
      glow.addColorStop(0, `rgba(${r},${gg},${b},${(0.55*L).toFixed(3)})`);
      glow.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      g.fillStyle = glow; g.beginPath(); g.arc(cx,cy,rad*2.6,0,6.2832); g.fill();
    }
    g.fillStyle = L > 0.01 ? `rgb(${(r*L)|0},${(gg*L)|0},${(b*L)|0})` : "#333b4c";
    g.beginPath(); g.arc(cx,cy,rad,0,6.2832); g.fill();
    g.strokeStyle = "#4a5468"; g.stroke();

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
    if(o.strobe > 0 && showText){
      g.fillStyle = "#f0a93c"; g.font = "600 10px ui-monospace,monospace";
      g.fillText(o.strobe.toFixed(1)+" Hz", x+8, y+16);
    }

    if(!showText) return;
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
