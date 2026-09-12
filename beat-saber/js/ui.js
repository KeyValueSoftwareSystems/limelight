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
        songs = lib.map((s, i) => ({ ...s, icon: ICONS[i % ICONS.length], playable: !!s.score }));
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
    `<li class="songlist__note">Limelight server not detected &mdash; showing demo list. ` +
    `Run <code>python3 serve.py</code> and open <code>/beat-saber/</code> to play real tracks.</li>`);
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
  showScreen("game");
  try {
    await window.Game.start(song, { difficulty, inputName: "mouse", latency_ms, onEnd: showResults });
  } catch (err) {
    console.error("could not start:", err);
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
