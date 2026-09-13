/* Telegraph: 4-stage lifecycle for every hazard.
   OUTLINE (bar -1) -> FILL (beats 3-4) -> STRIKE (downbeat) -> CLEAR (bar +1)
   Timing is driven by the caller passing beat-fractional progress. */
(function () {
  "use strict";

  var STAGES = { PENDING: 0, OUTLINE: 1, FILL: 2, STRIKE: 3, CLEAR: 4, DONE: 5 };

  function create(opts) {
    return {
      id: opts.id || Math.random().toString(36).slice(2),
      type: opts.type || "sweep",
      bar: opts.bar,
      beat: opts.beat || 1,
      bpb: opts.bpb || 4,
      stage: STAGES.PENDING,
      stageName: "pending",
      progress: 0,
      damageDealt: false,
      data: opts.data || {},
      spawnBar: opts.bar - 1,
    };
  }

  function advance(t, currentBar, currentBeat, bpb) {
    bpb = bpb || 4;
    var targetBar = t.bar;

    if (currentBar < targetBar - 1) {
      t.stage = STAGES.PENDING;
      t.stageName = "pending";
      t.progress = 0;
      return;
    }

    if (currentBar === targetBar - 1) {
      t.stage = STAGES.OUTLINE;
      t.stageName = "outline";
      t.progress = currentBeat / bpb;
      if (currentBeat >= bpb - 1) {
        t.stage = STAGES.FILL;
        t.stageName = "fill";
        t.progress = (currentBeat - (bpb - 2)) / 2;
      }
      return;
    }

    if (currentBar === targetBar) {
      if (currentBeat < 1.5) {
        t.stage = STAGES.STRIKE;
        t.stageName = "strike";
        t.progress = currentBeat / 1.5;
        return;
      }
      t.stage = STAGES.CLEAR;
      t.stageName = "clear";
      t.progress = (currentBeat - 1.5) / (bpb - 1.5);
      return;
    }

    if (currentBar === targetBar + 1 && currentBeat < 2) {
      t.stage = STAGES.CLEAR;
      t.stageName = "clear";
      t.progress = 1;
      return;
    }

    t.stage = STAGES.DONE;
    t.stageName = "done";
    t.progress = 1;
  }

  function isDamaging(t) {
    return t.stage === STAGES.STRIKE && !t.damageDealt;
  }

  function markDamaged(t) {
    t.damageDealt = true;
  }

  function isDone(t) {
    return t.stage === STAGES.DONE;
  }

  function Pool() {
    var active = [];

    function add(opts) {
      var t = create(opts);
      active.push(t);
      return t;
    }

    function tick(currentBar, currentBeat, bpb) {
      for (var i = active.length - 1; i >= 0; i--) {
        advance(active[i], currentBar, currentBeat, bpb);
        if (isDone(active[i])) {
          active.splice(i, 1);
        }
      }
    }

    function getActive() {
      return active;
    }

    function clear() {
      active = [];
    }

    return { add: add, tick: tick, getActive: getActive, clear: clear };
  }

  window.Telegraph = {
    STAGES: STAGES,
    create: create,
    advance: advance,
    isDamaging: isDamaging,
    markDamaged: markDamaged,
    isDone: isDone,
    Pool: Pool,
  };
})();
