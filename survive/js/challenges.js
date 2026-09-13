/* Challenges: dodge-only challenges generated from the score's sections.
   No counter/attack challenges — only survival, dodging, collecting, and mirroring. */
(function () {
  "use strict";

  var defs = [];
  var done = [];

  var TEMPLATES = [
    { id: "no_damage",   text: "No damage entire song",             check: checkNoDamage },
    { id: "clean_4",     text: "4 clean bars in a row",             check: checkClean(4) },
    { id: "clean_8",     text: "8 clean bars in a row",             check: checkClean(8) },
    { id: "clean_16",    text: "16 clean bars in a row",            check: checkClean(16) },
  ];

  function checkNoDamage(stats) { return stats.totalDamage === 0 && stats.barsSurvived > 4; }
  function checkClean(n) { return function (stats) { return stats.maxCleanBars >= n; }; }

  function sectionCheck(sectionName, label) {
    return {
      id: "survive_" + sectionName.replace(/\s+/g, "_"),
      text: "Survive the " + label + " without damage",
      check: function (stats) {
        return !(stats.damagePerSection[sectionName]);
      },
    };
  }

  function chorusRingCheck() {
    return {
      id: "perfect_chorus_rings",
      text: "Perfect dodge every ring in chorus",
      check: function (stats, hazards, player) {
        return !stats.damagePerSection["chorus"];
      },
    };
  }

  function dropNotesCheck() {
    return {
      id: "collect_all_notes",
      text: "Collect all notes in the drop",
      check: function (stats, hazards, player) {
        return player && player.notesCollected > 0 && player.notesCollected >= player.totalNotes;
      },
    };
  }

  function bridgeMirrorCheck() {
    return {
      id: "mirror_bridge",
      text: "Mirror the bridge pattern perfectly",
      check: function (stats, hazards) {
        return !stats.damagePerSection["bridge"];
      },
    };
  }

  function init(score) {
    defs = TEMPLATES.slice();
    done = [];

    var sections = score.sections || [];
    if (!sections.length && score.parts) {
      sections = score.parts.map(function (p) {
        return { name: p.role };
      });
    }

    var seen = {};
    for (var i = 0; i < sections.length; i++) {
      var name = (sections[i].name || "").toLowerCase();
      if (!name || seen[name]) continue;
      seen[name] = true;

      var label = name.charAt(0).toUpperCase() + name.slice(1);
      defs.push(sectionCheck(name, label));

      if (name === "chorus") defs.push(chorusRingCheck());
      if (name === "drop")   defs.push(dropNotesCheck());
      if (name === "bridge") defs.push(bridgeMirrorCheck());
    }
  }

  function check(stats, hazards, player, now) {
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i];
      if (done.indexOf(d.id) >= 0) continue;
      try {
        if (d.check(stats, hazards, player, now)) {
          done.push(d.id);
        }
      } catch (e) {}
    }
  }

  function completed() {
    return done.slice();
  }

  function all() {
    return defs.map(function (d) {
      return { id: d.id, text: d.text, done: done.indexOf(d.id) >= 0 };
    });
  }

  window.Challenges = {
    init: init,
    check: check,
    completed: completed,
    all: all,
  };
})();
