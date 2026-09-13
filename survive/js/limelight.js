/* Limelight data layer for Survive the Song.
   Fetches library/scores from the local server, builds protocol session+clock. */
(function () {
  "use strict";

  var BASE = "";

  function getJSON(path) {
    return fetch(BASE + path, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error(path + " -> " + res.status);
      return res.json();
    });
  }

  function fetchLibrary() {
    return getJSON("/api/library").then(function (data) {
      return (data.songs || []).map(function (s) {
        return {
          slug:     s.slug,
          title:    s.name || s.slug,
          artist:   s.artist || "—",
          bpm:      s.bpm || 0,
          length_s: parseLength(s.length),
          audio:    s.audio,
        };
      });
    });
  }

  function fetchScore(slug) {
    return getJSON("/api/score/" + encodeURIComponent(slug));
  }

  function makeClock(audioEl) {
    if (!window.LimelightClock || !window.LimelightClock.AnchoredClock) {
      throw new Error("protocol/clock.js not loaded");
    }
    return window.LimelightClock.AnchoredClock(audioEl);
  }

  function makeSession(score, positionFn) {
    if (!window.LimelightSession || !window.LimelightSession.Session) {
      throw new Error("protocol/session.js not loaded");
    }
    return window.LimelightSession.Session(score, { songTime: positionFn });
  }

  function parseLength(l) {
    if (typeof l === "number") return l;
    if (!l || l === "—") return 0;
    var parts = String(l).split(":");
    if (parts.length === 2) return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    return 0;
  }

  window.Limelight = {
    BASE: BASE,
    fetchLibrary: fetchLibrary,
    fetchScore: fetchScore,
    loadScore: fetchScore,
    makeClock: makeClock,
    makeSession: makeSession,
  };
})();
