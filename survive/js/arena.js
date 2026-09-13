/* Arena: the game loop — session, hazards, player, renderer, HUD, mastery.
   No attack mechanic. Survive by dodging, dashing, collecting, and mirroring. */
(function () {
  "use strict";

  var ARENA_R     = 10;
  var LEAD_MS     = 3000;

  var audio, clock, session, player, hazards;
  var raf = 0, running = false, paused = false, lastTime = 0;
  var lastBeatKey = -1, lastBar = -1;
  var stats, songEntry, onEnd;

  function resetStats() {
    return {
      cleanBars: 0, maxCleanBars: 0,
      cleanBarStreak: 0,
      barsSurvived: 0,
      damagePerSection: {},
      hitThisBar: false,
      totalDamage: 0,
      notesCollected: 0, totalNotes: 0,
      deathInfo: null,
      currentBar: 0, currentBeat: 0,
    };
  }

  function start(entry, opts) {
    stop();
    opts = opts || {};
    songEntry = entry;
    onEnd = opts.onEnd || null;

    var mount = document.getElementById("arena-mount");
    window.Renderer.init(mount);
    window.Renderer.resize();

    var score = entry.score;
    if (!score) return Promise.reject(new Error("no score loaded"));

    audio = new Audio();
    audio.preload = "auto";
    audio.src = entry.audio;

    clock = window.Limelight.makeClock(audio);
    session = window.Limelight.makeSession(score, function () { return clock.position(); });

    player = window.Player.create(ARENA_R);
    hazards = window.Hazards.create(score);
    player.bind();

    stats = resetStats();
    lastBeatKey = -1; lastBar = -1; lastTime = 0;
    paused = false;

    window.HUD.initTimeline(score);
    window.HUD.setMastery(window.Mastery.get(entry.slug));
    window.Challenges.init(score);

    return new Promise(function (resolve, reject) {
      var timeout = setTimeout(function () { reject(new Error("audio load timeout")); }, 15000);
      audio.addEventListener("canplaythrough", function () {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
      audio.addEventListener("error", function (e) {
        clearTimeout(timeout);
        reject(e);
      }, { once: true });
      audio.load();
    }).then(function () {
      audio.addEventListener("ended", finish, { once: true });
      window.Renderer.resize();
      clock.play(0);
      running = true;
      lastTime = performance.now();
      raf = requestAnimationFrame(loop);
      return { ok: true };
    });
  }

  function stop() {
    running = false; paused = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (clock) { try { clock.pause(); } catch (e) {} }
    if (player) player.unbind();
    if (window.Renderer) window.Renderer.dispose();
    audio = clock = session = player = hazards = null;
  }

  function togglePause() {
    if (!running) return;
    paused = !paused;
    if (paused) {
      if (clock) try { clock.pause(); } catch (e) {}
    } else {
      if (clock) try { clock.play(); } catch (e) {}
      lastTime = performance.now();
    }
    return paused;
  }

  function isPaused() { return paused; }

  function loop(timestamp) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (paused) return;

    var dt = Math.min((timestamp - lastTime) / 1000, 0.1);
    lastTime = timestamp;

    var now = session.now();
    var upcoming = session.next(LEAD_MS);

    /* The song's own energy sets how much danger there is: quiet bars ease off,
       loud bars fill the ring. Fed every frame so the hazards -- which already
       read pace/energy -- breathe with the music instead of running flat. */
    var energyNow = (now.energy == null ? 0.5 : now.energy);
    hazards.setEnergy(energyNow);
    hazards.setPace(0.5 + energyNow * 1.6);

    var currentBar = 1, currentBeat = 1, bpb = 4;
    if (now.position && !now.position.before_first_beat) {
      currentBar = now.position.bar || 1;
      currentBeat = now.position.beat || 1;
      bpb = (songEntry.score && songEntry.score.grid && songEntry.score.grid.beats_per_bar) || 4;
    }

    stats.currentBar = currentBar;
    stats.currentBeat = currentBeat;

    var bk = currentBar * 100 + Math.floor(currentBeat);
    if (bk !== lastBeatKey) {
      lastBeatKey = bk;
      var isDownbeat = Math.floor(currentBeat) === 1;
      window.Renderer.pulse(isDownbeat);

      if (isDownbeat) {
        player.refillDashes();
      }
    }

    if (currentBar !== lastBar) {
      if (lastBar >= 0 && !stats.hitThisBar) {
        stats.cleanBars++;
        stats.cleanBarStreak++;
        stats.maxCleanBars = Math.max(stats.maxCleanBars, stats.cleanBarStreak);
      }
      stats.hitThisBar = false;
      stats.barsSurvived = currentBar;
      lastBar = currentBar;
    }

    hazards.update(dt, currentBar, currentBeat);
    var phase = hazards.getPhase();
    window.Renderer.setPhase(phase);

    player.update(dt);

    /* The thing in the middle is solid: push the player back to its edge rather
       than let it walk (or dash) through the boss. */
    var keepOut = window.Renderer.bossRadius(ARENA_R) + player.radius;
    var pDist = Math.sqrt(player.x * player.x + player.y * player.y);
    if (pDist < keepOut) {
      if (pDist > 1e-4) { player.x *= keepOut / pDist; player.y *= keepOut / pDist; }
      else { player.y = keepOut; }
    }

    var damages = hazards.checkDamage(player.x, player.y, player.radius, ARENA_R);
    for (var i = 0; i < damages.length; i++) {
      var hit = player.takeDamage(damages[i].type);
      if (hit) {
        stats.hitThisBar = true;
        stats.cleanBarStreak = 0;
        stats.totalDamage++;
        var secName = hazards.getSectionName() || "unknown";
        stats.damagePerSection[secName] = (stats.damagePerSection[secName] || 0) + 1;
        window.Renderer.shake(1.2);
        window.HUD.showBonus("HIT!", 0);
      }
    }

    var collected = hazards.checkNoteCollection(player.x, player.y, ARENA_R);
    for (var i = 0; i < collected.length; i++) {
      player.collectNote();
      stats.notesCollected++;
      window.HUD.showBonus("NOTE!", 0);
    }

    if (phase === "BRIDGE") {
      var stepped = hazards.checkPadStep(player.x, player.y, ARENA_R);
      if (stepped) {
        window.HUD.showBonus("STEP!", 0);
      }
    }

    if (phase === "PRE_CHORUS") {
      var spot = hazards.prechorusSpotlight(currentBar, currentBeat, bpb, hazards.getEnergy());
      var sx = (spot.xPct / 100 - 0.5) * 2 * ARENA_R;
      var sy = -(spot.yPct / 100 - 0.5) * 2 * ARENA_R;
      var dist = Math.sqrt((player.x - sx) * (player.x - sx) + (player.y - sy) * (player.y - sy));
      var safeR = (spot.radiusPct / 100) * ARENA_R;
      if (dist <= safeR) {
        player.heal(0);
      }
    }

    var wedges = phase === "VERSE" ? hazards.verseWedges(currentBar, currentBeat, bpb, hazards.getPace()) : [];
    var rings = phase === "CHORUS" ? hazards.chorusRings(currentBar, currentBeat, bpb, hazards.getTelegraphs()) : [];
    var spotlight = phase === "PRE_CHORUS" ? hazards.prechorusSpotlight(currentBar, currentBeat, bpb, hazards.getEnergy()) : null;
    var notes = phase === "DROP" ? hazards.dropNotes(currentBar, currentBeat, bpb, hazards.getNotes()) : [];
    var padStep = phase === "BRIDGE" ? hazards.getPadStep() : -1;

    window.Renderer.updatePlayer(player, ARENA_R);
    window.Renderer.updateBoss(null, ARENA_R, dt);
    window.Renderer.updateWedges(wedges);
    window.Renderer.updateRings(rings);
    window.Renderer.updateSpotlight(spotlight);
    window.Renderer.updateNotes(notes);

    var padData = [];
    if (phase === "BRIDGE") {
      var ph = hazards.getPadHits();
      var ps = hazards.getPadStep();
      for (var i = 0; i < 4; i++) {
        padData.push({ active: ps === i, hit: ph[i] || false });
      }
    }
    window.Renderer.updatePads(padData);
    window.Renderer.updateClear(false);
    window.Renderer.updateFrame(dt);

    window.HUD.update({
      hearts: player.hearts,
      maxHearts: player.maxHearts,
      shield: player.shield,
      maxShield: player.maxShield,
      cleanBars: stats.cleanBars,
      section: hazards.getSectionName() || "—",
      phase: phase,
      dashCharges: player.dashCharges,
      maxDashes: player.maxDashes,
      currentBar: currentBar,
      currentBeat: currentBeat,
      bpb: bpb,
      seconds: now.seconds,
    });

    window.Challenges.check(stats, hazards, player, now);

    if (!player.alive) {
      stats.deathInfo = {
        type: damages.length ? damages[damages.length - 1].type : "unknown",
        bar: currentBar,
        section: hazards.getSectionName(),
      };
      finish();
    }
  }

  function finish() {
    if (!running) return;
    var result = getResult();
    if (songEntry) {
      window.Mastery.record(songEntry.slug, result);
    }
    running = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (clock) { try { clock.pause(); } catch (e) {} }
    if (player) player.unbind();
    if (onEnd) onEnd(result);
  }

  function getResult() {
    return {
      survived: player ? player.alive : false,
      heartsLeft: player ? player.hearts : 0,
      maxHearts: player ? player.maxHearts : 3,
      maxCleanBars: stats.maxCleanBars,
      barsSurvived: stats.barsSurvived,
      notesCollected: stats.notesCollected,
      totalNotes: stats.totalNotes,
      totalDamage: stats.totalDamage,
      damagePerSection: stats.damagePerSection,
      deathInfo: stats.deathInfo,
      challenges: window.Challenges.completed(),
    };
  }

  window.Arena = {
    start: start,
    stop: stop,
    togglePause: togglePause,
    isPaused: isPaused,
    getResult: getResult,
  };
})();
