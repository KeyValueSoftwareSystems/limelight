/* HUD: hearts, shield, section timeline, incoming lane, clean bars, mastery,
   dash charges, bonus popups. All DOM-driven. */
(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }

  var sections = [];
  var totalBars = 0;
  var songTitle = "", songArtist = "", songLength = "";

  var SECTION_COLORS = {
    verse: "#B8A4F5", "pre-chorus": "#FFE066", prechorus: "#FFE066",
    chorus: "#FF7C88", drop: "#FFB84D", bridge: "#8FD8C8",
    build: "#FFE066", breakdown: "#8FD8C8",
    intro: "rgba(251,243,236,.2)", outro: "rgba(251,243,236,.2)",
  };

  function initTimeline(score) {
    var grid = score.grid || {};
    var bpb = grid.beats_per_bar || 4;
    var song = score.song || {};
    totalBars = song.bars || grid.bars || 100;
    songTitle = song.title || song.name || "";
    songArtist = song.artist || "";
    songLength = song.length_s ? fmtTime(song.length_s) : "—";

    var titleEl = $("hud-song-title");
    if (titleEl) {
      titleEl.innerHTML = esc(songTitle) + (songArtist ? " <span>· " + esc(songArtist) + "</span>" : "");
    }

    sections = score.sections || [];
    if (!sections.length && score.parts) {
      sections = score.parts.map(function (p) {
        return {
          from: { bar: p.from_bar, beat: 1 },
          to: { bar: p.to_bar + 1, beat: 1 },
          name: p.role,
        };
      });
    }

    var barEl = $("hud-sections-bar");
    var labelsEl = $("hud-section-labels");
    if (!barEl || !labelsEl) return;

    barEl.innerHTML = "";
    labelsEl.innerHTML = "";

    for (var i = 0; i < sections.length; i++) {
      var s = sections[i];
      var fromBar = s.from ? s.from.bar : 1;
      var toBar = s.to ? s.to.bar : totalBars;
      var flex = Math.max(1, toBar - fromBar);
      var name = (s.name || "").toLowerCase();
      var color = SECTION_COLORS[name] || "rgba(251,243,236,.2)";

      var seg = document.createElement("div");
      seg.className = "hud__section-seg";
      seg.style.flex = flex;
      seg.style.background = color;
      seg.dataset.fromBar = fromBar;
      seg.dataset.toBar = toBar;
      barEl.appendChild(seg);

      var label = document.createElement("span");
      label.textContent = (s.name || "").toUpperCase();
      label.dataset.name = s.name || "";
      labelsEl.appendChild(label);
    }

    var playhead = document.createElement("div");
    playhead.className = "hud__section-playhead";
    playhead.id = "hud-playhead";
    if (barEl.firstChild) barEl.firstChild.appendChild(playhead);
  }

  function update(state) {
    var hearts = $("hud-hearts");
    if (hearts) {
      var hEls = hearts.querySelectorAll(".hud__heart");
      for (var i = 0; i < hEls.length; i++) {
        hEls[i].classList.toggle("hud__heart--empty", i >= state.hearts);
      }
      var count = $("hud-hearts-count");
      if (count) count.textContent = state.hearts + " / " + state.maxHearts;
    }

    var shieldFill = $("hud-shield-fill");
    if (shieldFill) shieldFill.style.width = Math.round(state.shield / state.maxShield * 100) + "%";
    var shieldPct = $("hud-shield-pct");
    if (shieldPct) shieldPct.textContent = Math.round(state.shield / state.maxShield * 100) + "%";

    var cleanBars = $("hud-clean-bars");
    if (cleanBars) cleanBars.textContent = state.cleanBars;

    updateTimeline(state.currentBar, state.section);
    updateDashCharges(state.dashCharges, state.maxDashes);
    updateIncomingBeats(state.currentBeat, state.bpb);

    var timeEl = $("hud-song-time");
    if (timeEl) timeEl.textContent = fmtTime(state.seconds || 0) + " / " + songLength;
  }

  function updateTimeline(currentBar, currentSection) {
    var barEl = $("hud-sections-bar");
    if (!barEl) return;

    var progress = totalBars > 0 ? currentBar / totalBars : 0;
    var segs = barEl.querySelectorAll(".hud__section-seg");

    for (var i = 0; i < segs.length; i++) {
      var fb = parseInt(segs[i].dataset.fromBar) || 0;
      var tb = parseInt(segs[i].dataset.toBar) || 0;
      if (currentBar >= fb && currentBar < tb) {
        var localPct = (currentBar - fb) / Math.max(1, tb - fb) * 100;
        var playhead = $("hud-playhead");
        if (playhead && playhead.parentNode !== segs[i]) {
          segs[i].appendChild(playhead);
        }
        if (playhead) playhead.style.left = localPct + "%";
      }
    }

    var labels = document.querySelectorAll("#hud-section-labels span");
    for (var i = 0; i < labels.length; i++) {
      labels[i].classList.toggle("is-current",
        labels[i].dataset.name && labels[i].dataset.name.toLowerCase() === (currentSection || "").toLowerCase());
    }
  }

  function updateDashCharges(charges, max) {
    var dots = $("hud-dash-dots");
    if (!dots) return;
    var children = dots.querySelectorAll(".hud__dash-dot");
    for (var i = 0; i < children.length; i++) {
      children[i].classList.toggle("hud__dash-dot--full", i < charges);
    }
  }

  function updateIncomingBeats(currentBeat, bpb) {
    var beats = $("hud-incoming-beats");
    if (!beats) return;
    var dots = beats.querySelectorAll(".hud__incoming-dot");
    var beatIdx = Math.floor(currentBeat) - 1;
    for (var i = 0; i < dots.length; i++) {
      dots[i].classList.toggle("is-active", i <= beatIdx);
    }
  }

  function setMastery(data) {
    var el = $("hud-mastery");
    if (!el || !data) return;
    el.textContent = Math.round((data.mastery || 0) * 100) + "%";
  }

  function showBonus(text, pts) {
    var el = $("hud-bonus");
    if (!el) return;
    el.textContent = text + (pts ? " +" + pts : "");
    el.classList.remove("bonus-anim");
    void el.offsetWidth;
    el.classList.add("bonus-anim");
  }

  function fmtTime(sec) {
    if (!sec || sec < 0) return "0:00";
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  window.HUD = {
    initTimeline: initTimeline,
    update: update,
    setMastery: setMastery,
    showBonus: showBonus,
  };
})();
