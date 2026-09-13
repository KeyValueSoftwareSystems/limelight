/* Mastery: per-song tracking persisted in localStorage.
   Tracks damage_per_section, clean_bar_streaks, bars_survived,
   attempts_tonight (session counter), death info, weakest section. */
(function () {
  "use strict";

  var STORE_KEY = "survive_mastery";
  var SESSION_KEY = "survive_session_" + new Date().toDateString();

  function loadAll() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveAll(all) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(all)); } catch (e) {}
  }
  function sessionCounts() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveSession(counts) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(counts)); } catch (e) {}
  }

  function get(slug) {
    if (!slug) return null;
    var all = loadAll();
    return all[slug] || null;
  }

  function record(slug, result) {
    if (!slug || !result) return;
    var all = loadAll();
    var prev = all[slug] || {
      mastery: 0, survived: false, attempts: 0,
      best_clean_streak: 0, best_bars: 0,
      damage_per_section: {},
      last_bars_survived: 0,
    };

    prev.attempts++;
    prev.survived = prev.survived || result.survived;
    prev.best_clean_streak = Math.max(prev.best_clean_streak, result.maxCleanBars || 0);
    prev.last_bars_survived = result.barsSurvived || 0;
    if (result.barsSurvived > prev.best_bars) {
      prev.best_bars = result.barsSurvived;
    }

    if (result.damagePerSection) {
      Object.keys(result.damagePerSection).forEach(function (sec) {
        prev.damage_per_section[sec] = (prev.damage_per_section[sec] || 0) + result.damagePerSection[sec];
      });
    }

    if (result.deathInfo) {
      prev.last_death = result.deathInfo;
    }

    var survivalFactor = result.survived ? 1 : Math.min(1, (result.barsSurvived || 0) / 100);
    var cleanFactor = result.maxCleanBars ? Math.min(1, result.maxCleanBars / 20) : 0;
    var dmgPenalty = result.totalDamage ? Math.min(0.5, result.totalDamage * 0.05) : 0;

    var runMastery = (survivalFactor * 0.5 + cleanFactor * 0.3) - dmgPenalty;
    runMastery = Math.max(0, Math.min(1, runMastery));
    prev.mastery = Math.max(prev.mastery, runMastery);

    all[slug] = prev;
    saveAll(all);

    var session = sessionCounts();
    session[slug] = (session[slug] || 0) + 1;
    saveSession(session);

    return prev;
  }

  function attemptsTonight(slug) {
    var s = sessionCounts();
    return s[slug] || 0;
  }

  function weakestSection(slug) {
    var data = get(slug);
    if (!data || !data.damage_per_section) return null;
    var worst = null, max = 0;
    Object.keys(data.damage_per_section).forEach(function (sec) {
      if (data.damage_per_section[sec] > max) {
        max = data.damage_per_section[sec];
        worst = sec;
      }
    });
    return worst;
  }

  function damageChart(slug) {
    var data = get(slug);
    if (!data || !data.damage_per_section) return {};
    return data.damage_per_section;
  }

  function getLastBarsSurvived(slug) {
    var data = get(slug);
    return data ? data.last_bars_survived || 0 : 0;
  }

  window.Mastery = {
    get: get,
    record: record,
    attemptsTonight: attemptsTonight,
    weakestSection: weakestSection,
    damageChart: damageChart,
    getLastBarsSurvived: getLastBarsSurvived,
    loadAll: loadAll,
  };
})();
