/* The calibration run.  OWNER: Alnas, with Nikitha.

   Dolby ships a trailer before the film that sweeps every speaker in turn. It
   is not music: it is designed content that exercises every capability in a
   known order, so a room can be commissioned rather than hoped about. This is
   that, for a light rig.

   It is NOT a map, and the distinction matters. A map says what the MUSIC does
   and the recipe decides what the lights do -- useless when you need to command
   "head 1, pan to exactly zero". So this is a frame sequence written by hand.
   Everything downstream of the frame is identical to a real show: same layout,
   same wire(), same universe. You are testing the path you will actually use.

   Each step declares what you SHOULD see. That is what turns watching into
   measuring: if step 4 says every par ramps smoothly from off to full over eight
   seconds and you see eleven visible steps, the rig has 8-bit dimming and the
   recipe needs to know. If a layout claims 0.85 range/s of pan and the head
   takes twice as long as step 3 predicts, the layout is lying and every show
   built on it is over-driving that motor.
*/
const CAL_STEPS = [
  { t: 0,  d: 2,  id: "dark",    say: "Blackout. Nothing should be lit at all.",
    check: "Any light still on here is a stuck channel or a fixture in manual mode." },
  { t: 2,  d: 12, id: "each",    say: "Each fixture alone, full white, in patch order.",
    check: "Name each one out loud as it lights. A fixture that lights out of order is patched to the wrong address, and one that never lights is not patched at all." },
  { t: 14, d: 4,  id: "pan",     say: "Every moving head pans left to right and back.",
    check: "All heads should sweep the same way. One going the other way has inverted pan. Time the sweep: the layout claims a maximum speed and this step is built to just reach it." },
  { t: 18, d: 4,  id: "tilt",    say: "Every moving head tilts down to up and back.",
    check: "Where does the beam point at the middle of the sweep? That is what tilt 0.5 means in this room, and the recipe assumes it is roughly the dance floor." },
  { t: 22, d: 8,  id: "ramp",    say: "Slow ramp from off to full on every dimmable fixture, over eight seconds.",
    check: "Count visible steps. A smooth fade means fine dimming. Visible stepping means 8-bit, and a slow fade in a real show will stutter the same way." },
  { t: 30, d: 6,  id: "colour",  say: "Red, then green, then blue, then white, on everything that has colour.",
    check: "Reds should match across fixtures of the same type. They usually do not, and that difference is worth writing into the layout." },
  { t: 36, d: 6,  id: "strobe",  say: "Strobe from 1 Hz up to the layout's declared cap.",
    check: "It should never exceed the cap in layout.limits.max_strobe_hz. Stop immediately if anyone in the room is uncomfortable." },
  { t: 42, d: 4,  id: "full",    say: "Everything at full, white, together.",
    check: "This is peak power draw. Watch for a fixture dropping out, a breaker, or the whole rig dimming as supply sags." },
  { t: 46, d: 6,  id: "sync",    say: "Every fixture flashes on the whole second, six times.",
    check: "Film it with a phone at 60fps against a stopwatch. The gap between the frame time and the light appearing is the true lag, and lag_ms in wiring.json should be set from this rather than guessed." },
  { t: 52, d: 2,  id: "dark2",   say: "Blackout again.",
    check: "Anything still lit did not receive the last frame. That is a dropped packet, not a dimmer." },
];
const CAL_DUR = 54;

function calStep(t) {
  let cur = CAL_STEPS[0];
  for (const s of CAL_STEPS) if (t >= s.t) cur = s;
  return cur;
}

function calFrame(t, layout) {
  const s = calStep(t), u = Math.max(0, Math.min(1, (t - s.t) / s.d));
  const fx = layout.fixtures || [];
  const lim = layout.limits || {};
  const out = [];
  const dimmable = fx.filter(f => (f.can || []).includes("level"));
  for (const f of fx) {
    const can = f.can || [];
    const o = { id: f.id };
    const colour = can.includes("colour");
    let lv = 0, r = 255, g = 255, b = 255;
    if (s.id === "each") {
      const i = dimmable.indexOf(f);
      const slot = s.d / Math.max(1, dimmable.length);
      lv = (i >= 0 && t - s.t >= i * slot && t - s.t < (i + 1) * slot) ? 1 : 0;
    } else if (s.id === "pan" || s.id === "tilt") {
      lv = can.includes("move") ? 0.85 : 0.06;
    } else if (s.id === "ramp") {
      lv = u;
    } else if (s.id === "colour") {
      const k = Math.min(3, Math.floor(u * 4));
      lv = 0.9;
      [r, g, b] = [[255,0,0],[0,255,0],[0,0,255],[255,255,255]][k];
    } else if (s.id === "strobe") {
      lv = can.includes("strobe") ? 1 : 0.10;
    } else if (s.id === "full") {
      lv = 1;
    } else if (s.id === "sync") {
      lv = (t % 1) < 0.12 ? 1 : 0;
    }
    if (f.kind === "strip") {
      const n = f.pixels || 24, px = [];
      for (let i = 0; i < n; i++) {
        const on = s.id === "each" ? (dimmable.indexOf(f) >= 0) : lv > 0.02;
        px.push(on ? [r * lv | 0, g * lv | 0, b * lv | 0] : [0, 0, 0]);
      }
      o.pixels = px; out.push(o); continue;
    }
    o.level = +lv.toFixed(4);
    if (colour && lv > 0) { o.r = r; o.g = g; o.b = b; }
    else if (colour) { o.r = 0; o.g = 0; o.b = 0; }
    if (can.includes("move")) {
      // built to just reach the declared budget, so a rig slower than its layout
      // claims shows up as a sweep that lags this one
      o.pan  = s.id === "pan"  ? 0.5 + 0.5 * Math.sin(2 * Math.PI * (t - s.t) / s.d) : 0.5;
      o.tilt = s.id === "tilt" ? 0.5 + 0.5 * Math.sin(2 * Math.PI * (t - s.t) / s.d) : 0.55;
    }
    if (can.includes("strobe")) {
      o.strobe = s.id === "strobe" ? +(1 + u * ((lim.max_strobe_hz || 4) - 1)).toFixed(2) : 0;
    }
    out.push(o);
  }
  return { t: +t.toFixed(3), look: "calibrate:" + s.id, fixtures: out };
}

if (typeof module !== "undefined") module.exports = { calFrame, calStep, CAL_STEPS, CAL_DUR };
