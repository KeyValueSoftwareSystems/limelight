/* ============================================================
   Beat Saber — UI navigation, real song library, game lifecycle
   ------------------------------------------------------------
   Songs come from the Limelight server (/library.json + scores). If the
   server isn't there (game opened standalone), we fall back to mock songs
   so the menus still work — but Start needs the real protocol feed.
   ============================================================ */

// Mock fallback — used only when the Limelight server can't be reached.
const MOCK_SONGS = [
  { slug: null, name: "Neon Pulse",   artist: "SYNTHWARE",  bpm: 128, length: "3:12", icon: "♫", playable: false },
  { slug: null, name: "Voltage",      artist: "Kilobyte",   bpm: 174, length: "2:48", icon: "⚡", playable: false },
  { slug: null, name: "Crimson Drive",artist: "Nova Reign", bpm: 140, length: "3:40", icon: "◈", playable: false },
];

const ICONS = ["♫", "⚡", "◈", "◆", "▲", "⚔", "◐"];

let songs = [];
let selected = 0;
let difficulty = "Easy";

// ---- Screen navigation ----------------------------------------------------
const screens = document.querySelectorAll(".screen");
function showScreen(name) {
  screens.forEach((s) => s.classList.toggle("is-active", s.id === `screen-${name}`));
}

document.addEventListener("click", (e) => {
  const navBtn = e.target.closest("[data-nav]");
  if (navBtn) {
    if (window.Game) window.Game.stop();   // leaving any screen ends a running song
    showScreen(navBtn.dataset.nav);
  }
});

// ---- Load the real library (with graceful fallback) -----------------------
async function initLibrary() {
  const el = document.getElementById("songlist");
  if (window.Limelight) {
    try {
      const lib = await window.Limelight.fetchLibrary();
      if (lib.length) {
        songs = lib.map((s, i) => ({ ...s, icon: ICONS[i % ICONS.length], playable: !!s.audio }));
        renderSongs(); selectSong(0);
        return;
      }
    } catch (err) {
      console.warn("Limelight library unavailable, using mock songs:", err);
    }
  }
  songs = MOCK_SONGS.slice();
  renderSongs(); selectSong(0);
  if (el) el.insertAdjacentHTML("afterbegin",
    `<li class="songlist__note">Hub unreachable &mdash; showing demo list. ` +
    `Start the game with <code>python3 beat-saber/server.py</code> (it talks to the hub).</li>`);
}

// ---- Song list rendering --------------------------------------------------
function renderSongs() {
  const songlist = document.getElementById("songlist");
  songlist.innerHTML = "";
  songs.forEach((song, i) => {
    const li = document.createElement("li");
    li.className = "song" + (i === selected ? " is-active" : "");
    li.dataset.index = i;
    li.innerHTML = `
      <div class="song__art">${song.icon}</div>
      <div class="song__info">
        <div class="song__title">${song.name}</div>
        <div class="song__artist">${song.artist}</div>
      </div>
      <div class="song__bpm">BPM<b>${song.bpm || "—"}</b></div>`;
    li.addEventListener("click", () => selectSong(i));
    songlist.appendChild(li);
  });
}

function selectSong(i) {
  selected = i;
  document.querySelectorAll(".song").forEach((el) =>
    el.classList.toggle("is-active", Number(el.dataset.index) === i));
  const s = songs[i];
  document.getElementById("preview-cover").textContent = s.icon;
  document.getElementById("preview-title").textContent = s.name;
  document.getElementById("preview-artist").textContent = s.artist;
  document.getElementById("preview-bpm").textContent = s.bpm || "—";
  document.getElementById("preview-length").textContent = s.length || "—";
  document.getElementById("preview-hiscore").textContent = s.hiscore || "—";

  const start = document.getElementById("btn-start");
  const label = start.querySelector("span").nextSibling;   // the " Start" text node
  if (s.playable === false) {
    start.setAttribute("disabled", "");
    label.textContent = " Not playable (demo)";
  } else {
    start.removeAttribute("disabled");
    label.textContent = " Start";
  }
}

// ---- Difficulty pills -----------------------------------------------------
document.getElementById("difficulty").addEventListener("click", (e) => {
  const pill = e.target.closest(".diff");
  if (!pill) return;
  document.querySelectorAll(".diff").forEach((d) => d.classList.remove("is-selected"));
  pill.classList.add("is-selected");
  difficulty = pill.textContent.trim();
});

// ---- Webcam calibration ---------------------------------------------------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const calBtn = document.getElementById("cal-webcam");
if (calBtn) calBtn.addEventListener("click", runWebcamCalibration);

const flipBtn = document.getElementById("cal-flip");
if (flipBtn) flipBtn.addEventListener("click", () => {
  // Toggle the stored horizontal flip so a saber that moves the wrong way can be
  // corrected. A throwaway source instance just reads/writes the saved value.
  try {
    const src = window.SaberSources.create("webcam", document.body);
    const cur = src.getCalibration();
    src.setFlip(!cur.flipX, cur.flipY);
    flipBtn.classList.toggle("btn--primary");
  } catch (e) { /* webcam module unavailable */ }
});

// A cancellable calibration session so the modal is never a trap: Cancel, a
// click on the backdrop, or Esc always closes it and releases the camera.
let calSession = null;

function closeCalOverlay() { document.getElementById("cal-overlay").hidden = true; }
function cancelCalibration() {
  if (calSession) {
    calSession.cancelled = true;
    try { if (calSession.src) calSession.src.stop(); } catch (e) {}
    calSession = null;
  }
  closeCalOverlay();
}
const calCancelBtn = document.getElementById("cal-cancel");
if (calCancelBtn) calCancelBtn.addEventListener("click", cancelCalibration);
const calOverlayEl = document.getElementById("cal-overlay");
if (calOverlayEl) calOverlayEl.addEventListener("click", (e) => {
  if (e.target.id === "cal-overlay") cancelCalibration();   // click outside the box
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && calOverlayEl && !calOverlayEl.hidden) cancelCalibration();
});

async function runWebcamCalibration() {
  if (!window.SaberSources || !window.SaberSources.has("webcam")) return;
  if (calSession) return;                       // already running
  const overlay = document.getElementById("cal-overlay");
  const msg = document.getElementById("cal-msg");
  const count = document.getElementById("cal-count");
  const session = { src: null, cancelled: false };
  calSession = session;
  overlay.hidden = false; count.textContent = "";
  msg.textContent = "Starting camera… first load can take a few seconds";

  const src = window.SaberSources.create("webcam", document.body);
  session.src = src;
  try {
    await Promise.race([
      src.start(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 25000)),
    ]);
  } catch (err) {
    if (session.cancelled) return;             // user already closed it
    console.warn("calibration: camera unavailable", err);
    try { src.stop(); } catch (e) {}
    msg.textContent = "Camera unavailable — check permissions.";
    count.textContent = "";
    await wait(2500);
    if (calSession === session) { calSession = null; closeCalOverlay(); }
    return;
  }
  if (session.cancelled) { try { src.stop(); } catch (e) {} return; }

  const SECS = 6;
  msg.textContent = "Sweep your hand around the play area";
  const done = src.calibrate(SECS * 1000);
  for (let s = SECS; s > 0 && !session.cancelled; s--) { count.textContent = s; await wait(1000); }
  if (session.cancelled) return;
  const res = await done;
  if (session.cancelled) return;
  count.textContent = "";
  msg.textContent = res.ok ? "Calibration saved ✓" : "Not enough movement — try again.";
  try { src.stop(); } catch (e) {}
  await wait(1400);
  if (calSession === session) { calSession = null; closeCalOverlay(); }
}

// ---- Add a song (upload -> hub scoring pipeline -> library) ----------------
const addFile = document.getElementById("add-file");
const addPick = document.getElementById("add-pick");
const addDrop = document.getElementById("add-drop");
const addUpload = document.getElementById("add-upload");
const addStatus = document.getElementById("add-status");
const addStatusText = document.getElementById("add-statustext");
let chosenFile = null;

const STATUS_LABEL = {
  queued: "Queued for scoring…",
  generating: "Scoring the track… (this can take a few minutes)",
  storing: "Saving the beatmap…",
  done: "Added ✓  it's in your library",
  error: "Scoring failed",
};

if (addFile) addFile.addEventListener("change", () => {
  chosenFile = addFile.files[0] || null;
  addPick.textContent = chosenFile ? chosenFile.name : "Choose an MP3…";
  addDrop.classList.toggle("has-file", !!chosenFile);
  addUpload.disabled = !chosenFile;
});

function setAddStatus(text, state) {
  addStatus.hidden = false;
  addStatus.classList.remove("is-done", "is-error");
  if (state) addStatus.classList.add(state);
  addStatusText.textContent = text;
}

if (addUpload) addUpload.addEventListener("click", async () => {
  if (!chosenFile || !window.Limelight) return;
  addUpload.disabled = true;
  setAddStatus("Uploading to the hub…", null);
  let res;
  try {
    res = await window.Limelight.addSong(chosenFile);
  } catch (err) {
    setAddStatus(String(err.message || err), "is-error");
    addUpload.disabled = false;
    return;
  }
  // poll the hub's generation queue for this score
  const scoreName = res.score_name;
  const t0 = Date.now();
  while (Date.now() - t0 < 15 * 60 * 1000) {
    const job = (await window.Limelight.jobs()).find((j) => j.score_name === scoreName);
    const st = job ? job.status : "queued";
    if (st === "done") {
      setAddStatus(STATUS_LABEL.done, "is-done");
      await initLibrary();                     // refresh the select list
      await wait(1200);
      showScreen("songs");
      return;
    }
    if (st === "error") {
      setAddStatus((job && job.error) ? "Scoring failed: " + job.error : STATUS_LABEL.error, "is-error");
      addUpload.disabled = false;
      return;
    }
    setAddStatus(STATUS_LABEL[st] || "Working…", null);
    await wait(3000);
  }
  setAddStatus("Still scoring on the hub — it'll appear in the library when ready.", null);
  addUpload.disabled = false;
});

// ---- Game lifecycle -------------------------------------------------------
document.getElementById("btn-start").addEventListener("click", startGame);
document.getElementById("btn-retry").addEventListener("click", startGame);
document.getElementById("btn-end").addEventListener("click", () => {
  if (window.Game) window.Game.stop();
  showResults(window.Game ? window.Game.getStats() : null);
});

async function startGame() {
  const song = songs[selected];
  if (!song || song.playable === false || !window.Game) return;
  const latEl = document.getElementById("set-latency");
  const latency_ms = latEl ? Number(latEl.value) : 0;
  const camEl = document.getElementById("set-webcam");
  const useWebcam = camEl && camEl.checked && window.SaberSources && window.SaberSources.has("webcam");
  const inputName = useWebcam ? "webcam" : "mouse";
  showScreen("game");
  try {
    await window.Game.start(song, { difficulty, inputName, latency_ms, onEnd: showResults });
  } catch (err) {
    if (inputName === "webcam") {                    // tracking failed: fall back to mouse
      console.warn("webcam unavailable, falling back to mouse:", err);
      try {
        await window.Game.start(song, { difficulty, inputName: "mouse", latency_ms, onEnd: showResults });
        return;
      } catch (err2) { console.error("mouse fallback failed:", err2); }
    } else {
      console.error("could not start:", err);
    }
    showResults(null);
  }
}

function showResults(result) {
  const r = result || { score: 0, accuracy: 0, maxCombo: 0, rank: "—" };
  document.getElementById("res-score").textContent = (r.score || 0).toLocaleString();
  document.getElementById("res-acc").textContent = (r.accuracy || 0).toFixed(1) + "%";
  document.getElementById("res-combo").textContent = r.maxCombo || 0;
  document.getElementById("results-rank").textContent = r.rank || "—";
  showScreen("results");
}

// ---- Init -----------------------------------------------------------------
initLibrary();
