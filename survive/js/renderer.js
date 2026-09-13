/* 2D DOM-based arena renderer.
   Creates and manages all visual elements inside the arena-mount container.
   Knows nothing about audio or the protocol — given positions, it draws them. */
(function () {
  "use strict";

  var mount, arena;
  var playerEl, bossEl;
  var hazardLayer;
  var wedgeEls = [], ringEls = [], noteEls = [], padEls = [], spotlightEl, clearEl;
  var arenaSize = 0;
  var beatPulse = 0, shakeMag = 0;
  var lastStep = 0;

  var PHASE_COLORS = {
    IDLE:       { ring: "rgba(23,50,77,.14)" },
    VERSE:      { ring: "#B8A4F5" },
    PRE_CHORUS: { ring: "#FFE066" },
    CHORUS:     { ring: "#FF7C88" },
    DROP:       { ring: "#FFB84D" },
    BRIDGE:     { ring: "#8FD8C8" },
  };

  function init(mountEl) {
    mount = mountEl;
    mount.innerHTML = "";

    arena = document.createElement("div");
    arena.className = "arena";
    mount.appendChild(arena);

    var innerRing = document.createElement("div");
    innerRing.className = "arena__inner-ring";
    arena.appendChild(innerRing);

    var grid = document.createElement("div");
    grid.className = "arena__grid";
    arena.appendChild(grid);

    hazardLayer = document.createElement("div");
    hazardLayer.className = "hazard-layer";
    arena.appendChild(hazardLayer);

    spotlightEl = document.createElement("div");
    spotlightEl.className = "hazard-spotlight";
    spotlightEl.style.display = "none";
    hazardLayer.appendChild(spotlightEl);

    clearEl = document.createElement("div");
    clearEl.className = "hazard-clear";
    clearEl.textContent = "SAFE";
    hazardLayer.appendChild(clearEl);

    for (var i = 0; i < 4; i++) {
      var w = document.createElement("div");
      w.className = "hazard-wedge";
      w.style.display = "none";
      hazardLayer.appendChild(w);
      wedgeEls.push(w);
    }
    for (var i = 0; i < 4; i++) {
      var r = document.createElement("div");
      r.className = "hazard-ring";
      hazardLayer.appendChild(r);
      ringEls.push(r);
    }
    for (var i = 0; i < 12; i++) {
      var n = document.createElement("div");
      n.className = "hazard-note";
      n.style.display = "none";
      hazardLayer.appendChild(n);
      noteEls.push(n);
    }

    var padDirs = ["n", "e", "s", "w"];
    for (var i = 0; i < 4; i++) {
      var p = document.createElement("div");
      p.className = "hazard-pad hazard-pad--" + padDirs[i];
      p.style.display = "none";
      hazardLayer.appendChild(p);
      padEls.push(p);
    }

    bossEl = document.createElement("div");
    bossEl.className = "boss";
    bossEl.innerHTML =
      '<div class="boss__orbit">' +
        '<div class="boss__satellite"></div>' +
        '<div class="boss__satellite"></div>' +
        '<div class="boss__satellite"></div>' +
        '<div class="boss__satellite"></div>' +
      '</div>' +
      '<div class="boss__body"></div>' +
      '<div class="boss__eye boss__eye--l"></div>' +
      '<div class="boss__eye boss__eye--r"></div>' +
      '<div class="boss__mouth"></div>';
    arena.appendChild(bossEl);

    playerEl = document.createElement("div");
    playerEl.className = "player";
    playerEl.innerHTML =
      '<div class="player__shield-arc"></div>' +
      '<div class="player__dash-trail"></div>' +
      '<div class="player__body"></div>';
    arena.appendChild(playerEl);

    beatPulse = 0; shakeMag = 0;
    lastStep = performance.now();
    resize();
  }

  function resize() {
    if (!mount || !arena) return;
    var mw = mount.clientWidth || window.innerWidth;
    var mh = mount.clientHeight || window.innerHeight;
    arenaSize = Math.min(mw * 0.78, mh * 0.78);
    arena.style.width = arenaSize + "px";
    arena.style.height = arenaSize + "px";
  }

  function arenaRadius() {
    return arenaSize / 2;
  }

  function toArenaXY(gameX, gameY, gameR) {
    var r = arenaRadius();
    if (r <= 0) return { left: "50%", top: "50%" };
    var px = ((gameX / gameR) * r) + r;
    var py = ((-gameY / gameR) * r) + r;
    return { left: px + "px", top: py + "px" };
  }

  function pulse(isDownbeat) {
    beatPulse = isDownbeat ? 1.0 : 0.5;
  }

  function shake(amount) {
    shakeMag = Math.max(shakeMag, amount);
  }

  function setPhase(phase) {
    var c = PHASE_COLORS[phase] || PHASE_COLORS.VERSE;
    var inner = arena.querySelector(".arena__inner-ring");
    if (inner) inner.style.borderColor = c.ring;
  }

  function updatePlayer(player, gameR) {
    if (!playerEl) return;
    var pos = toArenaXY(player.x, player.y, gameR);
    playerEl.style.left = pos.left;
    playerEl.style.top = pos.top;

    playerEl.classList.toggle("player--dashing", !!player.dashing);
    playerEl.classList.toggle("player--iframe", player.iframeTimer > 0 && !player.dashing);
    playerEl.classList.toggle("player--shielded", player.shield > 0);
  }

  function updateBoss(boss, gameR, dt) {
    if (!bossEl) return;
    var now = performance.now();
    bossEl.style.animation = "boss-beat " + (0.96) + "s ease-out infinite";
  }

  function updateWedges(wedges) {
    for (var i = 0; i < wedgeEls.length; i++) {
      var el = wedgeEls[i];
      if (i < wedges.length) {
        var w = wedges[i];
        el.style.display = "";
        el.style.setProperty("--wedge-from", w.fromDeg + "deg");
        el.style.setProperty("--wedge-span", w.spanDeg + "deg");
        el.style.transform = "rotate(" + (w.rotation || 0) + "deg)";

        el.className = "hazard-wedge";
        if (w.stage === "outline") {
          el.classList.add("hazard-wedge--outline");
          el.style.background = "none";
        } else if (w.stage === "fill") {
          el.classList.add("hazard-wedge--fill");
        } else if (w.stage === "strike") {
          el.classList.add("hazard-wedge--strike");
        }
        el.style.opacity = w.opacity != null ? w.opacity : 1;
      } else {
        el.style.display = "none";
      }
    }
  }

  function updateRings(rings) {
    for (var i = 0; i < ringEls.length; i++) {
      var el = ringEls[i];
      if (i < rings.length) {
        var r = rings[i];
        el.style.setProperty("--ring-gap", (r.gapDeg || 200) + "deg");
        el.style.setProperty("--ring-scale", r.scale != null ? r.scale : 1.75);
        el.style.setProperty("--ring-opacity", r.opacity != null ? r.opacity : 0);
        el.style.transform = "scale(" + (r.scale != null ? r.scale : 1.75) + ")";
        el.style.opacity = r.opacity != null ? r.opacity : 0;
      } else {
        el.style.opacity = 0;
      }
    }
  }

  function updateSpotlight(spot) {
    if (!spot || !spot.visible) {
      spotlightEl.style.display = "none";
      return;
    }
    spotlightEl.style.display = "";
    spotlightEl.style.left = spot.xPct + "%";
    spotlightEl.style.top = spot.yPct + "%";
    spotlightEl.style.width = (spot.radiusPct || 30) + "%";
    spotlightEl.style.height = (spot.radiusPct || 30) + "%";
  }

  function updateNotes(notes) {
    for (var i = 0; i < noteEls.length; i++) {
      var el = noteEls[i];
      if (i < notes.length) {
        var n = notes[i];
        el.style.display = "";
        el.style.left = n.xPct + "%";
        el.style.top = n.yPct + "%";
        el.classList.toggle("hazard-note--collected", !!n.collected);
      } else {
        el.style.display = "none";
      }
    }
  }

  function updatePads(pads) {
    for (var i = 0; i < padEls.length; i++) {
      var el = padEls[i];
      if (i < pads.length) {
        var p = pads[i];
        el.style.display = "";
        el.classList.toggle("hazard-pad--active", !!p.active);
        el.classList.toggle("hazard-pad--hit", !!p.hit);
      } else {
        el.style.display = "none";
      }
    }
  }

  function updateClear(visible) {
    clearEl.classList.toggle("hazard-clear--visible", !!visible);
  }

  function updateFrame(dt) {
    if (!arena) return;
    var now = performance.now();
    var frameDt = Math.min((now - lastStep) / 1000, 0.1);
    lastStep = now;

    beatPulse = Math.max(0, beatPulse - frameDt * 3.5);
    var inner = arena.querySelector(".arena__inner-ring");
    if (inner) {
      var bw = 2 + beatPulse * 3;
      inner.style.borderWidth = bw + "px";
      inner.style.opacity = 0.5 + beatPulse * 0.5;
    }

    if (shakeMag > 0.01) {
      var sx = (Math.random() - 0.5) * shakeMag * 6;
      var sy = (Math.random() - 0.5) * shakeMag * 6;
      arena.style.transform = "translate(" + sx + "px," + sy + "px)";
      shakeMag *= Math.max(0, 1 - frameDt * 8);
    } else {
      arena.style.transform = "";
      shakeMag = 0;
    }
  }

  function dispose() {
    wedgeEls = []; ringEls = []; noteEls = []; padEls = [];
    if (mount) mount.innerHTML = "";
    mount = arena = playerEl = bossEl = hazardLayer = spotlightEl = clearEl = null;
  }

  /* The boss is a fixed-size element at the arena centre, so its radius in game
     units depends on how big the arena is drawn. Report it in game units so the
     arena can keep the player out of it at any viewport size. */
  function bossRadius(gameR) {
    if (!bossEl) return 0;
    var r = arenaRadius();
    var bossPx = (bossEl.offsetWidth || 0) / 2;
    if (r <= 0 || !bossPx) return 0;
    return (bossPx / r) * gameR;
  }

  window.Renderer = {
    init: init,
    resize: resize,
    arenaRadius: arenaRadius,
    bossRadius: bossRadius,
    toArenaXY: toArenaXY,
    pulse: pulse,
    shake: shake,
    setPhase: setPhase,
    updatePlayer: updatePlayer,
    updateBoss: updateBoss,
    updateWedges: updateWedges,
    updateRings: updateRings,
    updateSpotlight: updateSpotlight,
    updateNotes: updateNotes,
    updatePads: updatePads,
    updateClear: updateClear,
    updateFrame: updateFrame,
    dispose: dispose,
  };
})();
