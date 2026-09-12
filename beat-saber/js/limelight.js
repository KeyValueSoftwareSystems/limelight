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

   Everything is fetched from serve.py on the same origin:
       /library.json            list of playable songs {slug, audio}
       /scores/<slug>.score     the score (JSON)
       <audio path>             the recording, served with byte ranges
       /protocol/session.js     the protocol client (loaded in index.html)
   ============================================================ */
(function () {
  "use strict";

  // Same origin as serve.py. When the game is opened at /beat-saber/, these
  // absolute paths resolve against the Limelight server that served it.
  const BASE = "";

  async function getJSON(path) {
    const res = await fetch(BASE + path, { cache: "no-store" });
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return res.json();
  }

  /* The song list for the select screen. Each library entry is {slug, audio};
     we enrich it with a few fields the UI wants (name, bpm, length) by reading
     the score's grid + song block. Cheap here — one real song — and it keeps the
     select screen honest: every number shown is a number the score actually holds. */
  async function fetchLibrary() {
    const list = await getJSON("/library.json");
    const out = [];
    for (const entry of list) {
      try {
        const score = await loadScore(entry.slug);
        out.push({
          slug: entry.slug,
          audio: entry.audio,
          name: describeName(score, entry.slug),
          artist: (score.song && score.song.artist) || "—",
          bpm: Math.round((score.grid && score.grid.bpm) || 0),
          length: formatLength(songLengthSeconds(score)),
          score, // cached so Start needn't refetch
        });
      } catch (err) {
        // A score that won't parse shouldn't sink the whole list.
        out.push({ slug: entry.slug, audio: entry.audio, name: entry.slug,
                   artist: "—", bpm: 0, length: "—", score: null, error: String(err) });
      }
    }
    return out;
  }

  async function loadScore(slug) {
    return getJSON(`/scores/${slug}.score`);
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

  window.Limelight = { BASE, fetchLibrary, loadScore, makeClock, makeSession };
})();
