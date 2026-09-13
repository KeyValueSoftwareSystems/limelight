/* Boss AI: deterministic moveset driven entirely by the score protocol.
   Pure game logic — no rendering. The arena reads projectiles[] and state. */
(function () {
  "use strict";

  // MurmurHash3 finaliser — same one beat-saber uses so identical bars
  // produce identical moves, but the sequence looks random.
  function hash(bar, beat) {
    let h = (bar * 4 + beat) | 0;
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  // attack types
  const ATTACKS = ["sweep", "burst", "charge", "slam", "rain"];

  // section name -> boss phase
  function phaseFor(name) {
    if (!name) return "IDLE";
    const n = name.toLowerCase();
    if (n === "intro" || n === "outro")     return "IDLE";
    if (n === "breakdown" || n === "bridge") return "REST";
    if (n === "chorus")                     return "RAGE";
    if (n === "drop")                       return "RAGE";
    if (n === "pre-chorus" || n === "prechorus") return "BUILD";
    return "PATTERN";  // verse, etc.
  }

  // phase -> base attack interval (seconds between attacks)
  const PHASE_INTERVAL = {
    IDLE: 999, REST: 2.5, BUILD: 1.2, PATTERN: 1.0, RAGE: 0.6,
  };

  const PROJ_SPEED = 8;       // units/sec
  const PROJ_RADIUS = 0.3;
  const BOSS_RADIUS = 1.0;
  const CHARGE_SPEED = 10;

  function create(arenaRadius) {
    const b = {
      x: 0, y: arenaRadius * 0.4,
      radius: BOSS_RADIUS,
      hp: 1000, maxHp: 1000,
      phase: "IDLE",
      sectionName: null,
      projectiles: [],    // { x, y, vx, vy, radius, age }
      telegraphs: [],     // { type, x, y, radius, timer, maxTimer }
      attackTimer: 0,
      riseTimer: 0,       // wind-up from signals
      rising: false,
      paused: false,      // moment "pause" -> boss rests
      pauseTimer: 0,
      chargeTarget: null,
      charging: false,
      chargeTimer: 0,
      arenaRadius,
      // hook replay memory: bar -> attack index
      hookMemory: {},
      energyScale: 1,
      paceScale: 1,
    };

    // pick the attack for a given bar/beat, deterministic
    function attackAt(bar, beat) {
      // if this bar was a hook with again_of, reuse the same attack
      if (b.hookMemory[bar] !== undefined) {
        return ATTACKS[b.hookMemory[bar] % ATTACKS.length];
      }
      const h = hash(bar, beat);
      return ATTACKS[h % ATTACKS.length];
    }

    // spawn projectiles for an attack type
    function fireAttack(type, playerX, playerY) {
      const cx = b.x, cy = b.y;
      switch (type) {
        case "sweep": {
          // line of 5 projectiles sweeping left to right
          for (let i = -2; i <= 2; i++) {
            const angle = Math.atan2(playerY - cy, playerX - cx) + i * 0.25;
            b.projectiles.push({
              x: cx, y: cy,
              vx: Math.cos(angle) * PROJ_SPEED,
              vy: Math.sin(angle) * PROJ_SPEED,
              radius: PROJ_RADIUS, age: 0,
            });
          }
          break;
        }
        case "burst": {
          // radial 8-way burst
          for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            b.projectiles.push({
              x: cx, y: cy,
              vx: Math.cos(angle) * PROJ_SPEED * 0.8,
              vy: Math.sin(angle) * PROJ_SPEED * 0.8,
              radius: PROJ_RADIUS, age: 0,
            });
          }
          break;
        }
        case "charge": {
          // boss rushes toward player
          b.charging = true;
          b.chargeTimer = 0.4;
          const dx = playerX - cx, dy = playerY - cy;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          b.chargeTarget = { vx: (dx / d) * CHARGE_SPEED, vy: (dy / d) * CHARGE_SPEED };
          break;
        }
        case "slam": {
          // telegraph then area damage at boss position
          b.telegraphs.push({
            type: "slam", x: cx, y: cy,
            radius: 3.5, timer: 0.5, maxTimer: 0.5,
          });
          // delayed ring of projectiles
          setTimeout(() => {
            for (let i = 0; i < 12; i++) {
              const angle = (i / 12) * Math.PI * 2;
              b.projectiles.push({
                x: cx, y: cy,
                vx: Math.cos(angle) * PROJ_SPEED * 0.6,
                vy: Math.sin(angle) * PROJ_SPEED * 0.6,
                radius: PROJ_RADIUS * 1.3, age: 0,
              });
            }
          }, 500);
          break;
        }
        case "rain": {
          // projectiles from random positions above, aimed downward
          for (let i = 0; i < 6; i++) {
            const rx = (Math.random() - 0.5) * arenaRadius * 1.6;
            b.projectiles.push({
              x: rx, y: arenaRadius + 1,
              vx: 0, vy: -PROJ_SPEED * 0.7,
              radius: PROJ_RADIUS, age: 0,
            });
          }
          break;
        }
      }
    }

    function update(dt, now, upcoming, playerX, playerY) {
      if (!now) return;

      // update phase from sections
      const sections = now.sections || {};
      const form = sections.form;
      if (form && form.name) {
        b.sectionName = form.name;
        b.phase = phaseFor(form.name);
      }

      // energy scaling
      b.energyScale = (now.energy != null) ? Math.max(0.3, now.energy) : 1;

      // process upcoming events
      for (const ev of (upcoming || [])) {
        // moments
        if (ev.layer === "moment") {
          if (ev.name === "pause" || ev.what === "pause") {
            b.paused = true;
            b.pauseTimer = 1.5;
          }
          // hook with again_of -> store in memory
          if (ev.what === "hook" && ev.again_of != null) {
            b.hookMemory[ev.bar] = hash(ev.again_of, 1) % ATTACKS.length;
          }
        }
        // signals
        if (ev.what === "rise starts" || ev.name === "rise") {
          b.rising = true;
          b.riseTimer = (ev.for_beats || 8) * 0.15;
        }
      }

      // pause countdown
      if (b.paused) {
        b.pauseTimer -= dt;
        if (b.pauseTimer <= 0) b.paused = false;
      }

      // rise countdown
      if (b.rising) {
        b.riseTimer -= dt;
        if (b.riseTimer <= 0) b.rising = false;
      }

      // charge movement
      if (b.charging && b.chargeTarget) {
        b.chargeTimer -= dt;
        b.x += b.chargeTarget.vx * dt;
        b.y += b.chargeTarget.vy * dt;
        // clamp to arena
        const dist = Math.sqrt(b.x * b.x + b.y * b.y);
        if (dist > arenaRadius - BOSS_RADIUS) {
          b.x *= (arenaRadius - BOSS_RADIUS) / dist;
          b.y *= (arenaRadius - BOSS_RADIUS) / dist;
        }
        if (b.chargeTimer <= 0) {
          b.charging = false;
          b.chargeTarget = null;
        }
      }

      // gentle boss drift toward center-top area (home position)
      if (!b.charging) {
        const homeX = 0, homeY = arenaRadius * 0.35;
        const dx = homeX - b.x, dy = homeY - b.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 0.5) {
          b.x += (dx / d) * 1.5 * dt;
          b.y += (dy / d) * 1.5 * dt;
        }
      }

      // attack timer — fire on beat
      const interval = (PHASE_INTERVAL[b.phase] || 1.0) / b.energyScale;
      b.attackTimer -= dt;
      if (b.attackTimer <= 0 && !b.paused && b.phase !== "IDLE") {
        const bar = now.position ? now.position.bar : 1;
        const beat = now.position ? Math.floor(now.position.beat) : 1;
        const type = attackAt(bar, beat);
        fireAttack(type, playerX, playerY);
        b.attackTimer = interval;
      }

      // update projectiles
      for (let i = b.projectiles.length - 1; i >= 0; i--) {
        const p = b.projectiles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.age += dt;
        // remove if out of arena or too old
        const d = Math.sqrt(p.x * p.x + p.y * p.y);
        if (d > arenaRadius + 2 || p.age > 5) {
          b.projectiles.splice(i, 1);
        }
      }

      // update telegraphs
      for (let i = b.telegraphs.length - 1; i >= 0; i--) {
        b.telegraphs[i].timer -= dt;
        if (b.telegraphs[i].timer <= 0) b.telegraphs.splice(i, 1);
      }
    }

    function takeDamage(amount) {
      b.hp = Math.max(0, b.hp - amount);
    }

    function reset() {
      b.x = 0; b.y = arenaRadius * 0.4;
      b.hp = b.maxHp;
      b.phase = "IDLE"; b.sectionName = null;
      b.projectiles = []; b.telegraphs = [];
      b.attackTimer = 0; b.riseTimer = 0; b.rising = false;
      b.paused = false; b.pauseTimer = 0;
      b.charging = false; b.chargeTimer = 0; b.chargeTarget = null;
      b.hookMemory = {};
      b.energyScale = 1; b.paceScale = 1;
    }

    b.update = update;
    b.takeDamage = takeDamage;
    b.reset = reset;
    b.fireAttack = fireAttack;
    return b;
  }

  window.Boss = { create, ATTACKS, phaseFor };
})();
