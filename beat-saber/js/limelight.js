/* ============================================================
   Limelight data layer for Beat Saber
   ------------------------------------------------------------
   Beat Saber is a *consumer* on the Limelight protocol. It does not
   invent beat times — it asks the server for a song's score and lets
   the protocol's own client (protocol/session.js) answer two questions:

       now()        -> where am I in the song, in musical position
       next(lead)   -> which beats/sections are coming, in MY milliseconds

   The game owns the clock: the <audio> element is the transport, and we
   hand its currentTime to the session as songTime. Nothing here recomputes
   a beat — the grid (bpm, first_beat_s, beats_per_bar) derives them all.

   Everything is fetched from the game's own server (beat-saber/server.py),
   which talks to the hub so the page needs no CORS from it:
       GET  /api/library          playable songs on the hub (score + audio)
       GET  /api/score/<slug>     the score (JSON), proxied from the hub
       POST /api/add?name=<file>  upload an mp3 -> hub, then start scoring
       GET  /api/jobs             MP3->score generation progress
   Audio plays straight from the hub URL each library entry carries.
   ============================================================ */
(function () {
  "use strict";

  const BASE = "";   // same origin as beat-saber/server.py

  async function getJSON(path) {
    const res = await fetch(BASE + path, { cache: "no-store" });
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return res.json();
  }

  /* Playable songs, already enriched (name/artist/bpm/length/audio) by the
     server from each score's grid + song block, so the select screen shows real
     numbers without the client fetching every score up front. */
  async function fetchLibrary() {
    const data = await getJSON("/api/library");
    return (data.songs || []).map((s) => ({
      slug: s.slug, audio: s.audio, name: s.name || s.slug,
      artist: s.artist || "—", bpm: s.bpm || 0, length: s.length || "—",
      score: null,   // loaded on Start
    }));
  }

  async function loadScore(entryOrSlug) {
    const slug = typeof entryOrSlug === "string" ? entryOrSlug : entryOrSlug.slug;
    return getJSON(`/api/score/${encodeURIComponent(slug)}`);
  }

  /* Upload an mp3 through our server to the hub and kick off scoring. */
  async function addSong(file) {
    const res = await fetch(`/api/add?name=${encodeURIComponent(file.name)}`, {
      method: "POST", body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `add -> ${res.status}`);
    return data;   // { slug, score_name, job }
  }

  async function jobs() {
    try { return (await getJSON("/api/jobs")).jobs || []; }
    catch (e) { return []; }
  }

  /* Build the protocol session for a loaded score, reading the audio element's
     own clock. This is the one place the game touches the protocol client. */
  function makeClock(audioEl) {
    if (!window.LimelightClock || !window.LimelightClock.AnchoredClock) {
      throw new Error("protocol/clock.js not loaded");
    }
    return window.LimelightClock.AnchoredClock(audioEl);
  }

  // positionFn is () => songSeconds, normally clock.position bound to a clock.
  // The clock MEASURES the audio (protocol/clock.md); the session must read it,
  // never audio.currentTime, or notes judder and drift.
  function makeSession(score, positionFn) {
    if (!window.LimelightSession || !window.LimelightSession.Session) {
      throw new Error("protocol/session.js not loaded");
    }
    return window.LimelightSession.Session(score, { songTime: positionFn });
  }

  // ---- small helpers --------------------------------------------------------
  function describeName(score, slug) {
    const s = score.song || {};
    return s.title || s.name || titleCase(slug);
  }
  function songLengthSeconds(score) {
    const s = score.song || {};
    if (s.length_s) return s.length_s;
    // Fall back to the grid: last bar's downbeat, roughly.
    const g = score.grid || {};
    if (g.last_bar != null && g.bpm) {
      return (g.first_beat_s || 0) + (g.last_bar - (g.first_bar || 0) + 1) *
        (g.beats_per_bar || 4) * (60 / g.bpm);
    }
    return 0;
  }
  function formatLength(sec) {
    if (!sec) return "—";
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  function titleCase(slug) {
    return String(slug).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  window.Limelight = { BASE, fetchLibrary, loadScore, addSong, jobs, makeClock, makeSession };
})();
