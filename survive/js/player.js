/* Player: WASD movement + SPACE dash. No attack button — you only survive.
   Hearts (3 discrete), shield (0–100), dash charges (refill on the downbeat). */
(function () {
  "use strict";

  var SPEED        = 5.5;
  var DASH_SPEED   = 16.0;
  var DASH_DUR     = 0.15;
  var RADIUS       = 0.45;
  var MAX_HEARTS   = 3;
  var MAX_SHIELD   = 100;
  var MAX_DASHES   = 3;
  var IFRAME_DUR   = 1.0;
  var SHIELD_DECAY = 2;

  function create(arenaRadius) {
    var keys = {};

    var p = {
      x: 0, y: -arenaRadius * 0.45,
      vx: 0, vy: 0,
      radius: RADIUS,
      hearts: MAX_HEARTS,
      maxHearts: MAX_HEARTS,
      alive: true,
      shield: 0,
      maxShield: MAX_SHIELD,
      dashing: false,
      dashTimer: 0,
      dashCharges: MAX_DASHES,
      maxDashes: MAX_DASHES,
      iframeTimer: 0,
      dashDirX: 0, dashDirY: 0,
      dashRequested: false,
      arenaRadius: arenaRadius,
      notesCollected: 0,
      totalNotes: 0,
    };

    function onKeyDown(e) {
      keys[e.key.toLowerCase()] = true;
      if (e.key === " ") { p.dashRequested = true; e.preventDefault(); }
    }
    function onKeyUp(e) { keys[e.key.toLowerCase()] = false; }

    function bind() {
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
    }
    function unbind() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    }

    function update(dt) {
      if (!p.alive) return;

      p.iframeTimer = Math.max(0, p.iframeTimer - dt);
      if (p.shield > 0) {
        p.shield = Math.max(0, p.shield - SHIELD_DECAY * dt);
      }

      if (p.dashing) {
        p.dashTimer -= dt;
        if (p.dashTimer <= 0) {
          p.dashing = false;
        } else {
          p.vx = p.dashDirX * DASH_SPEED;
          p.vy = p.dashDirY * DASH_SPEED;
        }
      }

      if (!p.dashing) {
        var mx = 0, my = 0;
        if (keys["w"] || keys["arrowup"])    my =  1;
        if (keys["s"] || keys["arrowdown"])  my = -1;
        if (keys["a"] || keys["arrowleft"])  mx = -1;
        if (keys["d"] || keys["arrowright"]) mx =  1;
        var len = Math.sqrt(mx * mx + my * my) || 1;
        p.vx = (mx / len) * SPEED;
        p.vy = (my / len) * SPEED;

        if (p.dashRequested && p.dashCharges > 0 && (mx || my)) {
          p.dashing = true;
          p.dashTimer = DASH_DUR;
          p.dashCharges--;
          p.dashDirX = mx / len;
          p.dashDirY = my / len;
          p.vx = p.dashDirX * DASH_SPEED;
          p.vy = p.dashDirY * DASH_SPEED;
        }
      }
      p.dashRequested = false;

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      var dist = Math.sqrt(p.x * p.x + p.y * p.y);
      var maxDist = p.arenaRadius - RADIUS;
      if (dist > maxDist) {
        p.x *= maxDist / dist;
        p.y *= maxDist / dist;
      }
    }

    function takeDamage(source) {
      if (p.iframeTimer > 0 || p.dashing) return false;
      if (p.shield > 0) {
        p.shield = Math.max(0, p.shield - 35);
        p.iframeTimer = IFRAME_DUR * 0.5;
        return false;
      }
      p.hearts = Math.max(0, p.hearts - 1);
      p.iframeTimer = IFRAME_DUR;
      if (p.hearts <= 0) p.alive = false;
      return true;
    }

    function heal(amount) {
      p.hearts = Math.min(MAX_HEARTS, p.hearts + amount);
    }

    function addShield(amount) {
      p.shield = Math.min(MAX_SHIELD, p.shield + amount);
    }

    function refillDashes() {
      p.dashCharges = MAX_DASHES;
    }

    function collectNote() {
      p.notesCollected++;
      addShield(15);
    }

    function reset() {
      p.x = 0; p.y = -arenaRadius * 0.45;
      p.vx = 0; p.vy = 0;
      p.hearts = MAX_HEARTS; p.alive = true;
      p.shield = 0;
      p.dashing = false; p.dashTimer = 0;
      p.dashCharges = MAX_DASHES;
      p.iframeTimer = 0;
      p.notesCollected = 0; p.totalNotes = 0;
      Object.keys(keys).forEach(function (k) { delete keys[k]; });
    }

    p.update = update;
    p.takeDamage = takeDamage;
    p.heal = heal;
    p.addShield = addShield;
    p.refillDashes = refillDashes;
    p.collectNote = collectNote;
    p.reset = reset;
    p.bind = bind;
    p.unbind = unbind;
    return p;
  }

  window.Player = { create: create };
})();
