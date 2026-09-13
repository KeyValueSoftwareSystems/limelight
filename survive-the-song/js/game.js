/* Survive the Song — the playable arena.
   ---------------------------------------------------------------------------
   A real top-down survival game, not a demo. You are the blue survivor; the
   song is the boss in the middle. It telegraphs danger in coral -- a warning
   you can read -- then the danger goes live. Be somewhere else when it does.

     WASD / arrows   move
     SPACE           dash (a quick burst + a few frames of invulnerability)

   Three hearts. Survive to the end of the song and you win.

   Everything lives in normalised arena space: the centre is (0,0) and the rim
   is radius 1, so positions, attacks and collisions are all resolution- and
   aspect-independent. The renderer converts to pixels once, per frame.

   The music is not wired to the real frame() engine yet -- a steady internal
   clock drives the sections and the attack timing so the loop is fully
   playable now. Swapping that clock for frame() is the next step. */
"use strict";

(function () {
  const TAU = Math.PI * 2;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const now = () => performance.now() / 1000;
  const angDiff = (a, b) => Math.abs(((a - b + Math.PI) % TAU + TAU) % TAU - Math.PI);

  /* -------- tuning -------- */
  const SONG_LEN = 90;            // seconds; survive this long to win
  const PLAYER_R = 0.07;          // collision radius, arena units
  const PLAYER_SPEED = 1.45;      // arena units / second
  const DASH_SPEED = 4.2;
  const DASH_TIME = 0.16;
  const DASH_IFRAMES = 0.24;
  const DASH_COOLDOWN = 0.6;
  const HIT_IFRAMES = 1.1;
  const BOSS_R = 0.2;

  /* section timeline -- what the boss is "playing", and when. The attack
     director reads the current section to choose its danger. */
  const TIMELINE = [
    { s: "verse",     until: 14 },
    { s: "prechorus", until: 24 },
    { s: "chorus",    until: 40 },
    { s: "verse",     until: 50 },
    { s: "prechorus", until: 58 },
    { s: "chorus",    until: 74 },
    { s: "drop",      until: SONG_LEN },
  ];
  const SECTION = {
    verse:     { tag: "VERSE",      cls: "tag--verse",     interval: 1.7, lead: 1.15, live: 0.32, danger: "#ff8b98" },
    prechorus: { tag: "PRE-CHORUS", cls: "tag--prechorus", interval: 1.3, lead: 1.0,  live: 0.32, danger: "#ff7382" },
    chorus:    { tag: "CHORUS",     cls: "tag--chorus",    interval: 1.0, lead: 0.85, live: 0.34, danger: "#ff5a6e" },
    drop:      { tag: "DROP",       cls: "tag--drop",      interval: 0.7, lead: 0.65, live: 0.34, danger: "#ff4d63" },
  };
  const sectionAt = (t) => (TIMELINE.find((x) => t < x.until) || TIMELINE[TIMELINE.length - 1]).s;

  /* ======================================================================
     Attacks. Each is a shape in arena space with a lifecycle:
        created -> [telegraph for `lead`s] -> fireAt -> [live for `live`s] -> gone
     `dangerous(now, px, py)` is only true during the live window.
     ====================================================================== */
  function wedge(created, cfg, angle, halfWidth) {
    const fireAt = created + cfg.lead, endAt = fireAt + cfg.live;
    return {
      kind: "wedge", created, fireAt, endAt, angle, halfWidth, danger: cfg.danger,
      done: (t) => t >= endAt,
      dangerous(t, px, py) {
        if (t < fireAt || t >= endAt) return false;
        const r = Math.hypot(px, py);
        if (r < BOSS_R * 0.7 || r > 1.02) return false;
        return angDiff(Math.atan2(py, px), angle) <= halfWidth;
      },
    };
  }
  function bullet(created, cfg, angle, speed, r) {
    return {
      kind: "bullet", created, danger: cfg.danger, r,
      pos(t) { const d = BOSS_R + (t - created) * speed; return [Math.cos(angle) * d, Math.sin(angle) * d]; },
      done(t) { return Math.hypot(...this.pos(t)) > 1.15; },
      dangerous(t, px, py) { const [bx, by] = this.pos(t); return Math.hypot(px - bx, py - by) < this.r + PLAYER_R; },
    };
  }

  /* the director: given the clock, decide what the boss throws next. */
  function makeDirector() {
    let nextAt = 1.2, phase = 0;
    return {
      step(t, spawn) {
        while (t >= nextAt) {
          const cfg = SECTION[sectionAt(nextAt)];
          spawnPattern(sectionAt(nextAt), cfg, nextAt, phase, spawn);
          phase++;
          nextAt += cfg.interval;
        }
      },
    };
  }
  function spawnPattern(section, cfg, at, phase, spawn) {
    const base = phase * 1.318;      // irrational-ish stride so slams don't line up
    if (section === "verse") {
      spawn(wedge(at, cfg, base, 0.26));
    } else if (section === "prechorus") {
      spawn(wedge(at, cfg, base, 0.24));
      spawn(wedge(at, cfg, base + Math.PI, 0.24));
    } else if (section === "chorus") {
      const n = 3;
      for (let i = 0; i < n; i++) spawn(wedge(at, cfg, base + (i / n) * TAU, 0.2));
      if (phase % 2 === 0) for (let i = 0; i < 8; i++) spawn(bullet(at + cfg.lead, cfg, (i / 8) * TAU - base, 0.85, 0.035));
    } else { // drop
      const n = 4;
      for (let i = 0; i < n; i++) spawn(wedge(at, cfg, base + (i / n) * TAU, 0.16));
      const b = 12;
      for (let i = 0; i < b; i++) spawn(bullet(at + cfg.lead * 0.7, cfg, (i / b) * TAU + base, 1.0, 0.032));
    }
  }

  /* ======================================================================
     Game
     ====================================================================== */
  const canvas = document.getElementById("arena");
  const ctx = canvas.getContext("2d");
  const ui = {
    time: document.getElementById("time"),
    bar: document.getElementById("bar"),
    hearts: document.getElementById("hearts"),
    badge: document.getElementById("badge"),
    coach: document.getElementById("coach"),
    overlay: document.getElementById("overlay"),
    oTitle: document.getElementById("o-title"),
    oText: document.getElementById("o-text"),
    oBtn: document.getElementById("o-btn"),
  };

  let W, H, cx, cy, R, dpr;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = W / 2; cy = H / 2; R = Math.min(W, H) * 0.46;
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  const toPx = (nx, ny) => [cx + nx * R, cy + ny * R];

  /* input */
  const keys = new Set();
  const MOVE = {
    KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
  };
  addEventListener("keydown", (e) => {
    if (e.code === "Space" || MOVE[e.code]) e.preventDefault();
    if (state.phase === "start" || state.phase === "over" || state.phase === "win") {
      if (e.code === "Space" || e.code === "Enter") { start(); return; }
    }
    if (e.code === "Space") tryDash();
    keys.add(e.code);
  });
  addEventListener("keyup", (e) => keys.delete(e.code));
  ui.oBtn.addEventListener("click", start);

  /* state */
  let state;
  function fresh() {
    return {
      phase: "start",           // start | play | over | win
      t0: 0, t: 0,
      px: 0, py: 0.6, vx: 0, vy: 0,
      facing: [0, -1],
      hearts: 3,
      dashUntil: 0, iframeUntil: 0, dashReadyAt: 0, dashDir: [0, -1],
      hurtFlash: 0,
      attacks: [],
      director: makeDirector(),
    };
  }
  state = fresh();

  function tryDash() {
    if (state.phase !== "play") return;
    if (state.t < state.dashReadyAt) return;
    let d = inputDir();
    if (d[0] === 0 && d[1] === 0) d = state.facing;
    state.dashDir = d;
    state.dashUntil = state.t + DASH_TIME;
    state.iframeUntil = state.t + DASH_IFRAMES;
    state.dashReadyAt = state.t + DASH_COOLDOWN;
  }
  function inputDir() {
    let x = 0, y = 0;
    for (const k of keys) if (MOVE[k]) { x += MOVE[k][0]; y += MOVE[k][1]; }
    const m = Math.hypot(x, y);
    return m ? [x / m, y / m] : [0, 0];
  }

  function start() {
    state = fresh();
    state.phase = "play";
    state.t0 = now();
    ui.overlay.classList.remove("show", "win");
    renderHearts();
    canvas.focus();
  }
  function endGame(win) {
    state.phase = win ? "win" : "over";
    ui.oTitle.textContent = win ? "You survived." : "The song got you.";
    ui.oText.innerHTML = win
      ? "You read the whole song. <b>That's your song now.</b>"
      : "Every play, you learn it a little better.";
    ui.oBtn.textContent = win ? "Play again" : "Try again";
    ui.overlay.classList.toggle("win", win);
    ui.overlay.classList.add("show");
  }

  /* ---------- update ---------- */
  function update(dt) {
    if (state.phase !== "play") return;
    state.t = now() - state.t0;
    if (state.t >= SONG_LEN) { state.t = SONG_LEN; return endGame(true); }

    // move
    const dashing = state.t < state.dashUntil;
    if (dashing) {
      state.vx = state.dashDir[0] * DASH_SPEED;
      state.vy = state.dashDir[1] * DASH_SPEED;
    } else {
      const d = inputDir();
      if (d[0] || d[1]) state.facing = d;
      state.vx = d[0] * PLAYER_SPEED;
      state.vy = d[1] * PLAYER_SPEED;
    }
    state.px += state.vx * dt;
    state.py += state.vy * dt;
    // keep inside the rim, and out of the boss's body
    const rr = Math.hypot(state.px, state.py);
    if (rr > 0.98) { state.px *= 0.98 / rr; state.py *= 0.98 / rr; }
    const boss = BOSS_R + PLAYER_R * 0.6;
    if (rr < boss && rr > 0) { state.px *= boss / rr; state.py *= boss / rr; }

    // spawn + expire attacks
    state.director.step(state.t, (a) => state.attacks.push(a));
    state.attacks = state.attacks.filter((a) => !a.done(state.t));

    // damage
    const invuln = state.t < state.iframeUntil;
    if (!invuln) {
      for (const a of state.attacks) {
        if (a.dangerous(state.t, state.px, state.py)) { hit(); break; }
      }
    }
    if (state.hurtFlash > 0) state.hurtFlash = Math.max(0, state.hurtFlash - dt);
  }
  function hit() {
    state.hearts--;
    state.iframeUntil = state.t + HIT_IFRAMES;
    state.hurtFlash = 0.5;
    renderHearts();
    if (state.hearts <= 0) endGame(false);
  }

  /* ---------- render ---------- */
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`; };

  function drawFloor() {
    const g = ctx.createRadialGradient(cx, cy - R * 0.2, R * 0.1, cx, cy, R * 1.15);
    g.addColorStop(0, "#fbf7ef"); g.addColorStop(0.7, "#f2ecdf"); g.addColorStop(1, "#e7dfcd");
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.12, 0, TAU); ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = "rgba(44,58,75,0.05)"; ctx.lineWidth = 1.5;
    for (let i = 1; i <= 3; i++) { ctx.beginPath(); ctx.arc(cx, cy, R * 0.32 * i, 0, TAU); ctx.stroke(); }
  }
  function drawAttacks(t) {
    for (const a of state.attacks) {
      if (a.kind === "wedge") {
        const live = t >= a.fireAt;
        if (!live) {
          // telegraph: a growing warning the player can read
          const p = clamp((t - a.created) / (a.fireAt - a.created), 0, 1);
          ctx.beginPath(); ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, R * 1.04, a.angle - a.halfWidth, a.angle + a.halfWidth);
          ctx.closePath();
          ctx.fillStyle = hexA(a.danger, 0.06 + 0.12 * p);
          ctx.fill();
          ctx.strokeStyle = hexA(a.danger, 0.3 + 0.5 * p); ctx.lineWidth = 2; ctx.stroke();
        } else {
          const k = 1 - (t - a.fireAt) / (a.endAt - a.fireAt);
          const grd = ctx.createRadialGradient(cx, cy, R * 0.18, cx, cy, R * 1.04);
          grd.addColorStop(0, hexA(a.danger, 0.55 * k)); grd.addColorStop(1, hexA(a.danger, 0.92 * k));
          ctx.beginPath(); ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, R * 1.04, a.angle - a.halfWidth, a.angle + a.halfWidth);
          ctx.closePath(); ctx.fillStyle = grd; ctx.fill();
        }
      } else if (a.kind === "bullet") {
        const [bx, by] = a.pos(t); const [x, y] = toPx(bx, by); const s = a.r * 2 * R;
        roundRect(x - s / 2, y - s / 2, s, s, s * 0.28); ctx.fillStyle = a.danger; ctx.fill();
      }
    }
  }
  function drawBoss(t) {
    const beat = t * 2, bob = Math.sin(beat * TAU) * 3, sq = 1 + 0.03 * Math.sin(beat * TAU);
    const r = R * BOSS_R, by = cy + bob;
    const halo = ctx.createRadialGradient(cx, by, r * 0.6, cx, by, r * 2.4);
    halo.addColorStop(0, "rgba(255,90,110,0.14)"); halo.addColorStop(1, "rgba(255,90,110,0)");
    ctx.beginPath(); ctx.arc(cx, by, r * 2.4, 0, TAU); ctx.fillStyle = halo; ctx.fill();
    ctx.save(); ctx.translate(cx, by); ctx.scale(sq, 2 - sq);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU);
    const bg = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.2, 0, 0, r);
    bg.addColorStop(0, "#ffe0e3"); bg.addColorStop(1, "#f4a6b0");
    ctx.fillStyle = bg; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = "rgba(44,58,75,0.12)"; ctx.stroke();
    ctx.restore();
    // face
    const ex = r * 0.34, ey = by - r * 0.05, er = r * 0.16;
    ctx.fillStyle = "#2c3a4b";
    ctx.beginPath(); ctx.arc(cx - ex, ey, er, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + ex, ey, er, 0, TAU); ctx.fill();
    ctx.lineWidth = r * 0.11; ctx.lineCap = "round"; ctx.strokeStyle = "#2c3a4b";
    ctx.beginPath(); ctx.moveTo(cx - ex - r*0.22, ey - er*1.4 + r*0.11); ctx.lineTo(cx - ex + r*0.22, ey - er*1.4 - r*0.11); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + ex - r*0.22, ey - er*1.4 - r*0.11); ctx.lineTo(cx + ex + r*0.22, ey - er*1.4 + r*0.11); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - r*0.18, by + r*0.34); ctx.quadraticCurveTo(cx, by + r*0.2, cx + r*0.18, by + r*0.34);
    ctx.lineWidth = r * 0.09; ctx.stroke();
  }
  function drawPlayer(t) {
    const [x, y] = toPx(state.px, state.py); const r = R * PLAYER_R;
    const invuln = t < state.iframeUntil;
    const dashing = t < state.dashUntil;
    if (invuln && !dashing && Math.floor(t * 12) % 2 === 0) return; // blink when hurt
    // dash trail
    if (dashing) for (let i = 1; i <= 5; i++) {
      const tx = x - state.dashDir[0] * r * i * 0.8, ty = y - state.dashDir[1] * r * i * 0.8;
      ctx.beginPath(); ctx.arc(tx, ty, r * (1 - i * 0.14), 0, TAU);
      ctx.fillStyle = hexA("#6ea8e8", 0.2 * (1 - i / 6)); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
    const g = ctx.createRadialGradient(x - r*0.3, y - r*0.35, r*0.2, x, y, r);
    g.addColorStop(0, "#a9cef2"); g.addColorStop(1, "#4a86d6"); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "rgba(44,58,75,0.15)"; ctx.stroke();
    ctx.fillStyle = "#22364d";
    ctx.beginPath(); ctx.arc(x - r*0.32, y - r*0.08, r*0.14, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + r*0.32, y - r*0.08, r*0.14, 0, TAU); ctx.fill();
  }

  function renderHUD(t) {
    const disp = state.phase === "start" ? 0 : Math.min(t, SONG_LEN);
    ui.time.textContent = fmt(disp) + " / " + fmt(SONG_LEN);
    ui.bar.style.width = (disp / SONG_LEN * 100) + "%";
    const sec = SECTION[sectionAt(disp)];
    ui.badge.textContent = sec.tag; ui.badge.className = "arena-badge tag " + sec.cls;
  }
  function renderHearts() {
    const h = [];
    for (let i = 0; i < 3; i++)
      h.push(`<svg class="heart${i < state.hearts ? "" : " heart--empty"}" viewBox="0 0 24 24"><use href="#i-heart"/></svg>`);
    ui.hearts.innerHTML = h.join("");
  }
  const fmt = (s) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");

  /* ---------- loop ---------- */
  let last = now();
  function frame() {
    const t = now(), dt = Math.min(0.05, t - last); last = t;
    update(dt);
    const clk = state.phase === "play" ? state.t : (state.phase === "start" ? 0 : state.t);
    ctx.clearRect(0, 0, W, H);
    drawFloor();
    if (state.phase === "play") { drawAttacks(state.t); }
    drawBoss(state.phase === "play" ? state.t : t);
    if (state.phase === "play") drawPlayer(state.t);
    if (state.hurtFlash > 0) { ctx.fillStyle = hexA("#ff5a6e", 0.22 * state.hurtFlash); ctx.fillRect(0, 0, W, H); }
    renderHUD(clk);
    requestAnimationFrame(frame);
  }
  renderHearts();
  requestAnimationFrame(frame);
})();
