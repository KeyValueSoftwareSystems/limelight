const fs = require("fs");
// Default to a show that build.sh produces, so this runs from a fresh clone.
// It used to point at a file in /tmp that one session happened to leave there.
const page = process.argv[2] || "shows/levels.html";
const FPS = 40;

const html = fs.readFileSync(page, "utf8");
const src = html.match(/<script>([\s\S]*)<\/script>/)[1];
const el = () => ({
  style: {},
  classList: {
    toggle() {},
    add() {},
    contains() {
      return false;
    },
    remove() {},
  },
  innerHTML: "",
  textContent: "",
  children: [el0(), el0(), el0()],
  appendChild() {},
  getBoundingClientRect: () => ({ left: 0, width: 1000, top: 0 }),
  getContext: () => ctx(),
  setAttribute() {},
  play() {},
  pause() {},
  toBlob() {},
  onclick: null,
  scrollLeft: 0,
  clientWidth: 1000,
  clientHeight: 600,
  src: "",
  paused: true,
  files: [],
});
function el0() {
  return {
    style: {},
    classList: {
      toggle() {},
      add() {},
      contains() {
        return false;
      },
      remove() {},
    },
    textContent: "",
    setAttribute() {},
    innerHTML: "",
  };
}
function ctx() {
  const f = () => ctx();
  return new Proxy(
    {},
    {
      get: (t, k) => {
        if (k === "canvas") return { width: 1000, height: 600 };
        if (k === "createLinearGradient" || k === "createRadialGradient")
          return () => ({ addColorStop() {} });
        if (k === "createImageData")
          return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
        if (k === "measureText") return () => ({ width: 10 });
        return f;
      },
      set: () => true,
    },
  );
}
global.window = {
  innerWidth: 1400,
  innerHeight: 800,
  devicePixelRatio: 1,
  addEventListener() {},
  requestAnimationFrame() {},
  __haze: 0,
};
const docBase = {
  getElementById: () => el(),
  querySelector: () => el(),
  querySelectorAll: () => [el0(), el0()],
  createElement: () => el(),
  addEventListener() {},
  body: el(),
  head: el(),
  documentElement: { requestFullscreen() {} },
  fullscreenElement: null,
};
global.document = new Proxy(docBase, {
  get: (t, k) => (k in t ? t[k] : () => el()),
});
global.requestAnimationFrame = () => {};
global.ResizeObserver = class {
  observe() {}
};
global.atob = (s) => Buffer.from(s, "base64").toString("binary");
global.navigator = {
  clipboard: {
    writeText() {
      return Promise.resolve();
    },
  },
};
global.Blob = class {
  constructor() {}
};
global.URL = {
  createObjectURL() {
    return "x";
  },
};
global.self = global;

let out = {};
try {
  eval(
    src +
      '\nout.frame=frame;out.LAYOUTS=LAYOUTS;out.rebuildGeo=(typeof rebuildGeo==="function")?rebuildGeo:function(){};' +
      'out.setLayout=function(l){LAYOUT=l};out.DUR=DUR;out.MAP=(typeof MAP_FULL!=="undefined"&&MAP_FULL)?MAP_FULL:MAP;',
  );
} catch (e) {
  console.log("EVAL FAILED:", e.message);
  process.exit(1);
}

const M = out.MAP,
  OB = M.observations || {};
const PER = (M.grid && M.grid.period) || 0.5,
  BAR = PER * 4;
const BEATS = M.beats || [];
const DOWN =
  M.downbeats && M.downbeats.length
    ? M.downbeats
    : BEATS.filter((_, i) => i % 4 === 0);
const MOM = (M.moments || []).filter((x) => x && x.at != null);
const SPANS = (M.spans || []).filter((s) => s && s.from != null);
const ARC = require("./derive.js").make(M).arc || {};
const ONE_SHOT = { strobe: 1, co2: 1, pyro: 1, confetti: 1, laser: 1, blinder: 1 };
const ACCT = (((M.accents || {}).events) || []).map((e) => e.at).sort((a, b) => a - b);
function nearAccent(t) {
  let lo = 0, hi = ACCT.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (Math.abs(ACCT[mid] - t) <= 0.06) return true;
    if (ACCT[mid] < t) lo = mid + 1; else hi = mid - 1;
  }
  return false;
}
const PHS = (M.grid && M.grid.phase) || 0;
function nearGrid(t, div) {
  const step = PER / div;
  const x = (t - PHS) / step;
  return Math.abs(x - Math.round(x)) * step <= 0.06;
}
const DUR = out.DUR || (M.song && M.song.length) || 240;

function lvl(f) {
  let s = 0,
    n = 0;
  for (const o of f.fixtures) {
    if (o.pixels) {
      let a = 0;
      for (const p of o.pixels) a += (p[0] + p[1] + p[2]) / 765;
      s += a / Math.max(1, o.pixels.length);
      n++;
    } else if (typeof o.level === "number") {
      s += o.level;
      n++;
    }
  }
  return n ? s / n : 0;
}
function vec(f) {
  const v = [];
  for (const o of f.fixtures) {
    if (o.pixels) {
      let a = 0;
      for (const p of o.pixels) a += (p[0] + p[1] + p[2]) / 765;
      v.push(a / Math.max(1, o.pixels.length));
    } else v.push(typeof o.level === "number" ? o.level : 0);
  }
  return v;
}

let fails = 0,
  warns = 0;
function judge(name, ok, detail, soft) {
  const tag = ok ? "ok  " : soft ? "warn" : "FAIL";
  if (!ok) {
    soft ? warns++ : fails++;
  }
  console.log("   " + tag + " " + String(name).padEnd(31) + detail);
}

for (const room of Object.keys(out.LAYOUTS)) {
  out.setLayout(out.LAYOUTS[room]);
  out.rebuildGeo();
  const lim = out.LAYOUTS[room].limits || {};
  const N = Math.floor(DUR * FPS);
  const L = new Float64Array(N),
    looks = new Array(N);
  const deltas = [], quiet = [];
  let prev = null,
    panSlew = 0,
    tiltSlew = 0,
    strobeMax = 0,
    lowLaser = 0;
  const famSeen = {},
    famOn = {};
  for (let i = 0; i < N; i++) {
    const t = i / FPS;
    const f = out.frame(t);
    L[i] = lvl(f);
    looks[i] = f.look;
    const v = vec(f);
    if (prev) {
      let d = 0;
      for (let j = 0; j < v.length; j++) {
        const kk = ((out.LAYOUTS[room].fixtures[j] || {}).kind || "").toLowerCase();
        if (ONE_SHOT[kk]) continue;
        d = Math.max(d, Math.abs(v[j] - prev[j]));
      }
      let atMoment = false;
      for (const mm of MOM) if (Math.abs(mm.at - t) < 0.12) { atMoment = true; break }
      deltas.push(d);
      if (!atMoment) quiet.push(d);
    }
    prev = v;
    const fx = out.LAYOUTS[room].fixtures;
    for (let j = 0; j < f.fixtures.length; j++) {
      const o = f.fixtures[j],
        g = fx[j] || {};
      const k = (g.kind || "?").toLowerCase();
      famSeen[k] = true;
      const on = o.pixels
        ? o.pixels.some((p) => p[0] + p[1] + p[2] > 12)
        : o.level > 0.02;
      if (on) famOn[k] = (famOn[k] || 0) + 1;
      if (o.strobe) strobeMax = Math.max(strobeMax, o.strobe);
      if (
        k === "laser" &&
        o.level > 0.02 &&
        g.at &&
        g.at[2] < (lim.laser_min_height_m || 3)
      )
        lowLaser++;
    }
  }
  let meanCorr = 0, lockstep = 0, states = 0, repSpread = 1;
  {
    const S = 10, NS = Math.floor(DUR * S), V = [];
    for (let i = 0; i < NS; i++) V.push(vec(out.frame(i / S)));
    const nf = V[0].length, cols = [];
    for (let j = 0; j < nf; j++) cols.push(V.map((r) => r[j]));
    const cor = (a, b) => {
      const n = a.length;
      const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
      let sab = 0, saa = 0, sbb = 0;
      for (let i = 0; i < n; i++) { const p = a[i] - ma, q = b[i] - mb; sab += p * q; saa += p * p; sbb += q * q }
      return saa < 1e-9 || sbb < 1e-9 ? 0 : sab / Math.sqrt(saa * sbb);
    };
    let sum = 0, cnt = 0, high = 0;
    for (let a = 0; a < nf; a++) for (let b = a + 1; b < nf; b++) {
      const c = Math.abs(cor(cols[a], cols[b])); sum += c; cnt++; if (c > 0.9) high++;
    }
    meanCorr = cnt ? sum / cnt : 0;
    lockstep = cnt ? high / cnt : 0;
    states = new Set(V.map((r) => r.map((v) => Math.round(v * 4)).join(","))).size / NS;
    const SECT = ((M.sections || {}).entries) || [];
    const byId = {};
    for (const sc of SECT) (byId[sc.id] = byId[sc.id] || []).push(sc);
    const spreads = [];
    for (const id in byId) {
      const list = byId[id];
      if (list.length < 2) continue;
      const means = list.map((sc) => {
        const a = Math.floor(sc.at * S), b = Math.min(NS, a + Math.floor(8 * BAR * S));
        let t = 0, n = 0;
        for (let i = a; i < b; i++) { t += V[i].reduce((x, y) => x + y, 0) / nf; n++ }
        return n ? t / n : 0;
      });
      const mx = Math.max.apply(null, means), mn = Math.min.apply(null, means);
      if (mx > 1e-6) spreads.push((mx - mn) / mx);
    }
    repSpread = spreads.length ? spreads.reduce((x, y) => x + y, 0) / spreads.length : 0;
  }

  let nondet = 0, nondetWorst = 0;
  {
    const probes = [];
    for (let k = 0; k < 400; k++) probes.push(Math.random() * DUR);
    const first = probes.map((t) => lvl(out.frame(t)));
    for (let i = 0; i < 200; i++) out.frame(Math.random() * DUR);
    const again = probes.map((t) => lvl(out.frame(t)));
    for (let i = 0; i < probes.length; i++) {
      const d = Math.abs(first[i] - again[i]);
      if (d > 1e-9) { nondet++; if (d > nondetWorst) nondetWorst = d }
    }
  }

  const srt = quiet.slice().sort((a, b) => a - b);
  const p50 = srt[Math.floor(srt.length * 0.5)] || 0,
    p99 = srt[Math.floor(srt.length * 0.99)] || 0;
  const jumps = quiet.filter((d) => d > 0.15).length;

  let switches = 0;
  for (let i = 1; i < looks.length; i++)
    if (looks[i] !== looks[i - 1]) switches++;
  const runs = [];
  let start = 0;
  for (let i = 1; i <= looks.length; i++)
    if (i === looks.length || looks[i] !== looks[start]) {
      runs.push((i - start) / FPS);
      start = i;
    }
  const inner = runs.length > 2 ? runs.slice(1, -1) : runs;
  const shortRuns = inner.filter((r) => r < BAR - 2 / FPS).length;

  let onBeat = 0,
    offBeat = 0;
  for (let i = 2; i < N - 2; i++) {
    const rise = L[i] - L[i - 2];
    if (rise < 0.045) continue;
    const t = i / FPS;
    if (nearGrid(t, 4) || nearAccent(t)) onBeat++;
    else offBeat++;
  }
  const syncPct = onBeat + offBeat ? (100 * onBeat) / (onBeat + offBeat) : 0;

  let riseOk = 0,
    riseTot = 0;
  for (const s of SPANS) {
    const a = Math.floor(s.from * FPS),
      b = Math.floor(s.to * FPS);
    if (b - a < FPS) continue;
    riseTot++;
    const third = Math.max(1, Math.floor((b - a) / 3));
    const first =
      L.slice(a, a + third).reduce((x, y) => x + y, 0) / third;
    const dip = Math.floor(BAR * 0.5 * FPS);
    const tailEnd = Math.max(a + third + 1, b - dip);
    const tail = L.slice(a + third, tailEnd);
    const best = tail.length ? Math.max.apply(null, Array.from(tail)) : first;
    if (best > first * 1.06) riseOk++;
  }

  let dropOk = 0,
    dropTot = 0;
  for (const m of MOM) {
    if (m.kind !== "drop") continue;
    const i = Math.floor(m.at * FPS);
    if (i - FPS * 2 < 0 || i + FPS * 2 >= N) continue;
    dropTot++;
    const before =
      L.slice(i - Math.floor(FPS * 1.5), i).reduce((x, y) => x + y, 0) /
      Math.max(1, Math.floor(FPS * 1.5));
    const after =
      L.slice(i, i + Math.floor(FPS * 1.5)).reduce((x, y) => x + y, 0) /
      Math.max(1, Math.floor(FPS * 1.5));
    if (after > before * 1.1) dropOk++;
  }

  const sortedL = Array.from(L).sort((a, b) => a - b);
  const lo = sortedL[Math.floor(N * 0.05)],
    hi = sortedL[Math.floor(N * 0.95)];
  const contrast = hi - lo;

  let peakI = 0;
  for (let i = 0; i < N; i++) if (L[i] > L[peakI]) peakI = i;
  const winPeak = (function () {
    let best = -1,
      bi = 0;
    const w = Math.floor(BAR * 2 * FPS);
    for (let i = 0; i + w < N; i += Math.floor(w / 4)) {
      let s = 0;
      for (let j = i; j < i + w; j++) s += L[j];
      if (s > best) {
        best = s;
        bi = i + w / 2;
      }
    }
    return bi / FPS / DUR;
  })();
  const arcTarget = ARC.peak_at_fraction != null ? ARC.peak_at_fraction : null;

  const dark = Array.from(L).filter((v) => v < 0.03).length / N;
  const blown = Array.from(L).filter((v) => v > 0.92).length / N;
  const famMissing = Object.keys(famSeen).filter((k) => !famOn[k]);

  console.log("\n== " + room + "  (" + out.LAYOUTS[room].fixtures.length +
              " fixtures, " + N + " frames)");
  judge(
    "same t, same frame",
    nondet === 0,
    nondet === 0
      ? "400 times sampled in random order, then again after 200 other calls: identical"
      : nondet + " of 400 times changed when asked in a different order, worst by " + nondetWorst.toFixed(4),
  );
  judge(
    "no unmotivated flicker",
    p99 <= 0.34 && jumps / deltas.length < 0.1,
    "sustained fixtures, away from declared moments: p50 " +
      p50.toFixed(3) +
      " p99 " +
      p99.toFixed(3) +
      ", jumps>0.15 in " +
      ((100 * jumps) / deltas.length).toFixed(1) +
      "% of frames",
  );
  judge(
    "looks hold a bar or more",
    shortRuns === 0,
    runs.length +
      " looks, shortest " +
      Math.min.apply(null, runs).toFixed(2) +
      " s, a bar is " +
      BAR.toFixed(2) +
      " s, " +
      shortRuns +
      " too short",
  );
  judge(
    "brightening lands on beats",
    syncPct >= 80,
    syncPct.toFixed(1) +
      "% of rises within 60 ms of a beat (" +
      onBeat +
      " on, " +
      offBeat +
      " off)",
  );
  judge(
    "builds actually build",
    riseTot === 0 || riseOk === riseTot,
    riseOk + " of " + riseTot + " declared rises get brighter than they start, before the pre-drop dip",
  );
  judge(
    "drops actually drop",
    dropTot === 0 || dropOk / dropTot >= 0.8,
    dropOk + " of " + dropTot + " drops are brighter after than before",
  );
  judge(
    "the room has contrast",
    contrast >= 0.2,
    "p5 " +
      lo.toFixed(3) +
      " -> p95 " +
      hi.toFixed(3) +
      " = " +
      contrast.toFixed(3),
  );
  judge(
    "nothing is pinned",
    dark < 0.15 && blown < 0.06,
    (100 * dark).toFixed(1) +
      "% of frames near black, " +
      (100 * blown).toFixed(1) +
      "% near full",
  );
  judge(
    "the rig is not one big dimmer",
    meanCorr <= 0.45 && lockstep <= 0.12,
    "mean |correlation| between fixtures " + meanCorr.toFixed(3) +
      ", " + (100 * lockstep).toFixed(0) + "% of pairs move together above 0.9",
  );
  judge(
    "the rig has more than a few states",
    states >= 0.35,
    (100 * states).toFixed(0) + "% of sampled instants are a distinct rig state",
  );
  judge(
    "a repeat is not a copy",
    repSpread >= 0.15,
    "the same named section differs by " + (100 * repSpread).toFixed(0) +
      "% between its appearances",
    true,
  );
  judge(
    "every fixture family used",
    famMissing.length === 0,
    famMissing.length
      ? "never lit: " + famMissing.join(", ")
      : Object.keys(famOn).length + " families all used",
  );
  judge(
    "strobe within the layout cap",
    strobeMax <= (lim.max_strobe_hz || 4) + 1e-6,
    "peak " + strobeMax.toFixed(2) + " Hz, cap " + (lim.max_strobe_hz || 4),
  );
  judge(
    "lasers stay high",
    lowLaser === 0,
    lowLaser
      ? lowLaser + " frames with a laser below the floor"
      : "none below " + (lim.laser_min_height_m || 3) + " m",
  );
  if (arcTarget != null) {
    judge(
      "peaks where the song peaks",
      Math.abs(winPeak - arcTarget) <= 0.2,
      "brightest two bars at " +
        (100 * winPeak).toFixed(0) +
        "% through, song peaks at " +
        (100 * arcTarget).toFixed(0) +
        "%",
      true,
    );
  }
}

console.log(
  "\n%s   %d failures, %d warnings",
  fails ? "NOT READY" : "READY",
  fails,
  warns,
);
process.exit(fails ? 1 : 0);
