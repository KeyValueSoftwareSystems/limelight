/* Hazards: 5 phase-specific generators driven by the score protocol.
   Each phase returns render-ready descriptors consumed by the Renderer. */
(function () {
  "use strict";

  function hash(bar, beat) {
    var h = (bar * 4 + beat) | 0;
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  var ARENA_R = 10;

  function phaseFor(name) {
    if (!name) return "IDLE";
    var n = name.toLowerCase();
    if (n === "intro" || n === "outro") return "IDLE";
    if (n === "verse")                 return "VERSE";
    if (n === "pre-chorus" || n === "prechorus" || n === "build") return "PRE_CHORUS";
    if (n === "chorus")                return "CHORUS";
    if (n === "drop")                  return "DROP";
    if (n === "bridge" || n === "breakdown") return "BRIDGE";
    return "VERSE";
  }

  /* ---- VERSE: rotating wedge sweeps ---- */
  function verseWedges(bar, beat, bpb, paceScale) {
    var count = Math.min(4, 1 + Math.floor((paceScale || 1) * 2));
    var baseSpeed = 30 + (paceScale || 1) * 20;
    var wedges = [];
    for (var i = 0; i < count; i++) {
      var fromDeg = (hash(bar, i) % 360);
      var spanDeg = 28 + (hash(bar + 1, i) % 20);
      var rotation = (fromDeg + beat * baseSpeed) % 360;
      wedges.push({
        fromDeg: 0,
        spanDeg: spanDeg,
        rotation: rotation,
        stage: beat < bpb - 1 ? "fill" : "strike",
        opacity: 0.7 + (paceScale || 1) * 0.2,
      });
    }
    return wedges;
  }

  /* ---- PRE-CHORUS: safe spotlight that drifts ---- */
  function prechorusSpotlight(bar, beat, bpb, energyScale) {
    var t = (bar * bpb + beat) * 0.3;
    var cx = 50 + Math.sin(t * 0.7) * 25;
    var cy = 50 + Math.cos(t * 0.5) * 25;
    var radiusPct = 25 + (1 - (energyScale || 0.5)) * 10;
    return { visible: true, xPct: cx, yPct: cy, radiusPct: radiusPct };
  }

  /* ---- CHORUS: closing rings ---- */
  function chorusRings(bar, beat, bpb, activeTelegraphs) {
    var rings = [];
    for (var i = 0; i < activeTelegraphs.length && i < 4; i++) {
      var t = activeTelegraphs[i];
      if (t.type !== "ring") continue;
      var gapDeg = (hash(t.bar, 0) % 360);
      var progress = t.progress || 0;
      var scale, opacity;
      if (t.stageName === "outline") {
        scale = 1.75 - progress * 0.3;
        opacity = 0.3 + progress * 0.3;
      } else if (t.stageName === "fill") {
        scale = 1.45 - progress * 0.5;
        opacity = 0.6 + progress * 0.3;
      } else if (t.stageName === "strike") {
        scale = 0.95 - progress * 0.5;
        opacity = 0.9;
      } else {
        scale = 0.42;
        opacity = Math.max(0, 1 - progress * 2);
      }
      rings.push({ gapDeg: gapDeg, scale: scale, opacity: opacity });
    }
    return rings;
  }

  /* ---- DROP: notes flying inward ---- */
  function dropNotes(bar, beat, bpb, activeNotes) {
    var notes = [];
    for (var i = 0; i < activeNotes.length && i < 12; i++) {
      var n = activeNotes[i];
      notes.push({
        xPct: n.xPct,
        yPct: n.yPct,
        collected: n.collected,
      });
    }
    return notes;
  }

  /* ---- BRIDGE: pattern pads ---- */
  function bridgePads(bar, beat, bpb, activeStep) {
    var pads = [];
    var padDirs = ["n", "e", "s", "w"];
    for (var i = 0; i < 4; i++) {
      pads.push({
        dir: padDirs[i],
        active: activeStep === i,
        hit: false,
      });
    }
    return pads;
  }

  /* ---- Hazard Manager ---- */
  function create(score) {
    /* The hub serves a score with `parts` (0-based bars), not `sections`. Build
       sections from parts the same way the HUD does -- without this the section
       lookup finds nothing, the phase never leaves IDLE, and the boss never
       attacks. `to_bar` is inclusive, so the half-open end is +1. */
    var sections = score.sections || [];
    if (!sections.length && score.parts) {
      sections = score.parts.map(function (p) {
        return { from: { bar: p.from_bar, beat: 1 }, to: { bar: p.to_bar + 1, beat: 1 }, name: p.role };
      });
    }
    var bpb = (score.grid && score.grid.beats_per_bar) || 4;
    var telegraphPool = window.Telegraph.Pool();
    var phase = "IDLE";
    var sectionName = null;
    var lastScheduledBar = -1;
    var paceScale = 1;
    var energyScale = 0.5;
    var activeNotes = [];
    var padStep = -1;
    var padSequence = [];
    var padHits = [];

    function currentSection(bar) {
      for (var i = sections.length - 1; i >= 0; i--) {
        var s = sections[i];
        var fromBar = s.from ? s.from.bar : (s.from_bar || 0);
        var toBar = s.to ? s.to.bar : (s.to_bar ? s.to_bar + 1 : 9999);
        if (bar >= fromBar && bar < toBar) return s;
      }
      return null;
    }

    function scheduleBar(bar) {
      if (bar <= lastScheduledBar) return;
      lastScheduledBar = bar;

      var sec = currentSection(bar);
      sectionName = sec ? (sec.name || sec.role || null) : null;
      phase = phaseFor(sectionName);

      if (phase === "VERSE") {
        telegraphPool.add({ type: "sweep", bar: bar, bpb: bpb });
      }
      if (phase === "CHORUS") {
        /* Chorus density rides the energy curve: a quiet bar rests every other
           bar, a loud one fires every bar. */
        if (energyScale > 0.4 || (bar % 2 === 0)) {
          telegraphPool.add({ type: "ring", bar: bar, bpb: bpb });
        }
      }
      if (phase === "DROP") {
        var noteCount = 2 + Math.round(energyScale * 4) + (hash(bar, 0) % 2);
        for (var i = 0; i < noteCount; i++) {
          var angle = (i / noteCount) * Math.PI * 2 + (hash(bar, i) % 100) / 100;
          activeNotes.push({
            bar: bar, beat: 1 + (i % bpb),
            startX: 50 + Math.cos(angle) * 48,
            startY: 50 + Math.sin(angle) * 48,
            xPct: 50 + Math.cos(angle) * 48,
            yPct: 50 + Math.sin(angle) * 48,
            targetX: 50, targetY: 50,
            collected: false, age: 0,
          });
        }
      }
      if (phase === "BRIDGE") {
        padSequence = [];
        for (var i = 0; i < 4; i++) {
          padSequence.push((hash(bar, i) + i) % 4);
        }
        padStep = 0;
        padHits = [false, false, false, false];
      }
    }

    function update(dt, currentBar, currentBeat) {
      scheduleBar(currentBar);
      scheduleBar(currentBar + 1);
      scheduleBar(currentBar + 2);

      telegraphPool.tick(currentBar, currentBeat, bpb);

      for (var i = activeNotes.length - 1; i >= 0; i--) {
        var n = activeNotes[i];
        n.age += dt;
        var t = Math.min(1, n.age / 3);
        n.xPct = n.startX + (n.targetX - n.startX) * t;
        n.yPct = n.startY + (n.targetY - n.startY) * t;
        if (n.collected || n.age > 4) {
          activeNotes.splice(i, 1);
        }
      }
    }

    function getPhase() { return phase; }
    function getSectionName() { return sectionName; }
    function getTelegraphs() { return telegraphPool.getActive(); }
    function getNotes() { return activeNotes; }
    function getPadStep() { return padStep >= 0 ? padSequence[padStep] : -1; }
    function getPadSequence() { return padSequence; }
    function getPadHits() { return padHits; }
    function getBpb() { return bpb; }

    function advancePad() {
      if (padStep >= 0 && padStep < padSequence.length) {
        padHits[padSequence[padStep]] = true;
        padStep++;
        if (padStep >= padSequence.length) padStep = -1;
      }
    }

    function setPace(v) { paceScale = v; }
    function setEnergy(v) { energyScale = v; }
    function getPace() { return paceScale; }
    function getEnergy() { return energyScale; }

    function checkDamage(playerX, playerY, playerR, arenaR) {
      var damages = [];
      var telegraphs = telegraphPool.getActive();

      for (var i = 0; i < telegraphs.length; i++) {
        var t = telegraphs[i];
        if (window.Telegraph.isDamaging(t)) {
          if (t.type === "sweep") {
            damages.push({ type: "sweep", bar: t.bar });
            window.Telegraph.markDamaged(t);
          }
          if (t.type === "ring") {
            var gapDeg = hash(t.bar, 0) % 360;
            var playerAngle = ((Math.atan2(-playerY, playerX) * 180 / Math.PI) + 360) % 360;
            var diff = Math.abs(playerAngle - gapDeg);
            if (diff > 180) diff = 360 - diff;
            /* The safe gap narrows as the song gets louder -- still open, but a
               peak chorus asks for a tighter line than a quiet one. */
            var safeHalf = 30 - energyScale * 12;
            if (diff > safeHalf) {
              damages.push({ type: "ring", bar: t.bar });
            }
            window.Telegraph.markDamaged(t);
          }
        }
      }

      if (phase === "PRE_CHORUS") {
        var spot = prechorusSpotlight(0, 0, bpb, energyScale);
        var sx = (spot.xPct / 100 - 0.5) * 2 * arenaR;
        var sy = -(spot.yPct / 100 - 0.5) * 2 * arenaR;
        var dist = Math.sqrt((playerX - sx) * (playerX - sx) + (playerY - sy) * (playerY - sy));
        var safeR = (spot.radiusPct / 100) * arenaR;
        if (dist > safeR) {
          return damages;
        }
      }

      return damages;
    }

    function checkNoteCollection(playerX, playerY, arenaR) {
      var collected = [];
      for (var i = 0; i < activeNotes.length; i++) {
        var n = activeNotes[i];
        if (n.collected) continue;
        var nx = (n.xPct / 100 - 0.5) * 2 * arenaR;
        var ny = -(n.yPct / 100 - 0.5) * 2 * arenaR;
        var dist = Math.sqrt((playerX - nx) * (playerX - nx) + (playerY - ny) * (playerY - ny));
        if (dist < 1.5) {
          n.collected = true;
          collected.push(n);
        }
      }
      return collected;
    }

    function checkPadStep(playerX, playerY, arenaR) {
      if (padStep < 0 || padStep >= padSequence.length) return false;
      var targetIdx = padSequence[padStep];
      var padPositions = [
        { x: 0, y: arenaR * 0.75 },
        { x: arenaR * 0.75, y: 0 },
        { x: 0, y: -arenaR * 0.75 },
        { x: -arenaR * 0.75, y: 0 },
      ];
      var target = padPositions[targetIdx];
      var dist = Math.sqrt((playerX - target.x) * (playerX - target.x) + (playerY - target.y) * (playerY - target.y));
      if (dist < 2.5) {
        advancePad();
        return true;
      }
      return false;
    }

    function reset() {
      telegraphPool.clear();
      activeNotes = [];
      padStep = -1; padSequence = []; padHits = [];
      lastScheduledBar = -1;
      phase = "IDLE"; sectionName = null;
      paceScale = 1; energyScale = 0.5;
    }

    return {
      update: update,
      getPhase: getPhase,
      getSectionName: getSectionName,
      getTelegraphs: getTelegraphs,
      getNotes: getNotes,
      getPadStep: getPadStep,
      getPadSequence: getPadSequence,
      getPadHits: getPadHits,
      getBpb: getBpb,
      checkDamage: checkDamage,
      checkNoteCollection: checkNoteCollection,
      checkPadStep: checkPadStep,
      setPace: setPace,
      setEnergy: setEnergy,
      getPace: getPace,
      getEnergy: getEnergy,
      verseWedges: verseWedges,
      prechorusSpotlight: prechorusSpotlight,
      chorusRings: chorusRings,
      dropNotes: dropNotes,
      bridgePads: bridgePads,
      reset: reset,
      phaseFor: phaseFor,
    };
  }

  window.Hazards = { create: create, phaseFor: phaseFor };
})();
