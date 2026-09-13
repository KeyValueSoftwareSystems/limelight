/* Screens: navigation, song select, pause, results, and overall game flow. */
(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }

  var library = [];
  var selectedIdx = -1;
  var selectedEntry = null;
  var activeFilter = "all";
  var noFail = false;

  /* ================================================================
     NAVIGATION
     ================================================================ */
  function showScreen(name) {
    var screens = document.querySelectorAll(".screen");
    for (var i = 0; i < screens.length; i++) {
      screens[i].classList.remove("is-active");
    }
    var target = document.getElementById("screen-" + name);
    if (target) target.classList.add("is-active");
  }

  function bindNav() {
    document.querySelectorAll("[data-nav]").forEach(function (el) {
      el.addEventListener("click", function () {
        var dest = el.dataset.nav;
        if (dest === "songs") loadLibraryIfNeeded();
        showScreen(dest);
      });
    });
  }

  /* ================================================================
     LIBRARY LOAD
     ================================================================ */
  var libraryLoaded = false;

  function loadLibraryIfNeeded() {
    if (libraryLoaded) return;
    libraryLoaded = true;
    window.Limelight.fetchLibrary().then(function (lib) {
      library = lib.map(function (entry) {
        return {
          slug: entry.slug || entry.name || "",
          title: entry.title || entry.name || "",
          artist: entry.artist || "",
          bpm: entry.bpm || 0,
          length_s: entry.length_s || entry.duration || 0,
          audio: entry.audio || "",
          score: null,
          scoreLoaded: false,
        };
      });
      renderSongList();
    }).catch(function (err) {
      console.error("Library fetch failed:", err);
    });
  }

  /* ================================================================
     SONG LIST
     ================================================================ */
  function renderSongList() {
    var list = $("songlist");
    if (!list) return;
    list.innerHTML = "";

    var filtered = library.filter(function (s) {
      if (activeFilter === "slow")    return s.bpm > 0 && s.bpm < 90;
      if (activeFilter === "unsurv") {
        var m = window.Mastery.get(s.slug);
        return !m || !m.survived;
      }
      if (activeFilter === "short")   return s.length_s > 0 && s.length_s < 180;
      return true;
    });

    var count = $("library-count");
    if (count) count.textContent = filtered.length + " TRACKS";

    if (!filtered.length) {
      var empty = document.createElement("li");
      empty.className = "songlist__empty";
      empty.textContent = "No tracks match this filter.";
      list.appendChild(empty);
      return;
    }

    for (var i = 0; i < filtered.length; i++) {
      (function (song, idx) {
        var li = document.createElement("li");
        li.className = "songlist__item";
        if (idx === selectedIdx) li.classList.add("is-selected");

        var art = document.createElement("div");
        art.className = "songlist__art";
        art.textContent = (song.bpm || "—") + "\nBPM";

        var info = document.createElement("div");
        info.className = "songlist__info";
        var name = document.createElement("div");
        name.className = "songlist__name";
        name.textContent = song.title;
        var artist = document.createElement("div");
        artist.className = "songlist__artist";
        artist.textContent = song.artist || "—";
        info.appendChild(name);
        info.appendChild(artist);

        var diff = document.createElement("div");
        diff.className = "songlist__diff";
        for (var b = 0; b < 6; b++) {
          var bar = document.createElement("div");
          bar.className = "songlist__diff-bar";
          bar.style.height = Math.round(20 + Math.random() * 80) + "%";
          diff.appendChild(bar);
        }
        info.appendChild(diff);

        var mastery = document.createElement("div");
        mastery.className = "songlist__mastery";
        var mData = window.Mastery.get(song.slug);
        var pct = document.createElement("div");
        pct.className = "songlist__mastery-pct";
        pct.textContent = mData ? Math.round(mData.mastery * 100) + "%" : "—";
        var lbl = document.createElement("div");
        lbl.className = "songlist__mastery-label";
        if (mData && mData.survived) {
          lbl.className += " songlist__mastery-label--survived";
          lbl.textContent = "SURVIVED";
        } else if (mData) {
          lbl.className += " songlist__mastery-label--died";
          lbl.textContent = "BEST: " + (mData.best_bars || 0) + " bars";
        } else {
          lbl.textContent = "NEW";
        }
        mastery.appendChild(pct);
        mastery.appendChild(lbl);

        li.appendChild(art);
        li.appendChild(info);
        li.appendChild(mastery);

        li.addEventListener("click", function () {
          selectedIdx = idx;
          selectedEntry = song;
          document.querySelectorAll(".songlist__item").forEach(function (el) { el.classList.remove("is-selected"); });
          li.classList.add("is-selected");
          renderDetail(song);
        });

        list.appendChild(li);
      })(filtered[i], i);
    }

    if (filtered.length && selectedIdx < 0) {
      selectedIdx = 0;
      selectedEntry = filtered[0];
      renderDetail(filtered[0]);
      list.firstChild.classList.add("is-selected");
    }
  }

  function renderDetail(song) {
    var title = $("detail-title");
    if (title) title.textContent = song.title + (song.artist ? " · " + song.artist : "");

    var chart = $("detail-chart");
    if (chart) {
      chart.innerHTML = "";
      var dmg = window.Mastery.damageChart(song.slug);
      var keys = Object.keys(dmg);
      if (keys.length) {
        var maxVal = Math.max.apply(null, keys.map(function (k) { return dmg[k]; }));
        for (var i = 0; i < keys.length; i++) {
          var bar = document.createElement("div");
          bar.className = "detail__chart-bar" + (dmg[keys[i]] === maxVal ? " detail__chart-bar--danger" : "");
          bar.style.height = Math.round(dmg[keys[i]] / maxVal * 100) + "%";
          bar.title = keys[i];
          chart.appendChild(bar);
        }
      } else {
        chart.innerHTML = '<div style="text-align:center;opacity:0.5;flex:1">No data yet</div>';
      }
    }

    var tip = $("detail-tip");
    if (tip) {
      var weak = window.Mastery.weakestSection(song.slug);
      tip.textContent = weak ? "Weakest: " + weak : "Play once to see your weak spots";
    }
  }

  /* ================================================================
     FILTERS
     ================================================================ */
  function bindFilters() {
    document.querySelectorAll(".filter-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        activeFilter = chip.dataset.filter;
        document.querySelectorAll(".filter-chip").forEach(function (c) { c.classList.remove("is-active"); });
        chip.classList.add("is-active");
        selectedIdx = -1;
        renderSongList();
      });
    });
  }

  /* ================================================================
     START GAME
     ================================================================ */
  function bindStart() {
    var btnStart = $("btn-start");
    var btnPractice = $("btn-practice");

    function doStart(practice) {
      if (!selectedEntry) return;
      noFail = practice;
      var optNF = $("opt-nofail");
      if (optNF) optNF.textContent = noFail ? "ON" : "OFF";

      showScreen("game");

      if (!selectedEntry.scoreLoaded) {
        window.Limelight.fetchScore(selectedEntry.slug).then(function (score) {
          selectedEntry.score = score;
          selectedEntry.scoreLoaded = true;
          launchArena();
        }).catch(function (err) {
          console.error("Score load failed:", err);
          alert("Could not load score: " + err.message);
          showScreen("songs");
        });
      } else {
        launchArena();
      }
    }

    if (btnStart) btnStart.addEventListener("click", function () { doStart(false); });
    if (btnPractice) btnPractice.addEventListener("click", function () { doStart(true); });
  }

  function launchArena() {
    window.Arena.start(selectedEntry, {
      onEnd: function (result) {
        showResults(result);
      },
    }).catch(function (err) {
      console.error("Arena start failed:", err);
      alert("Could not start: " + err.message);
      showScreen("songs");
    });
  }

  /* ================================================================
     PAUSE
     ================================================================ */
  function bindPause() {
    var tapTimes = [];

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        var pauseScreen = $("screen-pause");
        var gameScreen = $("screen-game");
        if (!gameScreen || !gameScreen.classList.contains("is-active")) return;

        var isPaused = window.Arena.togglePause();
        if (isPaused) {
          pauseScreen.classList.add("is-active");
        } else {
          pauseScreen.classList.remove("is-active");
        }
        e.preventDefault();
      }
    });

    var resumeBtn = $("pause-resume");
    if (resumeBtn) resumeBtn.addEventListener("click", function () {
      window.Arena.togglePause();
      $("screen-pause").classList.remove("is-active");
    });

    var restartSectionBtn = $("pause-restart-section");
    if (restartSectionBtn) restartSectionBtn.addEventListener("click", function () {
      $("screen-pause").classList.remove("is-active");
      window.Arena.stop();
      launchArena();
    });

    var restartSongBtn = $("pause-restart-song");
    if (restartSongBtn) restartSongBtn.addEventListener("click", function () {
      $("screen-pause").classList.remove("is-active");
      window.Arena.stop();
      launchArena();
    });

    var quitBtn = $("pause-quit");
    if (quitBtn) quitBtn.addEventListener("click", function () {
      $("screen-pause").classList.remove("is-active");
      window.Arena.stop();
      showScreen("songs");
    });

    document.querySelectorAll("[data-assist]").forEach(function (el) {
      el.addEventListener("click", function () {
        var val = el.querySelector(".pause__assist-val");
        if (!val) return;
        var isOn = val.textContent === "ON";
        val.textContent = isOn ? "OFF" : "ON";
        val.className = "pause__assist-val " + (isOn ? "pause__assist-val--off" : "pause__assist-val--on");
      });
    });

    var tapBtn = $("pause-tap-calibrate");
    if (tapBtn) tapBtn.addEventListener("click", function () {
      tapTimes.push(performance.now());
      var countEl = $("pause-tap-count");
      if (countEl) countEl.textContent = Math.min(tapTimes.length, 8) + " / 8";
      if (tapTimes.length >= 8) {
        var intervals = [];
        for (var i = 1; i < tapTimes.length; i++) intervals.push(tapTimes[i] - tapTimes[i - 1]);
        var avgMs = intervals.reduce(function (a, b) { return a + b; }, 0) / intervals.length;
        var offsetEl = $("pause-offset-value");
        if (offsetEl) offsetEl.textContent = Math.round(avgMs) + " ms avg";
        tapTimes = [];
        if (countEl) countEl.textContent = "0 / 8";
      }
    });

    var nofailEl = $("opt-nofail");
    if (nofailEl) nofailEl.addEventListener("click", function () {
      noFail = !noFail;
      nofailEl.textContent = noFail ? "ON" : "OFF";
    });
  }

  /* ================================================================
     RESULTS
     ================================================================ */
  function showResults(result) {
    window.Arena.stop();
    showScreen("results");

    var survived = result.survived;
    $("results-survived").style.display = survived ? "" : "none";
    $("results-died").style.display = survived ? "none" : "";

    if (survived) {
      var mastery = window.Mastery.get(selectedEntry ? selectedEntry.slug : "");
      var mPct = mastery ? Math.round(mastery.mastery * 100) : 0;

      $("res-status-s").textContent = "SURVIVED · " + (mastery && mastery.attempts <= 1 ? "FIRST TIME" : "ATTEMPT #" + (mastery ? mastery.attempts : 1));
      $("res-headline-s").textContent = "You made it to the outro";
      $("res-mastery-pct").textContent = mPct + "%";
      var ring = $("res-mastery-ring");
      if (ring) ring.style.setProperty("--mastery-pct", mPct + "%");

      $("res-hearts").textContent = result.heartsLeft + " / " + result.maxHearts;
      $("res-clean").textContent = result.maxCleanBars + " bars";
      $("res-notes").textContent = result.notesCollected + " / " + (result.totalNotes || "?");

      var weak = window.Mastery.weakestSection(selectedEntry ? selectedEntry.slug : "");
      $("res-weakest").textContent = weak || "—";

      renderDamageChart("res-chart-s", result.damagePerSection);
      renderChallenges(result.challenges);

      var drillBtn = $("btn-drill");
      if (drillBtn && weak) drillBtn.textContent = "Drill " + weak;
    } else {
      var slug = selectedEntry ? selectedEntry.slug : "";
      var attempts = window.Mastery.attemptsTonight(slug);
      var lastBars = window.Mastery.getLastBarsSurvived(slug);
      var delta = result.barsSurvived - lastBars;

      $("res-status-d").textContent = "OUT OF HEARTS · " + fmtTime(0) + " IN";
      $("res-headline-d").textContent = "The " + (result.deathInfo ? result.deathInfo.section || "arena" : "arena") + " got you.";

      if (result.deathInfo) {
        $("res-death-what").textContent = (result.deathInfo.type || "hazard") + ", bar " + (result.deathInfo.bar || "?");
        $("res-death-tip").textContent = "Learn the " + (result.deathInfo.section || "pattern") + " pattern — it repeats next time.";
      }

      $("res-bars-survived").textContent = result.barsSurvived;
      $("res-vs-last").textContent = (delta >= 0 ? "+" : "") + delta;
      $("res-attempt").textContent = ordinal(attempts);

      $("res-retry-bar").textContent = Math.max(1, (result.deathInfo ? result.deathInfo.bar : 1) - 4);

      renderChallenges(result.challenges);
    }

    bindResultActions(result);
  }

  function renderDamageChart(containerId, damagePerSection) {
    var chart = $(containerId);
    if (!chart) return;
    chart.innerHTML = "";
    var keys = Object.keys(damagePerSection || {});
    if (!keys.length) {
      chart.innerHTML = '<div style="opacity:0.4;text-align:center;flex:1">No damage</div>';
      return;
    }
    var maxVal = Math.max.apply(null, keys.map(function (k) { return damagePerSection[k]; }));
    for (var i = 0; i < keys.length; i++) {
      var bar = document.createElement("div");
      bar.className = "results__chart-bar" + (damagePerSection[keys[i]] === maxVal ? " results__chart-bar--worst" : "");
      bar.style.height = Math.round(damagePerSection[keys[i]] / maxVal * 100) + "%";
      bar.title = keys[i] + ": " + damagePerSection[keys[i]];
      chart.appendChild(bar);
    }
  }

  function renderChallenges(completedIds) {
    var el = $("res-challenges");
    if (!el) return;
    el.innerHTML = "";
    var all = window.Challenges.all();
    for (var i = 0; i < all.length; i++) {
      var div = document.createElement("div");
      div.className = "challenge" + (all[i].done ? " challenge--done" : "");
      div.textContent = (all[i].done ? "✓ " : "○ ") + all[i].text;
      el.appendChild(div);
    }
  }

  function bindResultActions(result) {
    var runAgain = $("btn-run-again");
    if (runAgain) runAgain.onclick = function () {
      showScreen("game");
      launchArena();
    };

    var drill = $("btn-drill");
    if (drill) drill.onclick = function () {
      showScreen("game");
      launchArena();
    };

    var retryBar = $("btn-retry-bar");
    if (retryBar) retryBar.onclick = function () {
      showScreen("game");
      launchArena();
    };

    var slow = $("btn-slow");
    if (slow) slow.onclick = function () {
      showScreen("game");
      launchArena();
    };
  }

  /* ================================================================
     UTILITIES
     ================================================================ */
  function fmtTime(sec) {
    if (!sec || sec < 0) return "0:00";
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function ordinal(n) {
    if (!n || n <= 0) return "1st";
    var s = ["th", "st", "nd", "rd"];
    var v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  /* ================================================================
     BOOT
     ================================================================ */
  function boot() {
    bindNav();
    bindFilters();
    bindStart();
    bindPause();

    window.addEventListener("resize", function () {
      if (window.Renderer) window.Renderer.resize();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.Screens = {
    showScreen: showScreen,
    showResults: showResults,
  };
})();
