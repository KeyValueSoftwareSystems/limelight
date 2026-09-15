"use strict";
/* The portal page.

   Everything on the stage is driven by the baked DMX frames the server hands
   over: 41 channels per frame at 40 fps, read at an index taken from the audio
   element's own clock. Nothing here invents a value — if a number cannot be
   read from the frames or the score, the page says so instead. */

const $ = id => document.getElementById(id);
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* Signed: a score that opens on a pickup bar puts its first section a second
   before the recording starts, and "-0:01" is the truth about that. */
function mmss(s) {
  if (!isFinite(s)) return "—";
  const sign = s < 0 ? "-" : "";
  const a = Math.abs(s);
  return sign + Math.floor(a / 60) + ":" + String(Math.floor(a % 60)).padStart(2, "0");
}


/* ── the console ───────────────────────────────────────────────────────────
   Faders TRIM, they never edit. Everything here scales what leaves the sender;
   the show file is not touched, and releasing snaps back to the show as the
   creator wrote it. Controls 1-5 are output and take effect on the next 25 ms
   frame. Control 6 ("how much") is not a trim at all -- it changes the PLAN, so
   it rebuilds and the sender changes over on a bar line. */

const TRIM = { master: 1, par: 1, head: 1, blackout: false, strobe_kill: false, hold: false };

function pct(v) { return Math.round(v * 100) + "%"; }

function paintConsole() {
  $("vMaster").textContent = pct(TRIM.master);
  $("vPar").textContent = pct(TRIM.par);
  $("vHead").textContent = pct(TRIM.head);
  $("fMaster").value = Math.round(TRIM.master * 100);
  $("fPar").value = Math.round(TRIM.par * 100);
  $("fHead").value = Math.round(TRIM.head * 100);
  $("blackoutBtn").classList.toggle("on", TRIM.blackout);
  $("blackoutBtn").textContent = TRIM.blackout ? "Blackout — on" : "Blackout";
  $("strobeBtn").classList.toggle("on", TRIM.strobe_kill);
  $("holdBtn").classList.toggle("on", TRIM.hold);
  $("holdBtn").textContent = TRIM.hold ? "Release" : "Take control";
  const w = S.want === null ? S.natural : S.want;
  $("vWant").textContent = w === null || w === undefined ? "—"
    : Math.round(w * 100) + "%" + (S.want === null ? " (the song's own)" : "");
  if (w !== null && w !== undefined && document.activeElement !== $("fWant")) {
    $("fWant").value = Math.round(w * 100);
  }
  $("wantHint").textContent = S.swapping
    ? "rebuilding… the running show keeps playing until the next bar"
    : "restrained → maximal · rebuilds the plan, changes on the next bar";
}

let trimAt = 0;
function pushTrim(now) {
  const send = () => {
    trimAt = performance.now();
    fetch("/api/rig/trim", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(TRIM),
    }).then(r => r.json()).then(d => { S.rig = d; paintRig(); }).catch(() => {});
  };
  if (now || performance.now() - trimAt > 60) send();
}

function setTrim(patch, immediate) {
  Object.assign(TRIM, patch);
  paintConsole();
  paint();
  pushTrim(immediate);
}

/* The preview obeys the same trims, so the screen and the room agree. The
   ceiling is already in the bytes the server sent. */
function trimFixtures(fx) {
  if (!fx) return fx;
  const parK = TRIM.blackout ? 0 : TRIM.master * TRIM.par;
  const headK = TRIM.blackout ? 0 : TRIM.master * TRIM.head;
  const g = k => (k <= 0 ? 0 : Math.pow(k, 1 / GAMMA));
  const heads = fx.heads.map(h => ({ ...h, k: h.k * g(headK) }));
  return { pars: fx.pars.map(p => ({ ...p, k: p.k * g(parK) })), heads, head: heads[0] || fx.head };
}

/* ── how much (appetite) ──────────────────────────────────────────────────
   Rebuild off to the side while the running show keeps playing, then hand the
   sender the new frames with a bar line to change over on. The swap is one
   assignment inside the sender between two frames, so nothing stutters: both
   bakes are the same song at the same seed, so they have the same frame count
   and the index carries straight across. */
async function setWant(v) {
  S.want = v;
  paintConsole();
  if (!S.show) return;
  S.swapping = true;
  paintConsole();
  const t = S.clock ? S.clock.position() : 0;
  const post = await (await fetch("/api/show", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ song: S.song.name, seed: S.seed, edits: S.edits, appetite: v }),
  })).json();
  const want = ++setWant.token;
  let status;
  for (let i = 0; i < 200; i++) {
    status = await (await fetch("/api/show?job=" + post.job)).json();
    if (status.state !== "baking") break;
    await new Promise(r => setTimeout(r, 200));
  }
  if (want !== setWant.token) return;
  if (!status || status.state !== "ready") { S.swapping = false; paintConsole(); return; }
  const buf = await (await fetch(status.frames_url)).arrayBuffer();
  if (want !== setWant.token) return;

  /* the next downbeat at least a beat away, so the swap lands on music */
  const bpb = S.show.grid.beats_per_bar || 4;
  const beat = 60 / S.show.grid.bpm;
  const now = S.clock ? S.clock.position() : 0;
  const pos = positionAt(now + beat * 1.5);
  const at = pos ? secondsAtBar(pos.bar + 1) : now;

  const swap = await (await fetch("/api/rig/swap", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job: post.job, at }),
  })).json();

  const frames = new Uint8Array(buf);
  const apply = () => {
    if (want !== setWant.token) return;
    S.frames = frames;
    S.show = status.show;
    S.applied = status.applied || [];
    S.job = post.job;
    S.swapping = false;
    renderPlacements();
    paintConsole();
  };
  if (swap.error) rigJob = null;      /* make the next anchor hand the new show over */
  if (audio.paused || swap.error) apply();
  else {
    const wait = Math.max(0, (at - (S.clock ? S.clock.position() : 0)) * 1000);
    setTimeout(apply, wait);
  }
}
setWant.token = 0;

/* ── the rig ───────────────────────────────────────────────────────────────
   Addresses from readers/lights/arc4-head.layout.json; channel roles from
   readers/lights/drivers/profiles/*.profile.json. par7 carries its level in
   R/G/B (profile: brightness "colour", master parked at 255); head13 has a
   real master dimmer. Screen positions put the four pars in a shallow arc
   across the lower third with the head between the middle pair. */
const GAMMA = 1.6;                       /* wire.js puts this on the intensity channels */
const PAR = { dim: 0, r: 1, g: 2, b: 3, strobe: 4 };
const HEAD = { pan: 0, panFine: 1, tilt: 2, tiltFine: 3, speed: 4, dim: 5, strobe: 6, colour: 7, gobo: 8, prism: 9 };

/* Where each fixture sits on the screen comes from the LAYOUT the show was
   baked against, not from a constant: `at` is metres in the audience frame
   (+x = the audience's right, +z = height), so a four-lamp desk rig and a
   fourteen-fixture club rig both lay themselves out and the second one visibly
   fills more of the stage. */
function placeFixtures(show) {
  const fx = (show && show.fixtures) || [];
  if (!fx.length) return { pars: [], heads: [] };
  const xs = fx.map(f => (f.at && f.at[0]) || 0);
  const lo = Math.min(...xs), hi = Math.max(...xs);
  const span = (hi - lo) || 1;
  /* keep the rig off the edges, and give a wider rig a wider stage */
  const L = 0.09, R = 0.91;
  const zs = fx.map(f => (f.at && f.at[2]) || 0);
  const zlo = Math.min(...zs), zhi = Math.max(...zs), zspan = (zhi - zlo) || 1;
  const pars = [], heads = [];
  fx.forEach(f => {
    const x = L + ((((f.at && f.at[0]) || 0) - lo) / span) * (R - L);
    const z = (((f.at && f.at[2]) || 0) - zlo) / zspan;
    const row = {
      addr: f.address, id: f.id.replace(/_/g, " "), x,
      /* higher fixtures sit higher up the frame; a flat rig stays on the floor line */
      y: 0.782 - 0.30 * z - (zspan > 0.01 ? 0 : 0.02) * Math.abs(x - 0.5) * 2,
    };
    (f.type === "head13" ? heads : pars).push(row);
  });
  return { pars, heads };
}

/* rig.py: 8 slots of 16 DMX each, and from COLOUR_SPIN_MIN the wheel turns
   continuously so no single slot is the true answer. */
const WHEEL = [
  ["white", [1, 1, 1]], ["red", [1, 0, 0]], ["yellow", [1, 0.85, 0]], ["blue", [0, 0, 1]],
  ["green", [0, 1, 0]], ["pink", [1, 0, 0.55]], ["orange", [1, 0.3, 0]], ["light blue", [0, 0.6, 1]],
];
const wheelAt = v => (v >= 128 ? { name: "spin", rgb: [1, 1, 1] }
  : { name: WHEEL[Math.min(7, v >> 4)][0], rgb: WHEEL[Math.min(7, v >> 4)][1] });

/* rig.py, verified by live probing: pan DMX 169 faces the wall centre at
   540/255 degrees per step; tilt 40 puts the spot at PAR-beam height on a
   90 cm wall (about 20 degrees up) and 127 is straight up. */
const PAN_CENTRE = 169, PAN_DEG_PER_DMX = 540 / 255;
const TILT_WALL = 40, TILT_UP = 127, TILT_WALL_EL = 20, TILT_UP_EL = 90;
const TILT_DEG_PER_DMX = (TILT_UP_EL - TILT_WALL_EL) / (TILT_UP - TILT_WALL);

const HUE_NAMES = [[16, "red"], [44, "amber"], [66, "gold"], [150, "green"], [200, "cyan"],
                   [246, "blue"], [292, "violet"], [330, "magenta"], [360, "pink"]];

function colourName(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!mx) return "off";
  if (d / mx < 0.12) return "white";
  let h;
  if (mx === r) h = ((g - b) / d + 6) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = h * 60;
  for (const [edge, name] of HUE_NAMES) if (h < edge) return name;
  return "red";
}

/* ── state ─────────────────────────────────────────────────────────────── */

const S = {
  role: "creator",
  screen: null,
  songs: [],
  song: null,                 /* the library row */
  show: null,                 /* {fps, frame_count, sections, grid, ...} */
  frames: null,               /* Uint8Array, frame_count * 41 */
  seed: 1,
  edits: [],
  venue: null,                /* the show file being played, in venue mode */
  applied: [],
  clock: null,
  secIndex: -1,
  lastState: 0,
  job: null,
  effects: [],                /* the palette, from /api/effects */
  arm: null,                  /* the effect the pointer is carrying */
  sel: -1,                    /* the selected placement */
  rig: null,
  limits: null,
  author: "",
  showId: null,               /* identity of the show being edited, survives renaming */
  showVersion: null,
  want: null,                 /* the "how much" fader, null = the song's own number */
  natural: null,
  swapping: false,
  market: [],
  layout: null,               /* the rig this show is being rendered on */
  layouts: [],
  place: null,                /* screen positions for that rig's fixtures */
  entitlement: null,
  room: null,                 /* the venue this show is being previewed on */
  rooms: [],
  view: null,                 /* {from, to} seconds — the window the timeline shows */
  follow: true,
};

const audio = $("audio");

/* ── the clock ─────────────────────────────────────────────────────────────
   protocol/clock.js, served by this server so there is one clock in the repo.
   It reads audio.currentTime and carries it forward with a wall clock only
   between the element's own updates, so the frame index can never drift from
   the sound and never judders between them. */
function makeClock() {
  if (!window.LimelightClock || !window.LimelightClock.AnchoredClock) {
    throw new Error("protocol/clock.js did not load");
  }
  return window.LimelightClock.AnchoredClock(audio);
}

/* ── screens ───────────────────────────────────────────────────────────── */

const TABS = {
  creator: [["library", "Library"], ["venues", "Venues"], ["market", "Marketplace"]],
  venue: [["shows", "Shows"], ["venues", "Venues"], ["market", "Marketplace"]],
};

function renderTabs() {
  const box = $("tabs");
  box.innerHTML = "";
  for (const [id, label] of TABS[S.role]) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.dataset.screen = id;
    b.classList.toggle("on", S.screen === id);
    b.onclick = () => openScreen(id);
    box.appendChild(b);
  }
}

function show(name) {
  S.screen = name;
  for (const id of ["library", "shows", "market", "venues", "stage"]) $("screen-" + id).hidden = (id !== name);
  if (name !== "stage") stopPlayback();
  renderTabs();
}

function openScreen(id) {
  show(id);
  if (id === "library") loadLibrary();
  if (id === "shows") loadShows();
  if (id === "market") loadMarket();
  if (id === "venues") renderVenueCat("");
}

function setRole(role) {
  S.role = role;
  document.body.dataset.role = role;
  for (const b of $("roles").children) b.classList.toggle("on", b.dataset.role === role);
  const creator = role === "creator";
  $("editPanel").hidden = !creator;
  $("savePanel").hidden = !creator;
  $("convo").hidden = !creator;
  $("listForm").hidden = !creator;
  if (!creator) setArm(null);
  if (S.show) renderPlacements();
  if (creator) { S.venue = null; openScreen("library"); }
  else openScreen("shows");
  sizeCanvas();
  paint();
}

/* ── library ───────────────────────────────────────────────────────────── */

/* curves.energy.values, one per bar. A few scores have holes in it; the line
   breaks over a hole rather than bridging it with a number nobody measured. */
function sparkline(values) {
  if (!values || values.length < 2) return '<span class="spark"></span>';
  const n = values.length, w = 100, h = 26;
  const mx = Math.max(...values.filter(v => v !== null));
  if (!(mx > 0)) return '<span class="spark"></span>';
  let line = "", pen = false;
  values.forEach((v, i) => {
    if (v === null) { pen = false; return; }
    const x = (i / (n - 1) * w).toFixed(2);
    const y = (h - clamp(v / mx, 0, 1) * (h - 2) - 1).toFixed(2);
    line += (pen ? "L" : "M") + x + " " + y + " ";
    pen = true;
  });
  return '<svg class="spark" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" aria-hidden="true">'
    + '<path d="' + line.trim() + '"/></svg>';
}

async function loadLibrary() {
  const box = $("songs");
  if (S.songs.length) return renderLibrary();
  box.innerHTML = '<div class="song off"><span class="muted">reading the hub…</span></div>';
  try {
    const d = await (await fetch("/api/songs")).json();
    if (d.error) throw new Error(d.error);
    S.songs = d.songs;
    $("libraryMeta").textContent = d.songs.length + " songs · "
      + d.songs.filter(s => s.audio && s.bakeable).length + " playable · hub " + d.hub;
  } catch (e) {
    box.innerHTML = '<div class="song off"><span class="muted">' + e.message + "</span></div>";
    return;
  }
  renderLibrary();
}

/* ── the cover ─────────────────────────────────────────────────────────────
   A cached photograph when covers.py found one it believed, and otherwise a
   cover drawn from the score itself: the key's place on the circle of fifths
   for the hue (musical.js: ((root*7)%12)/12, the platform's own convention),
   the energy curve for the shape, and how tightly the grid locks for how sharp
   it is. Same song, same cover, every time. A real uploaded cover replaces the
   photograph by writing into portal/covers/ — the page never chooses. */

const ROOTS = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6,
                G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };

function keyHueOf(key) {
  if (!key) return null;
  const root = String(key).split(" ")[0];
  const n = ROOTS[root];
  return n === undefined ? null : ((n * 7) % 12) / 12;
}

function drawCover(cv, song) {
  const ctx2 = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  const q = song.quality || {};
  const hue = keyHueOf(q.key);
  const minor = /minor/.test(q.key || "");
  const h = hue === null ? 0.58 : hue;
  const sure = typeof q.sure === "number" ? q.sure : 0.5;
  const vals = (song.energy || []).filter(v => v !== null);
  const hsl = (l, a) => "hsla(" + Math.round(h * 360) + "," + (minor ? 42 : 62) + "%," + l + "%," + a + ")";

  ctx2.fillStyle = hsl(minor ? 11 : 15, 1);
  ctx2.fillRect(0, 0, W, H);
  const g = ctx2.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, hsl(minor ? 26 : 38, 1));
  g.addColorStop(1, hsl(minor ? 8 : 12, 1));
  ctx2.fillStyle = g;
  ctx2.fillRect(0, 0, W, H);
  if (!vals.length) return;

  /* the song's own shape: one ring whose radius is the energy of each bar. A
     loose grid draws it soft, a tight one draws it sharp -- so the cover shows
     what the card says in words. */
  const mx = Math.max(...vals) || 1;
  const cx = W * 0.5, cy = H * 0.52, R = Math.min(W, H) * 0.34;
  ctx2.lineWidth = 1 + sure * 1.6;
  ctx2.strokeStyle = hsl(74, 0.55 + sure * 0.35);
  ctx2.beginPath();
  vals.forEach((v, i) => {
    const a = (i / vals.length) * TAU - Math.PI / 2;
    const r = R * (0.42 + 0.58 * clamp(v / mx, 0, 1));
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (i) ctx2.lineTo(x, y); else ctx2.moveTo(x, y);
  });
  ctx2.closePath();
  ctx2.stroke();
  ctx2.fillStyle = hsl(60, 0.14);
  ctx2.fill();

  /* the sections, as ticks around the outside */
  ctx2.strokeStyle = hsl(88, 0.5);
  ctx2.lineWidth = 1;
  const dur = song.duration_s || 1;
  for (const sec of (song.sections || [])) {
    const a = clamp(sec.start / dur, 0, 1) * TAU - Math.PI / 2;
    ctx2.beginPath();
    ctx2.moveTo(cx + Math.cos(a) * R * 1.12, cy + Math.sin(a) * R * 1.12);
    ctx2.lineTo(cx + Math.cos(a) * R * 1.3, cy + Math.sin(a) * R * 1.3);
    ctx2.stroke();
  }
}

function renderLibrary() {
  const box = $("songs");
  box.innerHTML = "";
  for (const s of S.songs) {
    const playable = !!(s.audio && s.bakeable);
    const q = s.quality || {};
    const why = s.unavailable ? s.unavailable
      : !s.bakeable ? "no score here"
      : !s.audio ? "no audio" : "";
    const el = document.createElement("button");
    el.type = "button";
    el.className = "card" + (playable ? "" : " off");
    el.innerHTML = '<span class="art"><canvas width="320" height="320"></canvas><img alt="" hidden></span>'
      + '<span class="cardbody"><b></b><span class="sub"></span>'
      + '<span class="facts"></span><span class="lock"></span></span>'
      + '<span class="cardtag"></span>';
    el.querySelector("b").textContent = s.title;
    el.querySelector(".sub").textContent = (q.key ? q.key + " · " : "")
      + (s.bpm ? Math.round(s.bpm) + " bpm" : "—")
      + (q.tempo_changes ? " (moves " + q.tempo_changes + "×)" : "")
      + (s.duration_s ? " · " + mmss(s.duration_s) : "");
    const facts = el.querySelector(".facts");
    const bits = [];
    if (q.bars) bits.push(q.bars + " bars");
    if (q.moments) bits.push(q.moments + " moments");
    bits.push(q.per_beat ? (q.stems || []).length + " stems" : "no per-beat detail");
    if ((q.stems_absent || []).length) bits.push("no " + q.stems_absent.join("/"));
    facts.textContent = bits.join(" · ");
    const lock = el.querySelector(".lock");
    lock.textContent = (q.lock || {}).says || "";
    lock.dataset.level = (q.lock || {}).level || "unknown";
    el.querySelector(".cardtag").textContent = playable ? "" : why;

    const cv = el.querySelector("canvas");
    drawCover(cv, s);
    const cov = s.cover;
    if (cov && cov.state === "cached" && cov.file) {
      /* cache only: if the file is not there the drawn cover simply stays */
      const img = el.querySelector("img");
      img.onload = () => { img.hidden = false; cv.style.display = "none"; };
      img.onerror = () => { img.remove(); };
      img.src = "/covers/" + cov.file;
      el.title = "cover matched: " + (cov.matched ? cov.matched.artist + " — " + cov.matched.track : "?")
        + "  ·  " + cov.why;
      const m = document.createElement("span");
      m.className = "match";
      m.textContent = cov.matched ? cov.matched.artist : "";
      el.querySelector(".art").appendChild(m);
    }
    if (playable) el.onclick = () => openShow(s, { seed: 1, edits: [] });
    box.appendChild(el);
  }
}

/* ── saved shows (venue) ───────────────────────────────────────────────── */

async function loadShows() {
  const box = $("showList");
  box.innerHTML = '<div class="showrow"><span class="muted">reading portal/shows…</span></div>';
  const d = await (await fetch("/api/shows")).json();
  if (!S.songs.length) {
    const lib = await (await fetch("/api/songs")).json();
    S.songs = lib.songs || [];
  }
  $("showsMeta").textContent = d.shows.length + " saved · intent only, rebuilt on open";
  box.innerHTML = "";
  if (!d.shows.length) {
    box.innerHTML = '<div class="showrow"><span class="muted">Nothing saved yet. '
      + "Switch to Creator, open a song, place an effect and save it.</span></div>";
    return;
  }
  for (const sh of d.shows) {
    const song = S.songs.find(x => x.name === sh.song);
    const el = document.createElement("button");
    el.type = "button";
    el.className = "showrow";
    el.innerHTML = '<span class="song-name"><b></b><span class="muted"></span></span>'
      + '<span class="song-meta"></span><span class="grow"></span><span class="tag"></span>';
    el.querySelector("b").textContent = sh.name;
    el.querySelector(".song-name .muted").textContent =
      (song ? song.title : sh.song) + " · seed " + sh.seed;
    el.querySelector(".song-meta").textContent =
      (sh.edits || []).length + " effect" + ((sh.edits || []).length === 1 ? "" : "s")
      + "  ·  v" + (sh.version || 1);
    if (sh.designed_for && sh.designed_for.venue_name) {
      /* provenance only: it plays here whatever room it was made for */
      const pv = document.createElement("span");
      pv.className = "provenance";
      pv.textContent = "made for " + sh.designed_for.venue_name;
      el.querySelector(".song-name").appendChild(pv);
    }
    el.querySelector(".tag").textContent = sh.invalid ? "not a show file" : "open";
    if (sh.invalid) { el.classList.add("off"); el.querySelector(".tag").title = sh.invalid; }
    else if (!song || !song.audio) { el.classList.add("off"); el.querySelector(".tag").textContent = "song unavailable"; }
    else el.onclick = () => openShow(song, { seed: sh.seed, edits: sh.edits || [], venue: sh });
    box.appendChild(el);
  }
}



/* ── venues ────────────────────────────────────────────────────────────────
   A venue is a room with one or more named layouts under it. Picking one sets
   the rig this show renders on; the show file is not touched by the choice.
   The venue a show was SAVED under travels with it as provenance and is never
   read back to decide whether it may play — it plays anywhere. */

async function loadVenues(q) {
  try {
    const d = await (await fetch("/api/venues?q=" + encodeURIComponent(q || ""))).json();
    S.rooms = d.venues || [];
    if (!S.room && S.rooms.length) {
      const dflt = S.rooms.find(v => v.id === d.default) || S.rooms[0];
      S.room = { id: dflt.id, name: dflt.name, layout: dflt.default, example: dflt.example };
      S.layout = dflt.default;
    }
  } catch (e) { S.rooms = []; }
  return S.rooms;
}

function layoutNameOf(v, file) {
  const found = (v.layouts || []).find(l => l.file === file);
  return found ? found.name : null;
}

function paintTarget() {
  const t = $("target");
  if (!S.room || !S.show) { $("targetName").textContent = "—"; $("targetRig").textContent = ""; return; }
  const rig = rigOf(S.show.layout || S.room.layout);
  const v = S.rooms.find(x => x.id === S.room.id);
  const lname = v ? layoutNameOf(v, S.show.layout || S.room.layout) : null;
  $("targetName").textContent = S.room.name + (lname && (v.layouts || []).length > 1 ? " · " + lname : "");
  $("targetRig").textContent = rig
    ? Object.entries(rig.kinds).map(([k, n]) => n + " " + (k === "par7" ? "par" : "head") + (n === 1 ? "" : "s")).join(", ")
    : "";
  const vv = S.rooms.find(x => x.id === S.room.id) || {};
  $("targetNote").textContent = vv.rig_placeholder ? "placeholder rig — not this venue's real fixture list"
    : vv.example ? "fictional venue" : "";
  const vn = $("venueName");
  if (vn) {
    vn.textContent = S.room.name;
    $("venueLay").textContent = (lname ? lname + " · " : "")
      + (rig ? rig.fixtures + " fixtures · " + rig.channels + " ch" : "");
  }
}

async function openVenuePicker() {
  $("venueSheet").hidden = false;
  $("venueSearch").value = "";
  await renderVenues("");
  $("venueSearch").focus();
}

async function renderVenues(q) {
  const box = $("venueList");
  const vs = await loadVenues(q);
  box.innerHTML = "";
  if (!vs.length) {
    box.innerHTML = '<div class="venue"><span class="muted">no venue by that name</span></div>';
    return;
  }
  for (const v of vs) {
    const el = document.createElement("div");
    el.className = "venue" + (S.room && v.id === S.room.id ? " on" : "");
    el.innerHTML = '<div class="vh"><b></b><span class="note"></span></div>'
      + '<div class="rigline"></div><div class="lays"></div><div class="detail"></div>';
    el.querySelector("b").textContent = v.name;
    el.querySelector(".note").textContent = v.locked ? "locked — this venue has not granted you access"
      : v.rig_placeholder ? "placeholder rig — not KeyCode's actual fixture list"
      : v.example ? "fictional venue" : "";
    if (v.locked) el.classList.add("lockedrow");
    const lays = el.querySelector(".lays");
    const detail = el.querySelector(".detail");
    const showDetail = file => {
      const rig = rigOf(file);
      el.querySelector(".rigline").textContent = rig
        ? rig.rig + " · " + rig.fixtures + " fixtures · " + rig.channels + " channels"
        : "this box cannot render that rig";
      detail.innerHTML = "";
      if (!rig) return;
      /* the numbers that used to sit in the creator's rail live here, where a
         person is actually choosing a rig */
      const rows = [["fixtures", String(rig.fixtures)],
                    ["pars", String(rig.kinds.par7 || 0)],
                    ["moving heads", String(rig.kinds.head13 || 0)],
                    ["effects this rig runs", String(S.effects.length)],
                    ["frame", rig.channels + " ch"]];
      if (S.show && S.show.layout === file && S.peak !== undefined) {
        rows.push(["lit at its peak", S.peak + " of " + rig.fixtures]);
      }
      for (const [k, val] of rows) {
        const d = document.createElement("div");
        d.innerHTML = "<b></b>" + k;
        d.querySelector("b").textContent = val;
        detail.appendChild(d);
      }
    };
    let chosen = (S.room && S.room.id === v.id) ? S.room.layout : v.default;
    for (const l of v.layouts) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "lay" + (l.file === chosen ? " on" : "");
      b.textContent = l.name;
      b.onclick = ev => {
        ev.stopPropagation();
        chosen = l.file;
        [...lays.children].forEach(x => x.classList.toggle("on", x === b));
        showDetail(l.file);
      };
      lays.appendChild(b);
    }
    showDetail(chosen);
    el.onclick = () => pickVenue(v, chosen);
    box.appendChild(el);
  }
}

async function pickVenue(v, file) {
  if (v.locked) {
    const r = await (await fetch("/api/venue/use", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ venue_id: v.id }),
    })).json();
    say(r.why + " " + (r.note || ""));
    return;
  }
  $("venueSheet").hidden = true;
  const same = S.room && S.room.id === v.id && S.layout === file;
  S.room = { id: v.id, name: v.name, layout: file, example: v.example };
  S.layout = file;
  paintTarget();
  renderRigPicker();
  if (S.show && !same) await rebuild();
}


/* ── the venue catalogue ───────────────────────────────────────────────────
   A venue owns its rig and decides who may target it. That is the product
   idea, so a locked venue is shown in full and refused in plain words -- not
   hidden, and not fitted with a button that pretends to send a request. */

function monogram(cv, name, seed) {
  /* A drawn mark, not fetched and not resembling anyone's branding: the
     venue's initials over a field whose hue comes from its own name. */
  const g = cv.getContext("2d"), W = cv.width, H = cv.height;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  const initials = name.split(/[^A-Za-z0-9]+/).filter(Boolean).slice(0, 2)
    .map(w => w[0].toUpperCase()).join("");
  g.fillStyle = "hsl(" + h + ",22%,14%)";
  g.fillRect(0, 0, W, H);
  g.strokeStyle = "hsl(" + h + ",45%,52%)";
  g.lineWidth = 2;
  g.strokeRect(10.5, 10.5, W - 21, H - 21);
  g.fillStyle = "hsl(" + h + ",40%,78%)";
  g.font = "500 " + Math.round(H * 0.34) + "px Inter, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(initials, W / 2, H / 2 + 1);
}

async function renderVenueCat(q) {
  const box = $("venueCat");
  const vs = await loadVenues(q);
  $("venuesMeta").textContent = vs.length + " venues · "
    + vs.filter(v => !v.locked).length + " you can design for";
  box.innerHTML = "";
  for (const v of vs) {
    const rig = rigOf(v.default);
    const el = document.createElement("div");
    el.className = "vcard" + (v.locked ? " locked" : "");
    el.innerHTML = '<div class="mark"><canvas width="320" height="200"></canvas><img alt="" hidden></div>'
      + '<div class="vbody"><div class="vtop"><b></b><span class="vstate"></span></div>'
      + '<div class="vrig"></div><div class="vcaveat"></div><div class="vlays"></div></div>'
      + '<div class="vfoot"></div>';
    el.querySelector("b").textContent = v.name;
    const cv = el.querySelector("canvas");
    monogram(cv, v.name, v.id);
    if (v.logo_url) {
      const img = el.querySelector("img");
      img.onload = () => { img.hidden = false; cv.style.display = "none"; };
      img.onerror = () => img.remove();
      img.src = v.logo_url;
    }
    el.querySelector(".vstate").textContent = v.locked ? "locked"
      : v.example ? "fictional venue" : "open to you";
    el.querySelector(".vrig").textContent = rig
      ? rig.rig + " · " + rig.fixtures + " fixtures · "
        + Object.entries(rig.kinds).map(([k, n]) => n + "×" + (k === "par7" ? "par" : "head")).join(" + ")
        + " · " + rig.channels + " channels"
      : "this box cannot render that rig";

    const caveat = el.querySelector(".vcaveat");
    if (v.rig_placeholder) {
      caveat.textContent = v.rig_placeholder_note
        || "The rig shown is a placeholder until the real fixture list is supplied.";
      caveat.dataset.kind = "placeholder";
    } else if (v.example) {
      caveat.textContent = v.note || "Fictional venue.";
      caveat.dataset.kind = "fictional";
    } else caveat.remove();

    const lays = el.querySelector(".vlays");
    for (const l of v.layouts) {
      const t = document.createElement("span");
      t.className = "laytag" + (l.placeholder ? " ph" : "");
      t.textContent = l.name;
      lays.appendChild(t);
    }

    const foot = el.querySelector(".vfoot");
    if (v.locked) {
      const why = document.createElement("div");
      why.className = "lockwhy";
      why.textContent = v.locked_because;
      foot.appendChild(why);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "bigbtn";
      b.textContent = "Ask the venue for access";
      b.onclick = async () => {
        const r = await (await fetch("/api/venue/use", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ venue_id: v.id }),
        })).json();
        /* it does nothing, and it says so rather than looking like it sent */
        why.textContent = r.note + " " + r.why;
        why.dataset.pressed = "1";
      };
      foot.appendChild(b);
    } else {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "bigbtn on";
      b.textContent = S.room && S.room.id === v.id ? "Designing for this" : "Design for this venue";
      b.onclick = async () => {
        await pickVenue(v, v.default);
        renderVenueCat($("venueCatSearch").value);
      };
      foot.appendChild(b);
    }
    box.appendChild(el);
  }
}

/* ── the rig a show is rendered on ─────────────────────────────────────────
   Switching rigs rebuilds the SAME show file against a different layout. It
   never writes to the show: {song, seed, edits} is the whole artefact and the
   layout is not part of it, which is the entire claim -- a show made on four
   lamps at a desk runs a stage it has never seen. */

async function loadLayouts() {
  try {
    const d = await (await fetch("/api/layouts")).json();
    S.layouts = d.layouts || [];
    if (!S.layout) S.layout = d.default;
  } catch (e) { S.layouts = []; }
  renderRigPicker();
}

function rigOf(file) { return S.layouts.find(l => l.file === file) || null; }

function renderRigPicker() {
  const box = $("rigPicker");
  if (!box) return;
  box.innerHTML = "";
  for (const l of S.layouts) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rigopt" + (l.file === S.layout ? " on" : "");
    b.innerHTML = "<b></b><span></span>";
    b.querySelector("b").textContent = l.rig;
    b.querySelector("span").textContent =
      l.fixtures + " fixtures · " + Object.entries(l.kinds).map(([k, n]) => n + "×" + k).join(" + ")
      + " · " + l.channels + " ch";
    b.onclick = () => setLayout(l.file);
    box.appendChild(b);
  }
  paintRigUse();
}

/* The argument, in numbers: a bigger room gets more out of the same file. */
function paintRigUse() {
  const box = $("rigUse");
  if (!box || !S.show) return;
  if (S.role === "creator") { box.innerHTML = ""; return; }
  const l = rigOf(S.show.layout) || rigOf(S.layout);
  const n = (S.show.fixtures || []).length;
  let peak = 0, peakIdx = 0;
  if (S.frames && S.place) {
    const step = Math.max(1, Math.floor(S.show.frame_count / 400));
    for (let i = 0; i < S.show.frame_count; i += step) {
      const fx = readFixtures(i);
      if (!fx) continue;
      const lit = fx.pars.filter(p => p.k > 0.02).length + fx.heads.filter(h => h.k > 0.02).length;
      if (lit > peak) { peak = lit; peakIdx = i; }
    }
  }
  box.innerHTML = "";
  const rows = [
    ["rig", l ? l.rig : "—"],
    ["fixtures", String(n)],
    ["lit at its peak", peak + " of " + n],
    ["effects this rig runs", String(S.effects.length)],
    ["frame", S.show.channels + " channels"],
  ];
  for (const [k, v] of rows) {
    const d = document.createElement("div");
    d.innerHTML = "<b></b><span></span>";
    d.querySelector("b").textContent = k;
    d.querySelector("span").textContent = v;
    box.appendChild(d);
  }
  S.peakFrame = peakIdx;
  S.peak = peak;
}

/* how much of this rig the show actually lights, sampled across the whole show */
function measurePeak() {
  if (!S.show || !S.frames || !S.place) { S.peak = undefined; return; }
  const step = Math.max(1, Math.floor(S.show.frame_count / 400));
  let peak = 0;
  for (let i = 0; i < S.show.frame_count; i += step) {
    const fx = readFixtures(i);
    if (!fx) continue;
    const lit = fx.pars.filter(p => p.k > 0.02).length + fx.heads.filter(h => h.k > 0.02).length;
    if (lit > peak) peak = lit;
  }
  S.peak = peak;
}

async function setLayout(file) {
  if (file === S.layout) return;
  S.layout = file;
  renderRigPicker();
  if (S.show) await rebuild();
}

/* ── colours ───────────────────────────────────────────────────────────────
   A song's palette is the artist's PERSONALITY on the hub, so the control is
   one PUT to the hub and the next bake reads it back. Nothing is stored here. */

async function loadColours() {
  const box = $("colours");
  if (!box || !S.song) return;
  box.innerHTML = "";
  let info;
  try {
    info = await (await fetch("/api/colours?song=" + encodeURIComponent(S.song.name))).json();
  } catch (e) { return; }
  /* the hub states both the allowed names and their hexes, so nothing here
     invents a colour */
  const all = info.colours || [];
  if (!all.length) { box.innerHTML = '<span class="muted">the hub did not offer a palette</span>'; return; }
  S.colours = S.colours || [];
  /* what is already set on the hub, so the squares show the truth on arrival */
  const mine = (info.personalities || []).find(p => p.user === (S.author || "portal"))
            || (info.personalities || [])[0];
  S.colours = mine ? mine.colours.map(c => c.name) : [];
  for (const c of all) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch" + (S.colours.includes(c.name) ? " on" : "");
    b.title = c.name;
    b.innerHTML = "<i></i><em></em>";
    b.querySelector("i").style.background = c.hex;
    b.querySelector("em").textContent = c.name;
    b.onclick = () => {
      const i = S.colours.indexOf(c.name);
      if (i >= 0) S.colours.splice(i, 1); else S.colours.push(c.name);
      b.classList.toggle("on");
      /* one PUT for a run of clicks, so picking three colours is one change */
      clearTimeout(loadColours.timer);
      loadColours.timer = setTimeout(pushColours, 700);
    };
    box.appendChild(b);
  }
  const who = (info.personalities || []).map(p => p.user).join(", ");
  $("coloursWho").textContent = who ? ("set on the hub by " + who) : "nobody has set a palette yet";
}

async function pushColours() {
  if (!S.song) return;
  const d = await (await fetch("/api/colours", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ song: S.song.name, who: S.author || "portal", colours: S.colours || [] }),
  })).json();
  $("coloursWho").textContent = d.error ? ("the hub refused it: " + d.error)
    : "set on the hub by " + d.who + " · rebuilding…";
  if (!d.error) { await rebuild(); await loadColours(); }
}

/* ── marketplace ──────────────────────────────────────────────────────────── */

async function loadMarket() {
  const box = $("listings");
  box.innerHTML = '<div class="listing"><span class="muted">reading listings…</span></div>';
  const [m, sh] = await Promise.all([
    (await fetch("/api/market")).json(),
    (await fetch("/api/shows")).json(),
  ]);
  S.market = m.listings || [];
  $("marketMeta").textContent = S.market.length + " listed · "
    + (m.transacting ? "" : "nothing here transacts");
  const sel = $("listShow");
  sel.innerHTML = "";
  for (const s of (sh.shows || [])) {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = s.name + " · " + s.song + " · v" + s.version;
    sel.appendChild(o);
  }
  const tier = $("listTier");
  if (!tier.children.length) {
    for (const [k, v] of Object.entries(m.tiers || {})) {
      const o = document.createElement("option");
      o.value = k; o.textContent = v.label;
      tier.appendChild(o);
    }
  }
  renderListings();
}

function renderListings() {
  const box = $("listings");
  box.innerHTML = "";
  if (!S.market.length) {
    box.innerHTML = '<div class="listing"><span class="muted">'
      + "Nothing listed yet. Save a show in Creator, then list it here.</span></div>";
    return;
  }
  for (const L of S.market) renderShowListing(box, L);
}

function exampleStrip(L) {
  if (!L.example) return "";
  const d = document.createElement("div");
  d.className = "exline";
  d.textContent = L.example_note;
  return d;
}

/* Credibility is what the room did, and this is the only place it comes from.
   An EXAMPLE listing gets no numbers at all -- a figure beside a real person's
   name would be asserting a commercial relationship that does not exist. */
function signalsInto(el, L) {
  const t = L.telemetry || {};
  el.innerHTML = "";
  if (t.example || t.measured === false) {
    const d = document.createElement("div");
    d.className = "example";
    d.innerHTML = "<b>—</b>no performance data"
      + '<span class="example-flag">example listing · never measured</span>';
    el.appendChild(d);
    return;
  }
  const cells = t.plays
    ? [["venues played it", t.plays], ["took manual control", t.took_control],
       ["pulled the master", t.pulled_master], ["hours run", (t.seconds / 3600).toFixed(1)]]
    : [["venues played it", "0"], ["took manual control", "—"], ["pulled the master", "—"]];
  for (const [k, v] of cells) {
    const d = document.createElement("div");
    d.innerHTML = "<b></b>" + k;
    d.querySelector("b").textContent = v;
    el.appendChild(d);
  }
  if (!t.plays) {
    const n = document.createElement("div");
    n.className = "example";
    n.innerHTML = "<b>—</b>nobody has played it yet";
    el.appendChild(n);
  }
}

function renderShowListing(box, L) {
  const d = document.createElement("div");
  d.className = "listing" + (L.example ? " is-example" : "");
  d.innerHTML = '<div class="shot"><canvas class="live" width="480" height="270"></canvas>'
    + '<span class="at"></span></div>'
    + '<div class="body"><h3></h3><div class="by"></div><div class="blurb"></div>'
    + '<div class="standin"></div><div class="cuts"></div><div class="signals"></div></div>'
    + '<div class="side"><span class="tier"></span><button type="button" class="bigbtn">Perform</button></div>';
  d.querySelector("h3").textContent = L.show.name;
  d.querySelector(".by").textContent = "by " + L.show.author + " · " + L.show.song
    + " · seed " + L.show.seed + " · v" + L.show.version
    + " · " + (L.show.edits || []).length + " effects";
  d.querySelector(".blurb").textContent = L.blurb || "—";
  d.querySelector(".tier").textContent = (L.tier || "free");

  /* The tracks are real information about a real set; what plays here is a show
     from our own library standing in for it. Both facts belong on the card. */
  const si = d.querySelector(".standin");
  if (L.stand_in) {
    si.textContent = "Preview plays a stand-in show from this library — these tracks are not in it.";
  } else si.remove();

  if ((L.cuts || []).length) {
    const t = d.querySelector(".cuts");
    const head = document.createElement("div");
    head.className = "label";
    head.textContent = L.cuts.length + " tracks"
      + (L.cuts_source ? " · " + L.cuts_source : "");
    t.appendChild(head);
    const list = document.createElement("ol");
    L.cuts.forEach(cu => {
      const li = document.createElement("li");
      li.textContent = cu.title + (cu.artist ? " · " + cu.artist : "");
      list.appendChild(li);
    });
    t.appendChild(list);
    if (L.cuts.length > 8) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "linkbtn";
      more.textContent = "Show all " + L.cuts.length;
      more.onclick = () => { t.classList.toggle("open"); more.textContent =
        t.classList.contains("open") ? "Show fewer" : "Show all " + L.cuts.length; };
      t.appendChild(more);
    }
  } else d.querySelector(".cuts").remove();

  signalsInto(d.querySelector(".signals"), L);
  d.querySelector("button").onclick = () => performListing(L, L.show);
  if (L.example) d.querySelector(".body").prepend(exampleStrip(L));
  box.appendChild(d);
  livePreview(d.querySelector("canvas"), d.querySelector(".at"), L.show);
}

/* ── the grid that plays ───────────────────────────────────────────────────
   Every listing runs its own show, from the real baked frames, looping a few
   seconds around the moment the score itself weighted highest. Nothing else in
   a marketplace lets you watch the product working before you buy it.

   One animation loop for the whole page, only cards the viewport can see, and
   nothing at all while the tab is hidden. A card that has not loaded its frames
   yet shows its first lit frame as a still. */

const LIVE = [];
let liveRaf = null, liveDrawn = 0, liveCost = 0, liveTicks = 0;

function livePreview(cv, label, show) {
  const rec = { cv, ctx: cv.getContext("2d"), label, show, frames: null, place: null,
                from: 0, to: 0, visible: false };
  LIVE.push(rec);
  liveObserver.observe(cv);
  loadLive(rec);
  startLive();
}

const liveObserver = new IntersectionObserver(entries => {
  for (const e of entries) {
    const rec = LIVE.find(r => r.cv === e.target);
    if (rec) rec.visible = e.isIntersecting;
  }
}, { rootMargin: "120px" });

async function loadLive(rec) {
  try {
    const post = await (await fetch("/api/show", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ song: rec.show.song, seed: rec.show.seed,
                             edits: rec.show.edits, layout: S.layout }),
    })).json();
    let st;
    for (let i = 0; i < 300; i++) {
      st = await (await fetch("/api/show?job=" + post.job)).json();
      if (st.state !== "baking") break;
      await new Promise(r => setTimeout(r, 250));
    }
    if (!st || st.state !== "ready") return;
    const buf = new Uint8Array(await (await fetch(st.frames_url)).arrayBuffer());
    rec.frames = buf;
    rec.info = st.show;
    rec.place = placeFixtures(st.show);
    /* the excerpt is the show's own peak, not a window picked at random */
    const ms = (st.show.moments || []).slice().sort((a, b) => (b.weight || 0) - (a.weight || 0));
    const m = ms[0];
    const t = m ? m.t : (st.show.duration_s || 0) * 0.4;
    rec.from = Math.max(0, t - 1.2);
    rec.to = Math.min(st.show.duration_s || t + 3, rec.from + 4.5);
    rec.moment = m;
    if (rec.label) {
      rec.label.textContent = m
        ? (m.kind + (m.what ? " · " + m.what : "")) + " at " + mmss(m.t)
          + " · weight " + (m.weight || 0).toFixed(2)
        : "";
    }
  } catch (e) { /* a listing whose song is not on this box stays a still */ }
}

function startLive() {
  if (liveRaf === null) liveRaf = requestAnimationFrame(liveLoop);
}

function liveLoop(now) {
  liveRaf = requestAnimationFrame(liveLoop);
  if (document.hidden || S.screen !== "market") return;
  const t0 = performance.now();
  let drew = 0;
  for (const rec of LIVE) {
    if (!rec.visible || !rec.frames) continue;
    const span = Math.max(0.5, rec.to - rec.from);
    const pos = rec.from + ((now / 1000) % span);
    const idx = clamp(Math.floor(pos * rec.info.fps), 0, rec.info.frame_count - 1);
    if (rec.last === idx) continue;
    rec.last = idx;
    miniFrame(rec, idx);
    drew++;
  }
  liveDrawn += drew;
  liveCost += performance.now() - t0;
  liveTicks++;
}

document.addEventListener("visibilitychange", () => { for (const r of LIVE) r.last = -1; });

/* the same fixtures, the same bytes, drawn small */
function miniFrame(rec, idx) {
  const { ctx: g, cv } = rec, W = cv.width, H = cv.height;
  const base = idx * rec.info.channels, f = rec.frames;
  g.globalCompositeOperation = "source-over";
  g.fillStyle = "#07090f";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "rgba(9,11,19,0.55)";
  g.fillRect(0, H * 0.8, W, H * 0.2);
  g.globalCompositeOperation = "lighter";
  const u = H;
  for (const p of rec.place.pars) {
    const i = base + p.addr - 1;
    const r = f[i + 1], gg = f[i + 2], b = f[i + 3];
    const peak = Math.max(r, gg, b);
    if (!peak) continue;
    const k = Math.pow(peak / 255, 1 / GAMMA);
    const c = [r / peak, gg / peak, b / peak];
    const x = W * p.x, y = H * p.y;
    const R = u * 0.55 * (0.45 + 0.6 * k);
    const grad = g.createRadialGradient(x, y, 0, x, y, R);
    grad.addColorStop(0, rgba(c, 0.1 + 0.42 * k));
    grad.addColorStop(0.3, rgba(c, (0.1 + 0.42 * k) * 0.45));
    grad.addColorStop(1, rgba(c, 0));
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, R, 0, TAU); g.fill();
  }
  for (const h of rec.place.heads) {
    const i = base + h.addr - 1;
    const k = Math.pow(f[i + 5] / 255, 1 / GAMMA);
    if (k < 0.01) continue;
    const c = wheelAt(f[i + 7]).rgb;
    const panC = (f[i] * 256 + f[i + 1]) / 256, tiltC = (f[i + 2] * 256 + f[i + 3]) / 256;
    const az = (panC - PAN_CENTRE) * PAN_DEG_PER_DMX * DEG;
    const el = (TILT_WALL_EL + (tiltC - TILT_WALL) * TILT_DEG_PER_DMX) * DEG;
    const ax = Math.sin(az) * Math.cos(el), ay = Math.sin(el);
    const L = u * 1.4 * Math.hypot(ax, ay);
    const x = W * h.x, y = H * h.y;
    g.save(); g.translate(x, y); g.rotate(Math.atan2(ax, ay));
    const grad = g.createLinearGradient(0, 0, 0, -L);
    grad.addColorStop(0, rgba(c, 0.16 + 0.42 * k));
    grad.addColorStop(1, rgba(c, 0));
    g.fillStyle = grad;
    g.beginPath(); g.moveTo(-u * 0.03, 0); g.lineTo(u * 0.03, 0);
    g.lineTo(L * 0.22, -L); g.lineTo(-L * 0.22, -L); g.closePath(); g.fill();
    g.restore();
  }
  g.globalCompositeOperation = "source-over";
}

async function performListing(L, show) {
  const e = await (await fetch("/api/entitlement", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ show_id: show.id, tier: L.tier }),
  })).json();
  S.entitlement = e;
  const song = S.songs.find(x => x.name === show.song);
  if (!song) return;
  setRole("venue");
  openShow(song, { seed: show.seed, edits: show.edits, venue: { ...show, file: show.id } });
}

async function listShow() {
  const d = await (await fetch("/api/market", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ show_id: $("listShow").value, tier: $("listTier").value,
                           blurb: $("listBlurb").value }),
  })).json();
  if (!d.error) { $("listBlurb").value = ""; loadMarket(); }
}

/* ── opening a show ────────────────────────────────────────────────────── */

async function openShow(song, opts) {
  S.song = song;
  S.seed = opts.seed || 1;
  S.edits = (opts.edits || []).map(e => ({ ...e }));
  S.venue = opts.venue || null;
  S.showId = (opts.venue && opts.venue.id) || opts.id || null;
  S.showVersion = (opts.venue && opts.venue.version) || null;
  S.want = opts.appetite === undefined ? null : opts.appetite;
  S.colours = null;
  S.show = null;
  S.frames = null;
  S.secIndex = -1;
  S.sel = -1;
  setArm(null);
  show("stage");

  $("songTitle").textContent = song.title;
  $("songMeta").textContent = song.name + " · " + mmss(song.duration_s)
    + " · " + Math.round(song.bpm) + " bpm · seed " + S.seed
    + " · " + ((rigOf(S.layout) || {}).rig || "");
  $("footL").textContent = song.title + " / lighting show";
  $("rebuildNote").textContent = "";
  $("transcript").innerHTML = "";
  $("stageMsg").hidden = false;
  $("stageMsg").textContent = "baking the show…";
  $("playBtn").disabled = true;
  paintRig();
  renderSections([]);
  renderBands([]);
  renderEdits();
  paintBlank();

  stopPlayback();
  audio.src = "/audio/" + encodeURIComponent(song.name);
  audio.load();
  S.clock = makeClock();

  await rebuild();
}

/* Ask the server for the show, poll the job, take the frames as raw bytes. */
async function rebuild() {
  const want = ++rebuild.token;
  const post = await (await fetch("/api/show", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ song: S.song.name, seed: S.seed, edits: S.edits,
                           appetite: S.want, layout: S.layout }),
  })).json();
  if (post.error) return fail(post.error);
  S.job = post.job;

  let status;
  for (let i = 0; i < 300; i++) {
    status = await (await fetch("/api/show?job=" + post.job)).json();
    if (want !== rebuild.token) return;                 /* a newer rebuild overtook this one */
    if (status.state !== "baking") break;
    $("stageMsg").textContent = "baking the show… " + ((i / 4) | 0) + "s";
    await new Promise(r => setTimeout(r, 250));
  }
  if (!status || status.state !== "ready") return fail((status && status.error) || "the bake timed out");

  const buf = await (await fetch(status.frames_url)).arrayBuffer();
  if (want !== rebuild.token) return;
  S.frames = new Uint8Array(buf);
  S.show = status.show;
  S.applied = status.applied || [];
  S.place = placeFixtures(S.show);
  S.natural = S.show.appetite_natural;
  if (S.want === null && typeof S.show.appetite === "number") S.natural = S.show.appetite_natural;

  const expect = S.show.frame_count * S.show.channels;
  if (S.frames.length !== expect) {
    return fail("frames are " + S.frames.length + " bytes, expected " + expect);
  }

  $("stageMsg").hidden = true;
  $("playBtn").disabled = false;
  renderSections(S.show.sections);
  if (S.view) S.view = null;            /* a new show starts on the whole thing */
  renderBands(S.show.sections);
  paintZoom();
  renderEdits();
  $("footR").textContent = S.show.frame_count + " frames · " + S.show.fps + " fps · "
    + S.show.channels + " ch";
  $("songMeta").textContent = S.song.name + " · " + mmss(S.song.duration_s) + " · "
    + Math.round(S.song.bpm) + " bpm · seed " + S.seed + " · " + (S.show.rig || "");
  rigAnchor(true);
  paintRig();
  paintConsole();
  renderRigPicker();
  measurePeak();
  paintRigUse();
  paintTarget();
  loadColours();
  if (S.venue) {
    const n = S.applied.filter(a => !a.skipped).length;
    $("rebuildNote").textContent = "rebuilt " + S.song.name + " at seed " + S.seed
      + " on " + (S.show.rig || "?") + " · " + n + " effect" + (n === 1 ? "" : "s") + " applied";
  }
  paint();
}
rebuild.token = 0;

function fail(msg) {
  $("stageMsg").hidden = false;
  $("stageMsg").textContent = msg;
  $("playBtn").disabled = true;
}

/* ── score clock, the session.js rule ──────────────────────────────────────
   Bar 1 begins on the first downbeat whatever grid.first_bar says. Anchoring
   on first_bar instead puts every bar a whole bar late on a score that opens
   on a pickup (levels numbers its pickup bar 0). */
function grid() { return (S.show && S.show.grid) || null; }

function beatIndexAt(t) {
  const g = grid();
  if (!g) return null;
  const map = (g.tempo && g.tempo.length) ? g.tempo
    : [{ from_beat: 0, at_s: g.first_beat_s || 0, bpm: g.bpm }];
  let seg = map[0];
  for (const c of map) { if (c.at_s <= t) seg = c; else break; }
  return seg.from_beat + (t - seg.at_s) / (60 / seg.bpm);
}

function secondsAtBar(bar) {
  const g = grid();
  if (!g) return 0;
  const bpb = g.beats_per_bar || 4;
  const n = (bar - 1) * bpb;
  const map = (g.tempo && g.tempo.length) ? g.tempo
    : [{ from_beat: 0, at_s: g.first_beat_s || 0, bpm: g.bpm }];
  let seg = map[0];
  for (const c of map) { if (c.from_beat <= n) seg = c; else break; }
  return seg.at_s + (n - seg.from_beat) * (60 / seg.bpm);
}

function positionAt(t) {
  const g = grid();
  const i = beatIndexAt(t);
  if (i === null) return null;
  const bpb = g.beats_per_bar || 4;
  return { bar: 1 + Math.floor(i / bpb), beat: 1 + Math.floor((((i % bpb) + bpb) % bpb)) };
}

/* ── stage canvas ──────────────────────────────────────────────────────── */

const cv = $("stage");
const ctx = cv.getContext("2d");
let dpr = 1;

function sizeCanvas() {
  const box = cv.parentElement.getBoundingClientRect();
  dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.max(1, Math.round(box.width * dpr));
  cv.height = Math.max(1, Math.round(box.height * dpr));
}
new ResizeObserver(() => { sizeCanvas(); paint(); }).observe(cv.parentElement);

const rgba = (c, a) => "rgba(" + (c[0] * 255 | 0) + "," + (c[1] * 255 | 0) + "," + (c[2] * 255 | 0) + "," + Math.max(0, a).toFixed(3) + ")";
const toWhite = (c, t) => (t <= 0 ? c : c.map(v => v + (1 - v) * Math.min(1, t)));

/* A DMX byte is what the lamp is told, after wire.js has put a gamma of 1.6 on
   it. Undo that to get back the level the show asked for, which is what the
   eye should see on a screen. */
const level = v => (v ? Math.pow(v / 255, 1 / GAMMA) : 0);

function readFixtures(idx) {
  if (!S.frames || !S.show || !S.place) return null;
  const base = idx * S.show.channels;
  if (base < 0 || base + S.show.channels > S.frames.length) return null;
  const f = S.frames;
  const pars = S.place.pars.map(p => {
    const i = base + p.addr - 1;
    const r = f[i + PAR.r], g = f[i + PAR.g], b = f[i + PAR.b];
    const peak = Math.max(r, g, b);
    return {
      ...p, r, g, b, strobe: f[i + PAR.strobe],
      k: level(peak),
      rgb: peak ? [r / peak, g / peak, b / peak] : [0, 0, 0],
    };
  });
  const heads = S.place.heads.map(H0 => {
  const h = base + H0.addr - 1;
  const panC = (f[h + HEAD.pan] * 256 + f[h + HEAD.panFine]) / 256;
  const tiltC = (f[h + HEAD.tilt] * 256 + f[h + HEAD.tiltFine]) / 256;
  const az = (panC - PAN_CENTRE) * PAN_DEG_PER_DMX * DEG;
  const el = (TILT_WALL_EL + (tiltC - TILT_WALL) * TILT_DEG_PER_DMX) * DEG;
  /* Front-on: project the aim vector onto the screen plane. The beam rotates
     with the azimuth and foreshortens as it swings toward or away from us. */
  const ax = Math.sin(az) * Math.cos(el), ay = Math.sin(el);
  const wheel = wheelAt(f[h + HEAD.colour]);
  return {
    ...H0, panC, tiltC, dim: f[h + HEAD.dim], strobe: f[h + HEAD.strobe],
    wheel, k: level(f[h + HEAD.dim]), rgb: wheel.rgb,
    az: az / DEG, el: el / DEG,
    rot: Math.atan2(ax, ay), reach: Math.hypot(ax, ay),
  };
  });
  return { pars, heads, head: heads[0] || { x: 0.5, y: 0.74, k: 0, rgb: [1, 1, 1], rot: 0, reach: 0,
                                            az: 0, el: 0, wheel: { name: "—" }, dim: 0 } };
}

function paintBlank() {
  sizeCanvas();
  const W = cv.width / dpr, H = cv.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ground(W, H);
}

function ground(W, H) {
  ctx.globalCompositeOperation = "source-over";
  const bg = ctx.createRadialGradient(W * 0.5, H * 0.98, 0, W * 0.5, H * 0.98, Math.max(W, H) * 1.05);
  bg.addColorStop(0, "#101527");
  bg.addColorStop(0.7, "#07090f");
  bg.addColorStop(1, "#07090f");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const y = H * 0.79;
  const fg = ctx.createLinearGradient(0, y, 0, H);
  fg.addColorStop(0, "rgba(9,11,19,0.5)");
  fg.addColorStop(0.7, "rgba(7,9,15,0.94)");
  ctx.fillStyle = fg;
  ctx.fillRect(0, y, W, H - y);

  const hair = ctx.createLinearGradient(0, 0, W, 0);
  hair.addColorStop(0, "rgba(200,210,240,0)");
  hair.addColorStop(0.12, "rgba(200,210,240,0.13)");
  hair.addColorStop(0.88, "rgba(200,210,240,0.13)");
  hair.addColorStop(1, "rgba(200,210,240,0)");
  ctx.fillStyle = hair;
  ctx.fillRect(0, y, W, 1);
}

function paintStage(fx) {
  const W = cv.width / dpr, H = cv.height / dpr, u = H;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ground(W, H);

  /* The lamp bodies are painted first and opaquely: they are objects on a dark
     stage, not light. Everything after this point is light, and a fixture at
     DMX 0 adds none of it. */
  const small = fx.pars.length > 6;
  for (const p of fx.pars) housing(W * p.x, H * p.y, small ? 6 : 9);
  for (const h of fx.heads) housing(W * h.x, H * h.y, small ? 7 : 10);

  ctx.globalCompositeOperation = "lighter";

  const total = fx.pars.reduce((a, p) => a + p.k, 0) / Math.max(1, fx.pars.length);
  const headK = fx.heads.reduce((a, h) => a + h.k, 0) / Math.max(1, fx.heads.length);
  if (total > 0.01 || headK > 0.01) {
    const haze = ctx.createRadialGradient(W * 0.5, H * 0.62, 0, W * 0.5, H * 0.62, Math.max(W, H) * 0.6);
    const a = clamp(total * 0.09 + headK * 0.05, 0, 0.16);
    haze.addColorStop(0, "rgba(150,170,230," + a.toFixed(3) + ")");
    haze.addColorStop(1, "rgba(150,170,230,0)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, W, H);
  }

  for (const h of fx.heads) drawBeam(h, W, H, u, fx.heads.length);
  for (const p of fx.pars) drawPar(p, W, H, u, fx.pars.length);

  ctx.globalCompositeOperation = "source-over";
  const top = ctx.createLinearGradient(0, 0, 0, H * 0.34);
  top.addColorStop(0, "rgba(8,10,18,0.4)");
  top.addColorStop(1, "rgba(8,10,18,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, H * 0.34);
}

function housing(x, y, r) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, "#0d0f18");
  g.addColorStop(0.72, "#141722");
  g.addColorStop(1, "rgba(30,34,48,0.85)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}

function drawPar(p, W, H, u, n) {
  const scale = n > 6 ? 0.55 : 1;   /* a wider rig packs more, smaller pools */
  const x = W * p.x, y = H * p.y, c = p.rgb, k = p.k;

  if (k > 0.004) {
    const cy = y - u * 0.02;
    const R = u * 0.62 * scale * (0.5 + 0.65 * k);
    const a = 0.10 + 0.34 * k;
    let g = ctx.createRadialGradient(x, cy, 0, x, cy, R);
    g.addColorStop(0, rgba(c, a));
    g.addColorStop(0.18, rgba(c, a * 0.66));
    g.addColorStop(0.42, rgba(c, a * 0.30));
    g.addColorStop(0.70, rgba(c, a * 0.09));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, cy, R, 0, TAU); ctx.fill();

    /* The hot middle stays the lamp's own colour until it is genuinely near
       full: washing white in early flatters the render and lies about the
       colour the rig is making. */
    const R2 = u * 0.24 * scale * (0.5 + 0.8 * k);
    const a2 = 0.14 + 0.52 * k;
    g = ctx.createRadialGradient(x, y, 0, x, y, R2);
    g.addColorStop(0, rgba(toWhite(c, Math.max(0, k - 0.72) / 0.28), a2));
    g.addColorStop(0.34, rgba(c, a2 * 0.62));
    g.addColorStop(0.62, rgba(c, a2 * 0.22));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, R2, 0, TAU); ctx.fill();

    /* the pool the lamp throws on the floor in front of it */
    const ry = u * 0.15 * scale, rx = u * 0.42 * scale;
    const fy = y + u * 0.085;
    g = ctx.createRadialGradient(x, fy, 0, x, fy, rx);
    const a3 = 0.05 + 0.34 * k;
    g.addColorStop(0, rgba(c, a3));
    g.addColorStop(0.30, rgba(c, a3 * 0.44));
    g.addColorStop(0.62, rgba(c, a3 * 0.14));
    g.addColorStop(1, rgba(c, 0));
    ctx.save();
    ctx.translate(x, fy); ctx.scale(1, ry / rx); ctx.translate(-x, -fy);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, fy, rx, 0, TAU); ctx.fill();
    ctx.restore();
  }

  emitter(x, y, n > 6 ? 8 : 11, c, k);
}

/* The lit face of a lamp. Its brightness is the fixture's level and nothing
   else, so a fixture at DMX 0 leaves only its dark housing behind. */
function emitter(x, y, r, c, k) {
  if (k <= 0.004) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(toWhite(c, k * 0.75), k));
  g.addColorStop(0.46, rgba(c, k));
  g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}

function drawBeam(h, W, H, u, n) {
  const scale = n > 1 ? 0.7 : 1;
  const x = W * h.x, y = H * h.y, c = h.rgb, k = h.k;
  if (k > 0.004) {
    const L = Math.max(u * 0.12, u * 1.7 * scale * h.reach);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(h.rot);

    /* Three nested cones instead of one: the widest is nearly transparent and
       the narrowest is the hot core, which is how a beam in haze falls off
       sideways. One filled wedge reads as a slab of colour, not light. */
    const layers = [
      [0.34, 0.13, u * 0.034],
      [0.17, 0.30, u * 0.022],
      [0.07, 0.52, u * 0.012],
    ];
    for (const [spread, weight, root] of layers) {
      const a = (0.10 + 0.62 * k) * weight;
      const g = ctx.createLinearGradient(0, 0, 0, -L);
      g.addColorStop(0, rgba(toWhite(c, Math.max(0, k - 0.7) / 0.3), a));
      g.addColorStop(0.22, rgba(c, a * 0.62));
      g.addColorStop(0.55, rgba(c, a * 0.24));
      g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g;
      cone(root, L * spread, L);
    }
    ctx.restore();
  }
  emitter(x, y, 12, c, k);
}

function cone(wBottom, wTop, L) {
  ctx.beginPath();
  ctx.moveTo(-wBottom, 0);
  ctx.lineTo(wBottom, 0);
  ctx.lineTo(wTop, -L);
  ctx.lineTo(-wTop, -L);
  ctx.closePath();
  ctx.fill();
}

/* ── chrome ────────────────────────────────────────────────────────────── */

function renderSections(sections) {
  const box = $("sectionList");
  box.innerHTML = "";
  sections.forEach((s, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sec";
    b.innerHTML = "<time></time><span><b></b><span></span></span>";
    b.querySelector("time").textContent = mmss(s.start);
    b.querySelector("b").textContent = s.name || "—";
    b.querySelector("span span").textContent =
      (s.phase && s.phase !== s.name ? s.phase + " · " : "") + mmss(Math.max(0, s.end - s.start)) + " long";
    b.onclick = () => seek(s.start + 0.02);
    box.appendChild(b);
  });
}

function renderBands(sections) {
  const box = $("bands");
  box.innerHTML = "";
  const dur = (S.show && S.show.duration_s) || (S.song && S.song.duration_s) || 1;
  /* A score can open on a pickup bar before the recording starts and end its
     last section after the recording stops. The band widths are clamped to the
     audio so they stay square with the playhead; the times printed on them are
     the score's own. */
  const v = viewOf();
  sections.forEach(s => {
    const from = clamp(s.start, 0, dur), to = clamp(s.end, 0, dur);
    if (to <= v.from || from >= v.to) return;
    const d = document.createElement("div");
    d.className = "band";
    d.style.left = (clamp(tToU(from), 0, 1) * 100).toFixed(4) + "%";
    d.style.width = Math.max(0.2, (clamp(tToU(to), 0, 1) - clamp(tToU(from), 0, 1)) * 100).toFixed(4) + "%";
    d.innerHTML = "<b></b><span></span>";
    d.querySelector("b").textContent = s.name || "—";
    d.querySelector("span").textContent = mmss(s.start);
    box.appendChild(d);
  });
  renderPlacements();
}


/* ── the timeline at set length ────────────────────────────────────────────
   A set is a long song, and a long song breaks a one-strip timeline: fifteen
   minutes across 700 px is about 1.2 px per bar, which is neither readable nor
   clickable. So the strip is a WINDOW, with a thin ribbon above it showing
   where that window sits in the whole show.

   Overview-plus-detail rather than plain zoom, because a creator needs both at
   once: the ribbon answers "where am I in the set" and the strip answers "which
   bar am I putting this on", and a single zoomed strip can only answer one. The
   ribbon costs 10 px of height; a second full timeline would have cost 60. */

const ZOOMS = [1, 4, 16, 64];

function viewOf() {
  const dur = (S.show && S.show.duration_s) || 1;
  if (!S.view) return { from: 0, to: dur, span: dur, whole: true };
  const from = clamp(S.view.from, 0, dur), to = clamp(S.view.to, from + 1, dur);
  return { from, to, span: to - from, whole: to - from >= dur - 0.001 };
}

/* seconds -> 0..1 across the strip, and back */
const tToU = t => { const v = viewOf(); return (t - v.from) / v.span; };
const uToT = u => { const v = viewOf(); return v.from + u * v.span; };

function setZoom(z, centre) {
  const dur = (S.show && S.show.duration_s) || 1;
  if (z <= 1) { S.view = null; }
  else {
    const span = dur / z;
    /* Zooming with a block selected keeps that block in frame. Otherwise a
       creator zooms in to grab something and it vanishes, because the window
       went to the playhead instead. */
    const sel = (S.sel >= 0 && S.edits[S.sel]) ? secondsAtBar(S.edits[S.sel].bar) : null;
    const c = centre === undefined ? (sel !== null ? sel : (S.clock ? S.clock.position() : 0)) : centre;
    let from = clamp(c - span / 2, 0, Math.max(0, dur - span));
    S.view = { from, to: from + span };
  }
  renderBands(S.show ? S.show.sections : []);
  paint();
  paintZoom();
}

function zoomNow() {
  const dur = (S.show && S.show.duration_s) || 1;
  const v = viewOf();
  return Math.round(dur / v.span);
}

function paintZoom() {
  const box = $("zoom");
  if (!box) return;
  const dur = (S.show && S.show.duration_s) || 1;
  const now = zoomNow();
  [...box.querySelectorAll("button")].forEach(b => {
    const z = +b.dataset.zoom;
    b.classList.toggle("on", Math.abs(z - now) < Math.max(0.5, z * 0.3));
    b.disabled = dur / z < 4;              /* never zoom past a 4-second window */
  });
  const v = viewOf();
  const rib = $("ribbonWin");
  if (rib) {
    rib.style.left = (v.from / dur * 100).toFixed(3) + "%";
    rib.style.width = Math.max(0.6, v.span / dur * 100).toFixed(3) + "%";
  }
  $("zoomNote").textContent = v.whole ? "whole show"
    : mmss(v.from) + "–" + mmss(v.to) + " · " + (S.follow ? "following" : "held");
}

/* keep the playhead inside the window while it plays */
function followView() {
  /* only while it is actually playing: a creator who has zoomed in on bar 200
     to place something must not have the window pulled back to the playhead */
  if (!S.show || !S.view || !S.follow || audio.paused) return;
  const t = S.clock ? S.clock.position() : 0;
  const v = viewOf();
  if (t < v.from + v.span * 0.08 || t > v.from + v.span * 0.92) {
    const dur = S.show.duration_s || 1;
    const from = clamp(t - v.span / 2, 0, Math.max(0, dur - v.span));
    S.view = { from, to: from + v.span };
    renderBands(S.show.sections);
    paintZoom();
  }
}

/* ── placing effects on the timeline ──────────────────────────────────────
   A placement is an edit: {type, bar, beats}. It snaps to the bar, never to the
   pixel, so what the creator sees is what the show file says. */

function barAtX(clientX) {
  if (!S.show) return null;
  const r = $("timeline").getBoundingClientRect();
  const pos = positionAt(uToT(clamp((clientX - r.left) / r.width, 0, 0.99999)));
  return pos ? pos.bar : null;
}

function spanPct(bar, beats) {
  const t0 = secondsAtBar(bar);
  const t1 = t0 + beats * (secondsAtBar(bar + 1) - t0) / (S.show.grid.beats_per_bar || 4);
  const a = clamp(tToU(t0), 0, 1), b = clamp(tToU(t1), 0, 1);
  return { left: a * 100, width: Math.max(0, b - a) * 100, visible: tToU(t1) > 0 && tToU(t0) < 1 };
}

function renderPlacements() {
  const lane = $("lane");
  [...lane.querySelectorAll(".place")].forEach(el => el.remove());
  if (!S.show) return;
  S.edits.forEach((e, i) => {
    const spec = S.effects.find(x => x.id === e.type);
    const { left, width, visible } = spanPct(e.bar, e.beats);
    if (!visible) return;
    const d = document.createElement("div");
    d.className = "place" + (i === S.sel ? " sel" : "");
    d.style.left = left.toFixed(4) + "%";
    d.style.width = width.toFixed(4) + "%";
    d.title = (spec ? spec.name : e.type) + " · bar " + e.bar + " · " + e.beats + " beats";
    d.innerHTML = "<span class='grip l' title='trim the start'></span><b></b>"
      + "<button type='button' class='kill' title='remove'>&times;</button>"
      + "<span class='grip r' title='trim the end'></span>";
    d.querySelector("b").textContent = spec ? spec.name : e.type;
    if (S.role !== "creator") {
      d.querySelector(".kill").remove();
      d.querySelectorAll(".grip").forEach(x => x.remove());
      d.style.cursor = "default";
    } else {
      d.onpointerdown = ev => {
        ev.stopPropagation();
        if (ev.target.classList.contains("kill")) return;
        S.sel = i;
        renderPlacements();
        const g = ev.target.classList;
        startDrag(ev, i, g.contains("grip") ? (g.contains("l") ? "left" : "right") : "move");
      };
      d.querySelector(".kill").onclick = ev => { ev.stopPropagation(); removeEdit(i); };
    }
    lane.appendChild(d);
  });
}

/* A placed block can be moved, and trimmed from either edge. All three snap to
   the bar (or the beat, for an edge), never to the pixel, so what the creator
   sees is exactly what the show file says. */
function startDrag(ev, i, mode) {
  const e = S.edits[i];
  const bpb = (S.show.grid.beats_per_bar || 4);
  const start0 = (e.bar - 1) * bpb;
  const end0 = start0 + e.beats;
  const r0 = $("timeline").getBoundingClientRect();
  const beatAtX = x => beatIndexAt(uToT(clamp((x - r0.left) / r0.width, 0, 0.99999)));
  const grab = beatAtX(ev.clientX);
  let dirty = false;

  const move = m => {
    const b = beatAtX(m.clientX);
    if (mode === "move") {
      const bar = Math.max(1, Math.round((start0 + (b - grab)) / bpb) + 1);
      if (bar !== e.bar) { e.bar = bar; dirty = true; renderPlacements(); }
    } else if (mode === "right") {
      const beats = Math.max(1, Math.round(b - start0));
      if (beats !== e.beats) { e.beats = beats; dirty = true; renderPlacements(); }
    } else {
      const s2 = Math.min(end0 - 1, Math.round(b));
      const bar = Math.floor(s2 / bpb) + 1;
      const beats = end0 - (bar - 1) * bpb;
      if (beats >= 1 && (bar !== e.bar || beats !== e.beats)) {
        e.bar = bar; e.beats = beats; dirty = true; renderPlacements();
      }
    }
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (dirty) rebuild();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function removeEdit(i) {
  S.edits.splice(i, 1);
  S.sel = -1;
  renderPlacements();
  rebuild();
}

function setArm(id) {
  S.arm = (S.arm === id) ? null : id;
  [...$("palette").children].forEach(el => el.classList.toggle("on", el.dataset.id === S.arm));
  $("timeline").classList.toggle("arm", !!S.arm);
  $("ghost").hidden = true;
  $("armHint").textContent = S.arm
    ? "Click the timeline to place it. Escape to put it back."
    : "Pick one, then click the timeline to place it. Drag its edge to lengthen.";
}

function renderPalette() {
  const box = $("palette");
  box.innerHTML = "";
  for (const e of S.effects) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tile";
    b.dataset.id = e.id;
    b.innerHTML = "<b></b><span></span>";
    b.querySelector("b").textContent = e.name;
    b.querySelector("span").textContent = e.blurb;
    b.onclick = () => setArm(e.id);
    box.appendChild(b);
  }
}

function paint() {
  if (!S.show || !S.frames) return;
  const t = S.clock ? S.clock.position() : 0;
  const idx = clamp(Math.floor(t * S.show.fps), 0, S.show.frame_count - 1);
  const raw = readFixtures(idx);
  if (!raw) return;
  const fx = trimFixtures(raw);
  paintStage(fx);
  paintChrome(t, idx, fx);
  if (!audio.paused) rigAnchor(false);
}

function paintChrome(t, idx, fx) {
  const dur = S.show.duration_s || 1;
  followView();
  $("clock").textContent = mmss(t) + " / " + mmss(dur);
  $("scrubKnob").style.left = (clamp(t / dur, 0, 1) * 100).toFixed(3) + "%";
  const u = tToU(t);
  const ph = $("playhead");
  ph.hidden = u < 0 || u > 1;
  ph.style.left = (clamp(u, 0, 1) * 100).toFixed(3) + "%";
  const rp = $("ribbonHead");
  if (rp) rp.style.left = (clamp(t / dur, 0, 1) * 100).toFixed(3) + "%";

  const pos = positionAt(t);
  $("barno").textContent = pos ? String(pos.bar) : "—";
  $("beatno").textContent = pos ? String(pos.beat) : "—";
  $("frameno").textContent = String(idx);
  $("syncNote").textContent = "audio " + t.toFixed(3) + "s · frame " + idx
    + " = " + (idx / S.show.fps).toFixed(3) + "s";

  let i = -1;
  S.show.sections.forEach((s, j) => { if (t >= s.start && t < s.end) i = j; });
  if (i !== S.secIndex) {
    S.secIndex = i;
    [...$("sectionList").children].forEach((el, j) => el.classList.toggle("on", j === i));
    [...$("bands").children].forEach((el, j) => el.classList.toggle("on", j === i));
    const s = S.show.sections[i];
    $("nowName").textContent = s ? (s.name || "—") : "—";
    $("nowRange").textContent = s
      ? mmss(s.start) + " – " + mmss(s.end) + (s.phase ? "  ·  " + s.phase : "") : "";
  }

  /* throttled while it runs, immediate when it does not: after a seek the rail
     must describe the frame on screen, not the one before it */
  const now = performance.now();
  if (S.role === "venue" && (audio.paused || now - S.lastState > 90)) {
    S.lastState = now;
    paintState(fx);
  }
}

/* The rig's state in words and colour, one line per group: a chip showing what
   that group is ACTUALLY at on this frame, its name, and the reading. An
   operator mid-set should be able to say what the stage looks like without
   turning round. */

const rgbCss = c => "rgb(" + (c[0] * 255 | 0) + "," + (c[1] * 255 | 0) + "," + (c[2] * 255 | 0) + ")";

function meanColour(list) {
  const lit = list.filter(x => x.k > 0.02);
  if (!lit.length) return null;
  const w = lit.reduce((s, x) => s + x.k, 0);
  return [0, 1, 2].map(i => lit.reduce((s, x) => s + x.rgb[i] * x.k, 0) / w);
}

function reading(name, rgb, k) {
  return { chip: k > 0.004 && rgb ? rgbCss(rgb) : null, name,
           value: k > 0.004 ? name0(rgb) + " · " + Math.round(k * 100) + "%" : "out" };
}
const name0 = rgb => rgb ? colourName(rgb[0] * 255, rgb[1] * 255, rgb[2] * 255) : "—";

function paintState(fx) {
  if (fx.pars.length > 6) return paintStateGrouped(fx);
  const rows = fx.pars.map(p => reading(p.id, p.rgb, p.k));
  for (const h of fx.heads) {
    rows.push({ chip: h.k > 0.004 ? rgbCss(h.rgb) : null, name: h.id,
                value: h.k > 0.004 ? h.wheel.name + " · " + Math.round(h.k * 100) + "%" : "out" });
  }
  if (fx.heads.length === 1) {
    rows.push({ chip: null, name: "aim",
                value: fx.heads[0].az.toFixed(0) + "° / " + fx.heads[0].el.toFixed(0) + "°" });
  }
  paintRows(rows);
}

/* A twelve-lamp rig does not want twelve rows; what an operator reads at a
   glance is how much of the rig is alight and what colour it is. */
function paintStateGrouped(fx) {
  const lit = a => a.filter(x => x.k > 0.02).length;
  const avg = a => (a.length ? a.reduce((s, x) => s + x.k, 0) / a.length : 0);
  const pc = meanColour(fx.pars), hc = meanColour(fx.heads);
  paintRows([
    { chip: pc ? rgbCss(pc) : null, name: "par wash",
      value: pc ? name0(pc) + " · " + Math.round(avg(fx.pars) * 100) + "%" : "out" },
    { chip: null, name: "pars alight", value: lit(fx.pars) + " of " + fx.pars.length },
    { chip: hc ? rgbCss(hc) : null, name: "heads",
      value: hc ? name0(hc) + " · " + Math.round(avg(fx.heads) * 100) + "%" : "out" },
    { chip: null, name: "heads alight", value: lit(fx.heads) + " of " + fx.heads.length },
  ]);
}

function paintRows(rows) {
  const box = $("stateRows");
  if (box.children.length !== rows.length) {
    box.innerHTML = rows.map(() => "<div><i></i><b></b><span></span></div>").join("");
  }
  rows.forEach((r, i) => {
    const el = box.children[i];
    const chip = el.querySelector("i");
    chip.style.background = r.chip || "transparent";
    chip.classList.toggle("empty", !r.chip);
    el.querySelector("b").textContent = r.name;
    el.querySelector("span").textContent = r.value;
  });
}


/* ── transport ─────────────────────────────────────────────────────────── */

let raf = null;

function loop() {
  raf = requestAnimationFrame(loop);
  paint();
}

function startLoop() { if (raf === null) raf = requestAnimationFrame(loop); }
function stopLoop() { if (raf !== null) { cancelAnimationFrame(raf); raf = null; } }

function stopPlayback() {
  stopLoop();
  try { audio.pause(); } catch (e) { /* nothing to pause */ }
  $("playBtn").textContent = "Play";
}

function togglePlay() {
  if (!S.clock || !S.show) return;
  if (audio.paused) {
    S.clock.play();
    $("playBtn").textContent = "Pause";
    startLoop();
  } else {
    S.clock.pause();
    $("playBtn").textContent = "Play";
    paint();
    stopLoop();
  }
}

function seek(t) {
  if (!S.clock || !S.show) return;
  S.clock.seek(clamp(t, 0, (S.show.duration_s || 1) - 0.01));
  paint();
}

/* the strip scrubs inside its window; the bar under the transport stays the
   whole show, so there is always one control that reaches the far end */
function scrubbingView(e) {
  const el = $("timeline");
  const move = ev => {
    const r = el.getBoundingClientRect();
    seek(uToT(clamp((ev.clientX - r.left) / r.width, 0, 0.9999)));
  };
  move(e);
  const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function scrubbing(e, dur) {
  const el = e.currentTarget;
  const move = ev => {
    const r = el.getBoundingClientRect();
    seek(clamp((ev.clientX - r.left) / r.width, 0, 0.9999) * dur);
  };
  move(e);
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}


function renderEdits() {
  const box = $("editList");
  box.innerHTML = "";
  if (!S.edits.length) {
    box.innerHTML = '<div class="none">Nothing placed yet.</div>';
    return;
  }
  S.edits.forEach((e, i) => {
    const spec = S.effects.find(x => x.id === e.type);
    const applied = S.applied.find(a => a.type === e.type && a.bar === e.bar);
    const d = document.createElement("div");
    d.innerHTML = "<span></span>";
    d.querySelector("span").textContent = (spec ? spec.name : e.type)
      + " · bar " + e.bar + " · " + e.beats + " beat" + (e.beats === 1 ? "" : "s")
      + (applied ? "  (" + mmss(applied.from_s) + ", frames " + applied.from_frame + "–" + applied.to_frame + ")" : "");
    if (S.role === "creator") {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "linkbtn";
      b.textContent = "Remove";
      b.onclick = () => removeEdit(i);
      d.appendChild(b);
    }
    box.appendChild(d);
  });
}

async function rigPoll() {
  try {
    S.rig = await (await fetch("/api/rig")).json();
  } catch (e) {
    S.rig = null;
  }
  paintRig();
}


async function saveShow() {
  if (!S.show) return;
  const name = ($("showName").value || "").trim();
  if (!name) { say("give the show a name before saving it"); $("showName").focus(); return; }
  const d = await (await fetch("/api/shows", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: S.showId, song: S.song.name, seed: S.seed, edits: S.edits,
                           name, author: S.author || "unknown", appetite: S.want,
                           score_version: S.song ? S.song.version : null,
                           designed_for: S.room ? { venue_id: S.room.id, venue_name: S.room.name,
                                                    layout: S.layout } : null }),
  })).json();
  if (!d.error) { S.showId = d.id; S.showVersion = d.version; }
  say(d.error ? d.error
    : "saved " + d.name + " v" + d.version + " (" + d.id + ") by " + d.author + " · "
      + d.edits.length + " effect" + (d.edits.length === 1 ? "" : "s") + " as intent, no frames");
  if (!d.error) $("showName").value = "";
}

function paintRig() {
  const r = S.rig, pill = $("rigPill"), btn = $("rigBtn");
  const det = { set textContent(v) { pill.title = v; } };
  if (!r) {
    pill.dataset.state = "dead"; pill.textContent = "portal unreachable";
    btn.disabled = true; pill.title = ""; return;
  }
  btn.disabled = !r.can_send || !S.show;
  btn.classList.toggle("on", !!r.armed);
  btn.textContent = r.armed ? "Stop sending" : "Send to the rig";

  if (!r.can_send) {
    pill.dataset.state = "dead";
    pill.textContent = "no output";
    det.textContent = r.why_not || "the Art-Net socket is not open";
    return;
  }
  if (r.sending) {
    pill.dataset.state = "live";
    /* What is knowable is what left this machine. Art-Net is one-way: no sender
       can tell you the lamps received it, so the pill does not say they did. */
    pill.textContent = "sending · " + r.frames_sent.toLocaleString() + " frames";
    det.textContent = "40 fps leaving this machine for Art-Net " + r.gateway
      + " universe " + r.universe + " · frame " + r.last_index
      + " · audio clock " + r.anchor_age_ms + " ms old"
      + " · Art-Net is one-way, so this is what was sent, not what the lamps received";
    return;
  }
  if (r.armed) {
    pill.dataset.state = r.last_error ? "dead" : "armed";
    pill.textContent = r.last_error ? "send failing" : "armed — nothing leaving";
    det.textContent = (r.last_error ? "the socket refused a frame: " + r.last_error + " · "
      : r.anchor_age_ms === null ? "press play: the rig follows the audio · "
      : "no clock for " + r.anchor_age_ms + " ms, so the rig is parked · ")
      + r.frames_sent.toLocaleString() + " frames sent so far";
    return;
  }
  pill.dataset.state = "off";
  pill.textContent = "standby";
  det.textContent = (r.conflict ? r.conflict + " · " : "")
    + "socket open to " + r.gateway + " universe " + r.universe + ", sending nothing";
}

async function rigToggle() {
  if (!S.rig) return;
  const want = !S.rig.armed;
  const d = await (await fetch("/api/rig", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ armed: want }),
  })).json();
  if (d.error) {
    $("rigPill").dataset.state = "dead";
    $("rigPill").textContent = "refused";
    $("rigPill").title = d.error;
    say(d.error);
    return;
  }
  S.rig = d;
  if (want) rigAnchor(true);
  paintRig();
}

/* Tell the server where the audio actually is. It carries this forward between
   posts and parks the rig if they stop, so the lamps can never run on a clock
   nobody is feeding. */
let rigAnchorAt = 0, rigJob = null;
function rigAnchor(force) {
  if (!S.job || !S.show) return;
  /* Hand a newly baked show over once so there is something to arm, then keep
     the anchor fresh only while the rig is actually armed. */
  const handover = S.job !== rigJob;
  if (!handover && !(S.rig && S.rig.armed)) return;
  const now = performance.now();
  if (!force && !handover && now - rigAnchorAt < 120) return;
  rigAnchorAt = now;
  rigJob = S.job;
  fetch("/api/rig/at", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job: S.job, position: S.clock ? S.clock.position() : 0 }),
  }).then(r => {
    /* the baker only keeps the last few shows; if this one has aged out, forget
       the handover so the next anchor loads it again rather than leaving the
       rig parked on a show the server no longer has */
    if (!r.ok) { rigJob = null; return null; }
    return r.json();
  }).then(d => { if (d) S.rig = d; }).catch(() => { rigJob = null; });
}

/* ── transcript, and the seam a real edit goes through ─────────────────── */

function say(text, echo) {
  const d = document.createElement("div");
  const now = new Date();
  d.innerHTML = "<time></time><p></p>";
  d.querySelector("time").textContent =
    String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
  d.querySelector("p").innerHTML = echo
    ? "<span></span><i> → </i><em></em>" : "<em></em>";
  if (echo) {
    d.querySelector("span").textContent = echo;
    d.querySelector("em").textContent = text;
  } else {
    d.querySelector("em").textContent = text;
  }
  $("transcript").appendChild(d);
  $("transcript").scrollTop = $("transcript").scrollHeight;
}

/* THE SEAM. A plain-English edit has everything it needs right here: the
   words, the song, where the listener is, and S.edits — which the server
   already turns into real changes to the frames, the way `blackout` does. A
   real implementation returns edits to add and calls rebuild(). Until one
   exists this says nothing changed, because nothing did. */
async function applyInstruction(text, at) {          // eslint-disable-line no-unused-vars
  return { changed: false, said: "not yet wired — the show is unchanged." };
}

async function onSay() {
  const text = $("say").value.trim();
  if (!text) return;
  $("say").value = "";
  const at = S.clock ? S.clock.position() : 0;
  const r = await applyInstruction(text, at);
  say(r.said, text);
  if (r.changed) { S.edits = r.edits; await rebuild(); }
}


/* ── a fader board, if one is plugged in ───────────────────────────────────
   A venue operator will not drag a mouse during a set. Web MIDI maps the six
   controls onto the first eight CCs a board sends, which covers a nanoKONTROL2
   (CC 0-7) and an X-Touch Mini (CC 1-8). UNTESTED: no board was attached while
   this was written, so the only thing proven is that a browser without Web MIDI
   degrades to the on-screen console with a line saying so. */

const MIDI_MAP = {
  master: [0, 1], par: [1, 2], head: [2, 3], want: [3, 4],
  blackout: [32, 46, 89], strobe: [33, 47, 90], hold: [34, 48, 91],
};

function midiNote(text) { $("midiNote").textContent = text; }

async function startMidi() {
  if (!navigator.requestMIDIAccess) {
    midiNote("no fader board: this browser has no Web MIDI. The console above is the console.");
    return;
  }
  let access;
  try {
    access = await navigator.requestMIDIAccess({ sysex: false });
  } catch (e) {
    midiNote("no fader board: MIDI access was refused (" + e.name + ").");
    return;
  }
  const attach = () => {
    const names = [];
    for (const input of access.inputs.values()) {
      names.push(input.name);
      input.onmidimessage = onMidi;
    }
    midiNote(names.length
      ? "fader board: " + names.join(", ") + " — CC 0-3 are master / pars / heads / how much (untested with hardware)"
      : "no fader board plugged in. The console above is the console.");
  };
  access.onstatechange = attach;
  attach();
}

function onMidi(e) {
  const [status, cc, val] = e.data;
  if ((status & 0xf0) !== 0xb0) return;            /* control change only */
  const v = val / 127;
  if (MIDI_MAP.master.includes(cc)) return setTrim({ master: v }, true);
  if (MIDI_MAP.par.includes(cc)) return setTrim({ par: v }, true);
  if (MIDI_MAP.head.includes(cc)) return setTrim({ head: v }, true);
  if (MIDI_MAP.want.includes(cc)) { $("fWant").value = Math.round(v * 100); return setWant(+v.toFixed(2)); }
  if (val < 64) return;                            /* buttons act on press */
  if (MIDI_MAP.blackout.includes(cc)) return setTrim({ blackout: !TRIM.blackout }, true);
  if (MIDI_MAP.strobe.includes(cc)) return setTrim({ strobe_kill: !TRIM.strobe_kill }, true);
  if (MIDI_MAP.hold.includes(cc)) return setTrim({ hold: !TRIM.hold }, true);
}

/* ── wiring ────────────────────────────────────────────────────────────── */

$("roles").onclick = e => { if (e.target.dataset.role) setRole(e.target.dataset.role); };
$("backBtn").onclick = () => { stopPlayback(); show(S.venue ? "shows" : "library"); };
$("playBtn").onclick = togglePlay;
$("prevBtn").onclick = () => {
  if (!S.show) return;
  const t = S.clock.position();
  const before = S.show.sections.filter(s => s.start < t - 1.5);
  seek(before.length ? before[before.length - 1].start + 0.02 : 0);
};
$("nextBtn").onclick = () => {
  if (!S.show) return;
  const t = S.clock.position();
  const after = S.show.sections.find(s => s.start > t + 0.05);
  seek(after ? after.start + 0.02 : (S.show.duration_s || 1) - 0.05);
};
$("scrub").onpointerdown = e => S.show && scrubbing(e, S.show.duration_s || 1);

/* The timeline is two tools on one strip: scrub when nothing is armed, place
   when something is. It is never both at once, so a placement click can never
   also throw the playhead somewhere. */
$("timeline").onpointerdown = e => {
  if (!S.show) return;
  if (!S.arm || S.role !== "creator") {
    if (e.target.closest(".place")) return;
    S.sel = -1;
    renderPlacements();
    return scrubbingView(e);
  }
  const bar = barAtX(e.clientX);
  if (bar === null) return;
  const spec = S.effects.find(x => x.id === S.arm);
  S.edits.push({ type: S.arm, bar, beats: spec.beats });
  S.sel = S.edits.length - 1;
  setArm(null);
  renderPlacements();
  rebuild();
};

$("timeline").onpointermove = e => {
  if (!S.arm || !S.show) return;
  const bar = barAtX(e.clientX);
  if (bar === null) return;
  const spec = S.effects.find(x => x.id === S.arm);
  const { left, width } = spanPct(bar, spec.beats);
  const g = $("ghost");
  g.hidden = false;
  g.style.left = left.toFixed(4) + "%";
  g.style.width = width.toFixed(4) + "%";
  g.querySelector("span").textContent = spec.name + " · bar " + bar;
};
$("timeline").onpointerleave = () => { $("ghost").hidden = true; };

$("zoom").onclick = e => { if (e.target.dataset.zoom) { S.follow = true; setZoom(+e.target.dataset.zoom); } };
$("ribbon").onpointerdown = e => {
  if (!S.show) return;
  const el = $("ribbon");
  const move = ev => {
    const r = el.getBoundingClientRect();
    const t = clamp((ev.clientX - r.left) / r.width, 0, 1) * (S.show.duration_s || 1);
    S.follow = false;
    setZoom(zoomNow(), t);
  };
  move(e);
  const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
};
$("timeline").onwheel = e => {
  if (!S.show) return;
  e.preventDefault();
  const i = ZOOMS.indexOf(ZOOMS.reduce((a, b) => Math.abs(b - zoomNow()) < Math.abs(a - zoomNow()) ? b : a));
  const next = ZOOMS[clamp(i + (e.deltaY > 0 ? -1 : 1), 0, ZOOMS.length - 1)];
  const r = $("timeline").getBoundingClientRect();
  S.follow = false;
  setZoom(next, uToT(clamp((e.clientX - r.left) / r.width, 0, 1)));
};
$("targetBtn").onclick = openVenuePicker;
$("venueBtn").onclick = openVenuePicker;
$("venueClose").onclick = () => { $("venueSheet").hidden = true; };
$("venueSheet").onclick = e => { if (e.target === $("venueSheet")) $("venueSheet").hidden = true; };
$("venueSearch").oninput = e => renderVenues(e.target.value);
$("venueCatSearch").oninput = e => renderVenueCat(e.target.value);
$("rigBtn").onclick = rigToggle;
$("fMaster").oninput = e => setTrim({ master: +e.target.value / 100 });
$("fPar").oninput = e => setTrim({ par: +e.target.value / 100 });
$("fHead").oninput = e => setTrim({ head: +e.target.value / 100 });
$("fWant").onchange = e => setWant(+e.target.value / 100);
$("blackoutBtn").onclick = () => setTrim({ blackout: !TRIM.blackout }, true);
$("strobeBtn").onclick = () => setTrim({ strobe_kill: !TRIM.strobe_kill }, true);
$("holdBtn").onclick = () => setTrim({ hold: !TRIM.hold }, true);
$("listBtn").onclick = listShow;

$("authorName").oninput = e => { S.author = e.target.value.trim(); try { localStorage.setItem("ll.author", S.author); } catch (x) {} };
$("saveShow").onclick = saveShow;
$("say").onkeydown = e => { if (e.key === "Enter") onSay(); };
audio.addEventListener("ended", () => { $("playBtn").textContent = "Play"; stopLoop(); paint(); });
audio.addEventListener("error", () => {
  if (audio.src) fail("the audio would not load — the show cannot be played in step");
});

window.addEventListener("keydown", e => {
  if (S.screen !== "stage" || e.target.tagName === "INPUT") return;
  if (e.key === " ") { e.preventDefault(); togglePlay(); }
  if (e.key === "Escape" && !$("venueSheet").hidden) { e.preventDefault(); $("venueSheet").hidden = true; return; }
  if (e.key === "Escape" && S.arm) { e.preventDefault(); setArm(null); }
  if ((e.key === "Delete" || e.key === "Backspace") && S.sel >= 0 && S.role === "creator") {
    e.preventDefault();
    removeEdit(S.sel);
  }
});

sizeCanvas();

(async () => {
  try {
    S.effects = (await (await fetch("/api/effects")).json()).effects || [];
  } catch (e) {
    S.effects = [];
  }
  renderPalette();
  try { S.author = localStorage.getItem("ll.author") || ""; } catch (e) { S.author = ""; }
  $("authorName").value = S.author;
  await loadLayouts();
  await loadVenues("");
  try { S.limits = await (await fetch("/api/limits")).json(); } catch (e) { S.limits = null; }
  paintLimits();
  paintConsole();
  setRole("creator");
  rigPoll();
  setInterval(rigPoll, 1000);
  startMidi();
})();

function paintLimits() {
  const box = $("limitsBox");
  const L = S.limits;
  if (!L) { box.innerHTML = '<div class="muted">limits unavailable</div>'; return; }
  const rows = [
    ["par ceiling", Math.round(L.max_intensity.par * 100) + "%"],
    ["head ceiling", Math.round(L.max_intensity.head * 100) + "%"],
    ["strobe", L.strobe.allowed ? "max " + L.strobe.max : "off"],
    ["keep-out", L.keep_out.length ? L.keep_out.map(z => z.name).join(", ") : "none"],
    ["pan slew", L.max_rate.pan_per_frame === null ? "free" : L.max_rate.pan_per_frame + "/frame"],
  ];
  box.innerHTML = "";
  for (const [k, v] of rows) {
    const d = document.createElement("div");
    d.innerHTML = "<b></b><span></span>";
    d.querySelector("b").textContent = k;
    d.querySelector("span").textContent = v;
    box.appendChild(d);
  }
}
