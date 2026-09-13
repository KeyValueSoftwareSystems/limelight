/* Hazards: the boss's moveset, driven by the score.
   ---------------------------------------------------------------------------
   Four dodge-fair attack types, each telegraphed through the 4-stage lifecycle
   (outline -> fill -> strike -> clear) so it can be read before it bites, and
   each with POSITIONAL damage that matches what is drawn:

     wedge   a lethal pie-slice from the centre -- be outside the angle
     ring    a closing ring with one safe gap  -- be in the gap
     laser   a beam straight across the arena   -- be off the line
     bullet  a volley of projectiles on spokes  -- weave through the gap

   A per-section director picks the moveset and scales it by the song's energy,
   so different songs (different section orders) play differently, while the same
   song always throws the same show. Geometry is in game space (centre 0,0, rim
   radius ARENA_R); the render descriptors carry CSS-space angles so the drawn
   hazard and the damage test never disagree. */
(function () {
  "use strict";

  var ARENA_R = 10;
  var TAU = Math.PI * 2;
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;

  /* attack shape constants (game units) */
  var LASER_HW      = 0.85;   // laser half-thickness
  var BULLET_R      = 0.42;   // projectile radius
  var BULLET_SPEED  = 6.2;    // units / second
  var BULLET_LIFE   = 2.8;    // seconds
  var BULLET_START  = 1.2;    // spawn radius (just outside the boss)
  var WEDGE_MIN_R   = 1.1;    // no wedge damage inside the boss

  function hash(a, b) {
    var h = (a * 4 + b) | 0;
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }
  function rnd(a, b) { return hash(a, b) / 4294967295; }          /* 0..1 */
  function mod(x, m) { return ((x % m) + m) % m; }
  function angDiffRad(a, b) { return Math.abs(mod(a - b + Math.PI, TAU) - Math.PI); }
  function angDistDeg(a, b) { var d = Math.abs(mod(a - b, 360)); return d > 180 ? 360 - d : d; }
  /* game angle (math: +x = 0, CCW) -> CSS conic angle (0 = up, CW) */
  function cssFromGame(th) { return mod(90 - th * R2D, 360); }

  function phaseFor(name) {
    if (!name) return "IDLE";
    var n = String(name).toLowerCase();
    if (n === "intro" || n === "outro") return "IDLE";
    if (n === "verse")                  return "VERSE";
    if (n === "pre-chorus" || n === "prechorus" || n === "build") return "PRE_CHORUS";
    if (n === "chorus")                 return "CHORUS";
    if (n === "drop")                   return "DROP";
    if (n === "bridge" || n === "breakdown") return "BRIDGE";
    return "VERSE";
  }

  /* ---- Hazard Manager ---- */
  function create(score) {
    /* The hub serves a score with `parts` (0-based bars), not `sections`. Build
       sections from parts the way the HUD does; without this the section lookup
       finds nothing, the phase never leaves IDLE, and the boss never attacks. */
    var sections = score.sections || [];
    if (!sections.length && score.parts) {
      sections = score.parts.map(function (p) {
        return { from: { bar: p.from_bar, beat: 1 }, to: { bar: p.to_bar + 1, beat: 1 }, name: p.role };
      });
    }
    var bpb = (score.grid && score.grid.beats_per_bar) || 4;
    var telegraphPool = window.Telegraph.Pool();
    var phase = "IDLE", sectionName = null;
    var lastScheduledBar = -1;
    var paceScale = 1, energyScale = 0.5, rampScale = 1;
    var bullets = [];   // live projectiles: { x, y, vx, vy, r, age, life, bar }

    function currentSection(bar) {
      for (var i = sections.length - 1; i >= 0; i--) {
        var s = sections[i];
        var fromBar = s.from ? s.from.bar : (s.from_bar || 0);
        var toBar = s.to ? s.to.bar : (s.to_bar ? s.to_bar + 1 : 9999);
        if (bar >= fromBar && bar < toBar) return s;
      }
      return null;
    }

    /* Axes for a bullet volley: `count` evenly spread over the ring EXCEPT a
       safe wedge around a per-bar direction, so there is always a lane to stand
       in. Each axis fires two bullets (opposite directions). */
    function spokeSet(bar, e, dense, ramp) {
      var count = (dense ? 5 : 4) + Math.round(e * 3 * ramp);
      var gapCenter = rnd(bar, 9) * TAU;
      var gapHalf = ((dense ? 26 : 34) + (1 - ramp) * 18) * D2R;   // wider safe lane early
      var arc = Math.PI - 2 * gapHalf;
      if (arc < Math.PI * 0.4) { arc = Math.PI * 0.5; gapHalf = (Math.PI - arc) / 2; }
      var start = gapCenter + gapHalf, step = arc / count, axes = [];
      for (var i = 0; i < count; i++) axes.push(start + (i + 0.5) * step);
      return axes;
    }

    function scheduleBar(bar) {
      if (bar <= lastScheduledBar) return;
      lastScheduledBar = bar;

      var sec = currentSection(bar);
      sectionName = sec ? (sec.name || sec.role || null) : null;
      phase = phaseFor(sectionName);

      /* Difficulty ramps in over the song: an early bar is gentle even when the
         music is loud, so there is room to learn before it fills the ring. */
      var ramp = rampScale;
      var e = energyScale * (0.4 + 0.6 * ramp);
      var A = function (salt) { return rnd(bar, salt) * TAU; };
      var tele = function (type, data) { telegraphPool.add({ type: type, bar: bar, bpb: bpb, data: data }); };

      if (phase === "IDLE") {
        /* intro / outro: the song is resting, so is the boss */
      } else if (phase === "VERSE") {
        tele("wedge", { angle: A(1), span: (30 + e * 24) * D2R });
        if (ramp > 0.75 && e > 0.55) tele("wedge", { angle: A(1) + Math.PI, span: (30 + e * 24) * D2R });
      } else if (phase === "PRE_CHORUS") {
        tele("laser", { angle: A(2) });
        if (ramp > 0.7 && e > 0.55) tele("laser", { angle: A(2) + Math.PI / 2 });   // a cross, late only
      } else if (phase === "CHORUS") {
        /* early on, rest every other bar so the pattern is learnable */
        if (ramp > 0.5 || bar % 2 === 0) {
          if (bar % 2 === 0) tele("ring", { gapDeg: hash(bar, 0) % 360 });
          else               tele("bullet", { spokes: spokeSet(bar, e, false, ramp) });
        }
        if (ramp > 0.8 && e > 0.62) {                                 // only a loud, late chorus stacks
          if (bar % 2 === 0) tele("bullet", { spokes: spokeSet(bar, e, false, ramp) });
          else               tele("laser", { angle: A(3) });
        }
      } else if (phase === "DROP") {
        tele("bullet", { spokes: spokeSet(bar, e, true, ramp) });     // bullet-hell
        if (ramp > 0.6) tele("laser", { angle: A(4) });
      } else if (phase === "BRIDGE") {
        if (bar % 2 === 0) tele("wedge", { angle: A(5), span: (38 + e * 14) * D2R });
        else               tele("laser", { angle: A(5) });
      }
    }

    function emitBullets(t) {
      var axes = (t.data && t.data.spokes) || [];
      for (var i = 0; i < axes.length; i++) {
        var a = axes[i];
        for (var s = 0; s < 2; s++) {
          var dir = a + s * Math.PI;
          bullets.push({
            x: Math.cos(dir) * BULLET_START, y: Math.sin(dir) * BULLET_START,
            vx: Math.cos(dir) * BULLET_SPEED, vy: Math.sin(dir) * BULLET_SPEED,
            r: BULLET_R, age: 0, life: BULLET_LIFE, bar: t.bar,
          });
        }
      }
    }

    function update(dt, currentBar, currentBeat) {
      scheduleBar(currentBar);
      scheduleBar(currentBar + 1);
      scheduleBar(currentBar + 2);

      telegraphPool.tick(currentBar, currentBeat, bpb);

      var tg = telegraphPool.getActive();
      for (var i = 0; i < tg.length; i++) {
        var t = tg[i];
        if (t.type === "bullet" && !t.emitted && window.Telegraph.isDamaging(t)) {
          emitBullets(t); t.emitted = true;
        }
      }

      for (var j = bullets.length - 1; j >= 0; j--) {
        var b = bullets[j];
        b.x += b.vx * dt; b.y += b.vy * dt; b.age += dt;
        if (b.age > b.life || Math.hypot(b.x, b.y) > ARENA_R * 1.15) bullets.splice(j, 1);
      }
    }

    /* ---- render descriptors: what the renderer draws, in its own terms ---- */
    function ringStage(t) {
      var p = t.progress || 0, scale, opacity;
      if (t.stageName === "outline") { scale = 1.75 - p * 0.3; opacity = 0.3 + p * 0.3; }
      else if (t.stageName === "fill") { scale = 1.45 - p * 0.5; opacity = 0.6 + p * 0.3; }
      else if (t.stageName === "strike") { scale = 0.95 - p * 0.5; opacity = 0.9; }
      else { scale = 0.42; opacity = Math.max(0, 1 - p * 2); }
      return { scale: scale, opacity: opacity };
    }
    function laserThick(t) {
      if (t.stageName === "strike") return { thickFrac: LASER_HW / ARENA_R, opacity: 0.95 };
      if (t.stageName === "fill")   return { thickFrac: 0.008, opacity: 0.6 };
      if (t.stageName === "outline")return { thickFrac: 0.006, opacity: 0.38 };
      return { thickFrac: LASER_HW / ARENA_R, opacity: Math.max(0, 0.9 - (t.progress || 0)) };
    }

    function getRenderData() {
      var wedges = [], rings = [], lasers = [], out = [];
      var tg = telegraphPool.getActive();
      for (var i = 0; i < tg.length; i++) {
        var t = tg[i], d = t.data || {};
        if (t.stageName === "pending" || t.stageName === "done") continue;

        if (t.type === "wedge") {
          var halfDeg = (d.span / 2) * R2D, sw = t.stageName;
          wedges.push({
            fromDeg: mod(cssFromGame(d.angle) - halfDeg, 360),
            spanDeg: halfDeg * 2,
            rotation: 0,
            /* only STRIKE is lethal; a clearing wedge fades so it does not read
               as a live hit */
            stage: sw === "outline" ? "outline" : sw === "strike" ? "strike" : "fill",
            opacity: sw === "strike" ? 0.95 : sw === "fill" ? 0.72 : sw === "outline" ? 0.6 : 0.3,
            strike: sw === "strike",
          });
        } else if (t.type === "ring") {
          var rs = ringStage(t);
          rings.push({ gapDeg: (d.gapDeg || 0), scale: rs.scale, opacity: rs.opacity });
        } else if (t.type === "laser") {
          var lt = laserThick(t);
          lasers.push({ rotDeg: -d.angle * R2D, thickFrac: lt.thickFrac, opacity: lt.opacity, color: "red", strike: t.stageName === "strike" });
        } else if (t.type === "bullet") {
          /* aim: faint beams along each axis until the volley fires */
          if (!t.emitted && (t.stageName === "outline" || t.stageName === "fill")) {
            var op = t.stageName === "fill" ? 0.42 : 0.24;
            for (var k = 0; k < (d.spokes || []).length; k++)
              lasers.push({ rotDeg: -d.spokes[k] * R2D, thickFrac: 0.006, opacity: op, color: "amber" });
          }
        }
      }
      for (var m = 0; m < bullets.length; m++) {
        var bl = bullets[m];
        out.push({ xPct: 50 + (bl.x / ARENA_R) * 50, yPct: 50 - (bl.y / ARENA_R) * 50 });
      }
      return { wedges: wedges, rings: rings, lasers: lasers, bullets: out };
    }

    /* ---- damage: positional, matched to the render descriptors ---- */
    function checkDamage(px, py, pr, arenaR) {
      var damages = [];
      var tg = telegraphPool.getActive();
      var phi = Math.atan2(py, px), r = Math.hypot(px, py);

      for (var i = 0; i < tg.length; i++) {
        var t = tg[i], d = t.data || {};
        if (!window.Telegraph.isDamaging(t)) continue;   // strike stage only

        if (t.type === "wedge") {
          if (r > WEDGE_MIN_R && angDiffRad(phi, d.angle) <= d.span / 2) {
            damages.push({ type: "wedge", bar: t.bar });
          }
        } else if (t.type === "ring") {
          /* the drawn gap sits at CSS (gapDeg + 330), 60deg wide -> safe there */
          var safeCenter = mod(d.gapDeg + 330, 360);
          if (angDistDeg(cssFromGame(phi), safeCenter) > 30) {
            damages.push({ type: "ring", bar: t.bar });
          }
          window.Telegraph.markDamaged(t);            // a ring closes once
        } else if (t.type === "laser") {
          var perp = Math.abs(px * Math.sin(d.angle) - py * Math.cos(d.angle));
          if (perp <= LASER_HW + pr) damages.push({ type: "laser", bar: t.bar });
        }
      }

      for (var j = 0; j < bullets.length; j++) {
        var b = bullets[j];
        if (Math.hypot(px - b.x, py - b.y) < b.r + pr) { damages.push({ type: "bullet", bar: b.bar }); break; }
      }
      return damages;
    }

    function setPace(v) { paceScale = v; }
    function setEnergy(v) { energyScale = v; }
    function setRamp(v) { rampScale = v < 0 ? 0 : v > 1 ? 1 : v; }
    function getPace() { return paceScale; }
    function getEnergy() { return energyScale; }

    /* Closest surface gap from the player to any live bullet (negative = hit).
       Used for near-miss feedback. */
    function minBulletGap(px, py, pr) {
      var best = Infinity;
      for (var i = 0; i < bullets.length; i++) {
        var b = bullets[i];
        var g = Math.hypot(px - b.x, py - b.y) - (b.r + pr);
        if (g < best) best = g;
      }
      return best;
    }
    function getPhase() { return phase; }
    function getSectionName() { return sectionName; }
    function getBpb() { return bpb; }

    function reset() {
      telegraphPool.clear();
      bullets = [];
      lastScheduledBar = -1;
      phase = "IDLE"; sectionName = null;
      paceScale = 1; energyScale = 0.5; rampScale = 1;
    }

    return {
      update: update,
      getRenderData: getRenderData,
      checkDamage: checkDamage,
      minBulletGap: minBulletGap,
      getPhase: getPhase,
      getSectionName: getSectionName,
      getBpb: getBpb,
      setPace: setPace,
      setEnergy: setEnergy,
      setRamp: setRamp,
      getPace: getPace,
      getEnergy: getEnergy,
      reset: reset,
      phaseFor: phaseFor,
    };
  }

  window.Hazards = { create: create, phaseFor: phaseFor };
})();
