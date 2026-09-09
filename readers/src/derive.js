/* ================= derive =================
   The one place a reader works out what the map deliberately does not say.

   Four fields used to be written into the file: anticipation, remaining, arc
   and lead. Not one of them was a measurement. Each was a function of fields
   already in the file -- moments, spans, sections, energy, stems -- so the file
   carried the same fact twice, in two shapes, and the two copies were free to
   disagree the moment either writer changed. anticipation was 125 rows of
   arithmetic over `moments`. arc was the argmax of `energy`. remaining was a
   subtraction. lead was a comparison between series already present.

   They are computed here instead, once, so every reader gets the same answer
   and there is one place to fix when the answer is wrong.

   Purity: every function here is f(map, t). Nothing is remembered between
   calls. The precomputation below is f(map) only -- it runs at load and depends
   on no t -- so asking for t=47 twice gives identical numbers, and asking for
   t=47 first gives the same numbers as arriving there in order.            */
var DERIVE = (function () {
  "use strict";

  function make(map) {
    var m = map || {};
    var g = m.grid || {};
    var per = g.period || null;
    var beats = m.beats || [];
    var downs = m.downbeats && m.downbeats.length ? m.downbeats : null;
    var bpb = g.beats_per_bar || 4;
    var DUR = (m.song && m.song.length) || (beats.length ? beats[beats.length - 1] : 0);

    /* bar lines. Prefer the ones the map states. Fall back to the grid, and if
       there is no grid either, say so rather than inventing a bar length. */
    var bars = downs;
    if (!bars && per && g.phase !== undefined && g.phase !== null) {
      bars = [];
      for (var t0 = g.phase, k = 0; t0 + k * per * bpb <= DUR + 1e-6; k++)
        bars.push(t0 + k * per * bpb);
    }
    if (!bars && beats.length) {
      bars = [];
      for (var i = (g.bar_phase || 0); i < beats.length; i += bpb) bars.push(beats[i]);
    }
    bars = bars || [];
    var barLen = per ? per * bpb : (bars.length > 1 ? bars[1] - bars[0] : null);

    function idx(arr, t) {                    // last index with arr[i] <= t
      var lo = 0, hi = arr.length - 1, ans = -1;
      while (lo <= hi) { var mid = (lo + hi) >> 1;
        if (arr[mid] <= t + 1e-9) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
      return ans;
    }
    function inBars(dt) { return barLen ? dt / barLen : null; }

    var moments = (m.moments || []).slice().sort(function (a, b) { return a.at - b.at; });
    var spans = (m.spans || []).slice().sort(function (a, b) { return a.from - b.from; });
    var secs = m.sections && m.sections.entries ? m.sections.entries
             : (Array.isArray(m.sections) ? m.sections : []);
    secs = secs.slice().sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
    var energy = m.energy || [];

    /* ---- anticipation: what is coming, in bars ----------------------------
       Everything else in the file is retrospective; it says what IS at a time.
       A reader asked for a frame at t=18 cannot know a drop is 1.9 s away
       without walking `moments`, and every reader that walks it separately
       walks it slightly differently. */
    /* A moment landing on this instant is happening NOW, not coming in zero
       bars. The first version of this looked strictly forward and reported
       to_next=0 on every bar that carried a moment, disagreeing with the
       field it replaced on 11 of Levels' 127 bars. The field was right. */
    var NOW_S = 0.06;
    function anticipationAt(t) {
      var nxt = null, prv = null, now = null;
      for (var i = 0; i < moments.length; i++) {
        if (Math.abs(moments[i].at - t) <= NOW_S) { now = moments[i]; prv = moments[i]; continue; }
        if (moments[i].at > t) { nxt = moments[i]; break; }
        prv = moments[i];
      }
      var inside = null;
      for (var j = 0; j < spans.length; j++) {
        var s = spans[j];
        if (s.from <= t + 1e-9 && t < s.to - 1e-9) {
          inside = { kind: s.kind,
                     through: (t - s.from) / Math.max(1e-9, s.to - s.from),
                     shape: s.rise || null };
          break;
        }
      }
      return {
        to_next: nxt ? inBars(nxt.at - t) : null,
        next_kind: nxt ? nxt.kind : null,
        next_at: nxt ? nxt.at : null,
        since_prev: prv ? inBars(t - prv.at) : null,
        prev_kind: prv ? prv.kind : null,
        now_kind: now ? now.kind : null,
        inside: inside
      };
    }

    /* ---- remaining: how much of this is left -----------------------------
       The other half of the same question. A reader holding something back
       needs to know it has three bars of section left, not that the section
       started 29 s ago. */
    function remainingAt(t) {
      function left(from, to) {
        if (from === null || to === null) return null;
        return { from: from, to: to, bars_left: inBars(to - t),
                 bars_in: inBars(t - from),
                 through: (t - from) / Math.max(1e-9, to - from) };
      }
      var si = idx(secs.map(function (s) { return s.at || 0; }), t);
      var sec = si >= 0
        ? left(secs[si].at || 0, si + 1 < secs.length ? secs[si + 1].at : DUR) : null;
      if (sec) { sec.name = secs[si].name || null; sec.repeat = secs[si].repeat || 1; }
      var sp = null;
      for (var j = 0; j < spans.length; j++)
        if (spans[j].from <= t + 1e-9 && t < spans[j].to - 1e-9) {
          sp = left(spans[j].from, spans[j].to); sp.kind = spans[j].kind; break;
        }
      var bi = idx(bars, t);
      return {
        section: sec,
        span: sp,
        bar: bi >= 0 && barLen ? { index: bi, through: (t - bars[bi]) / barLen } : null,
        song: DUR ? { bars_left: inBars(DUR - t), through: t / DUR } : null
      };
    }

    /* ---- arc: the whole shape, so a reader can hold something back --------
       Read straight off `energy`. A reader can see the next bar but not the
       whole, and a show that spends everything on the first drop has nothing
       left for the climax. */
    var ARC = (function () {
      if (energy.length < 3) return null;
      var vs = energy.map(function (e) { return e[1]; });
      var ts = energy.map(function (e) { return e[0]; });
      var hi = 0, lo = 0;
      for (var i = 1; i < vs.length; i++) { if (vs[i] > vs[hi]) hi = i; if (vs[i] < vs[lo]) lo = i; }
      var near = 0;
      for (var k = 0; k < vs.length; k++) if (vs[k] >= vs[hi] - 0.02) near++;
      var fifth = [];
      for (var f = 0; f < 5; f++) {
        var a = Math.floor(f * vs.length / 5), b = Math.floor((f + 1) * vs.length / 5);
        var s = 0, n = 0;
        for (var q = a; q < b; q++) { s += vs[q]; n++; }
        fifth.push(n ? s / n : 0);
      }
      return {
        peak_at_s: ts[hi], peak_at_fraction: DUR ? ts[hi] / DUR : null,
        quietest_at_s: ts[lo], range: vs[hi] - vs[lo],
        peak_is_well_defined: near <= 3,
        bars_within_2pct_of_the_peak_anywhere: near,
        mean_by_fifth: fifth
      };
    })();

    /* ---- lead: which source is carrying the song --------------------------
       stems.sources used to be normalised per stem, which made the six series
       incomparable: every one of them touched 1.0 at its own loudest bar, so a
       guitar 43 dB down tied with the drums, and Starlight read as piano-led
       for 43 bars from a stem the separator invented. That is fixed at the
       writer now -- stems.sources is a level against the mix -- so this is a
       comparison rather than a repair, and it abstains on a file that still
       carries the old normalised shape rather than guessing a scale. */
    var st = m.stems || {}, src = st.sources || {}, lv = st.levels || null;
    var present = [];
    for (var name in src) {
      if (!Object.prototype.hasOwnProperty.call(src, name)) continue;
      if (lv && lv[name] && lv[name].present === false) continue;
      if (Array.isArray(src[name]) && src[name].length) present.push(name);
    }
    var comparable = st.comparable === true;
    var norm = {};
    present.forEach(function (n) {                 // each stem against its own habit
      var a = src[n].slice().sort(function (x, y) { return x - y; });
      var p10 = a[Math.floor(0.10 * (a.length - 1))], p90 = a[Math.floor(0.90 * (a.length - 1))];
      norm[n] = { p10: p10, p90: p90, span: Math.max(1e-6, p90 - p10) };
    });
    /* Two ways to ask about a stem, because they answer different questions and
       conflating them is what broke `lead`.

         stemDb    the level against the mix, in dB. Comparable ACROSS stems:
                   -4 dB is louder than -22 dB whichever stems they are.
         stem01    that stem's own range mapped to 0..1, for a curve whose shape
                   a reader wants to draw or follow. NOT comparable across
                   stems -- every one of them reaches 1.0 at its own loudest
                   bar, which is exactly the mistake the file used to make. Use
                   it for "how much is the guitar doing right now", never for
                   "which instrument is loudest".

       Both tolerate a map written before the unit changed: if stems.comparable
       is not set the values are already 0..1 and stemDb abstains rather than
       reading a normalised number as a decibel. */
    var IS_DB = comparable === true;
    function seriesAt(n, t) {
      var v = src[n];
      if (!v || !v.length || !bars.length) return null;
      var i = idx(bars, t);
      if (i < 0) return v[0];
      if (i + 1 >= bars.length || i + 1 >= v.length) return v[v.length - 1];
      var f = (t - bars[i]) / Math.max(1e-9, bars[i + 1] - bars[i]);
      return v[i] + (v[i + 1] - v[i]) * Math.max(0, Math.min(1, f));
    }
    function stemDb(n, t) {
      if (!IS_DB) return null;
      return seriesAt(n, t);
    }
    function stem01(n, t) {
      var x = seriesAt(n, t);
      if (x === null) return null;
      if (!IS_DB) return Math.max(0, Math.min(1, x));
      var q = norm[n];
      if (!q) return 0;
      return Math.max(0, Math.min(1, (x - q.p10) / q.span));
    }

    /* The leader is the stem taking an unusual SHARE of the bar, not the loud
       one. Ranking levels picks the drums in every bar of every four-on-the-
       floor record; ranking "how far above its own loudest" picks nothing,
       because at a loud bar all six sit near their own maximum -- measured, the
       margins came out at 0.01 to 0.04 on all five songs, which is noise.

       A share removes the whole mix getting louder: at each bar every present
       stem's energy is divided by the bar's total, and the leader is the stem
       furthest above the share it usually takes. A bar where everything is
       loud has no leader, which is correct -- nothing is stepping forward. */
    var shares = {}, meanShare = {};
    if (comparable && present.length) {
      var nb = 0;
      present.forEach(function (n) { nb = Math.max(nb, src[n].length); shares[n] = []; });
      for (var bi2 = 0; bi2 < nb; bi2++) {
        var tot = 0, lin = {};
        present.forEach(function (n) {
          var d = bi2 < src[n].length ? src[n][bi2] : -120;
          lin[n] = Math.pow(10, d / 10);
          tot += lin[n];
        });
        present.forEach(function (n) { shares[n].push(tot > 0 ? lin[n] / tot : 0); });
      }
      present.forEach(function (n) {
        var s2 = 0;
        for (var i2 = 0; i2 < shares[n].length; i2++) s2 += shares[n][i2];
        meanShare[n] = shares[n].length ? s2 / shares[n].length : 0;
      });
    }
    function leadAt(t) {
      if (!comparable || !present.length || !bars.length) return null;
      var bi = idx(bars, t);
      if (bi < 0) return null;
      var best = null, second = null;
      for (var i = 0; i < present.length; i++) {
        var n = present[i];
        if (bi >= shares[n].length) continue;
        var row = { of: n, share: shares[n][bi],
                    usual_share: meanShare[n],
                    above_its_usual_share: shares[n][bi] - meanShare[n] };
        if (!best || row.above_its_usual_share > best.above_its_usual_share) { second = best; best = row; }
        else if (!second || row.above_its_usual_share > second.above_its_usual_share) second = row;
      }
      if (!best) return null;
      best.margin_over_next = second ? best.above_its_usual_share - second.above_its_usual_share : null;
      best.at = bars[bi];
      return best;
    }

    return {
      bars: bars, bar_length: barLen,
      stemDb: stemDb, stem01: stem01, stem_is_db: IS_DB,
      anticipationAt: anticipationAt,
      remainingAt: remainingAt,
      arc: ARC,
      leadAt: leadAt,
      lead_available: comparable && present.length > 0,
      stems_present: present
    };
  }

  return { make: make };
})();
if (typeof module !== "undefined" && module.exports) module.exports = DERIVE;
