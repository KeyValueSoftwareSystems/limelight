"use strict";
/* A device driver turns a profile (what each channel does) into semantic intents
   -- setColour/setLevel/setStrobe/setPan/Tilt/... -- so that sequences and the
   frame are written against capabilities, never raw channel numbers. One driver
   per device type; the channel truth lives here and nowhere else.

   A profile:
     { type, footprint, can:[...], brightness:"colour"|"master",
       channels:[ {role, default} ],   // role e.g. master, colour.r/g/b, strobe,
                                        //   pan, pan_fine, tilt, tilt_fine, speed,
                                        //   colour_wheel, gobo, prism, keep_zero
       strobe:{max_hz}, ... }

   An intent (device-agnostic, all fields optional):
     { colour:[r,g,b] 0..1, level 0..1, dim 0..255, strobe 0..1, ... }

   ---------------------------------------------------------------------------
   The GDTF fixtures under mvr/gdtf/ need four things the two rig.py profiles
   never did, so the roles below are additive -- a profile that does not declare
   them behaves exactly as before:

     colour.w            a fourth emitter on an RGBW device. `white` says how to
                         drive it: "min" (the achromatic part of the colour, the
                         usual LED-par behaviour) or "off".
     colour.c/.m/.y      a SUBTRACTIVE mixing head: the flags take colour away
                         from a white lamp, so c = 1 - r. Brightness is the
                         master, never the flags.
     zoom/frost/iris/focus   plain 0..1 continuous intents.
     strobe + strobe_range   one channel that is shutter AND strobe, the way most
                         real heads wire it: {open, lo, hi} means 0 -> `open`
                         (shutter simply open) and >0 -> lo..hi. Without a
                         strobe_range the channel stays linear 0..255. */
/* The shared colour NAMES. A head gesture names a wheel slot -- "pink" -- because
   that is all a mechanical wheel can do, and a device with a wheel snaps to it.
   A device that MIXES has no wheel to snap to, so it needs the name's rgb. These
   are head13's eight slots, which is where the vocabulary got the names.
   Without this an RGB device handed a name computed 255 * "pink"[0] and wrote NaN
   into the frame -- latent for as long as the only mixing device was a par, which
   is never sent one. A profile may override with its own `colour_names`. */
const COLOUR_NAMES = {
  white: [1, 1, 1], red: [1, 0, 0], yellow: [1, 0.85, 0], blue: [0, 0, 1],
  green: [0, 1, 0], pink: [1, 0, 0.55], orange: [1, 0.3, 0], "light blue": [0, 0.6, 1],
};

function Driver(profile) {
  const chans = profile.channels || [];
  const footprint = profile.footprint;
  const can = (profile.can || []).slice();

  const idx = {};
  chans.forEach((c, i) => { (idx[c.role] = idx[c.role] || []).push(i); });
  const first = role => (idx[role] || [])[0];
  const has = role => first(role) != null;

  const brightness = profile.brightness || (has("colour.r") ? "colour" : "master");
  const clamp255 = v => Math.max(0, Math.min(255, Math.round(v)));
  const nearestSlot = (wheel, rgb) => wheel.reduce((best, s) => {
    const d = (s.rgb[0] - rgb[0]) ** 2 + (s.rgb[1] - rgb[1]) ** 2 + (s.rgb[2] - rgb[2]) ** 2;
    return best == null || d < best.d ? { s, d } : best;
  }, null).s;
  const base = () => chans.map(c => (c.default == null ? 0 : c.default));
  const lockZeros = f => { (idx.keep_zero || []).forEach(i => { f[i] = 0; }); return f; };

  /* the stage's AIM in DMX, when the profile declares one. Three anchors
     [lo, centre, hi] per axis map 0 -> lo, 0.5 -> centre, 1 -> hi piecewise, so a
     gesture's "forward" (0.5) is the wall while 0 and 1 still reach the ends of the
     head's full travel; two anchors [lo, hi] are a plain window. On this rig tilt 127
     is straight up, so without an aim 0.5 over the whole travel is the ceiling.
     Park is a device pose and bypasses it. */
  const aim = profile.aim || null;

  /* intent -> a channel slice of `footprint` values; opts.raw skips the aim window */
  function render(intent, opts) {
    intent = intent || {};
    const win = (opts && opts.raw) ? null : aim;
    const f = base();
    const lvl = intent.level == null ? 1 : intent.level;

    /* a mixing device resolves a NAMED colour to its rgb; a wheel device leaves the
       name alone and snaps to the slot below. */
    const names = profile.colour_names || COLOUR_NAMES;
    const rgb = typeof intent.colour === "string"
      ? (names[intent.colour] || null)
      : (Array.isArray(intent.colour) ? intent.colour : null);

    if (rgb && has("colour.r")) {
      const s = brightness === "colour" ? lvl : 1;
      f[first("colour.r")] = clamp255(255 * rgb[0] * s);
      f[first("colour.g")] = clamp255(255 * rgb[1] * s);
      f[first("colour.b")] = clamp255(255 * rgb[2] * s);
      /* RGBW: the white emitter carries the achromatic part of the colour. A
         saturated hue has none and leaves it dark; a pastel or an open white
         drives it hard, which is where these fixtures get their output. */
      if (has("colour.w"))
        f[first("colour.w")] = profile.white === "off" ? 0
          : clamp255(255 * Math.min(rgb[0], rgb[1], rgb[2]) * s);
    }
    /* a SUBTRACTIVE head: the flags remove colour from a white lamp, so full red
       is "take out green and blue". Brightness stays on the master -- driving the
       flags with level would wash the hue out instead of dimming it. */
    if (rgb && has("colour.c")) {
      f[first("colour.c")] = clamp255(255 * (1 - rgb[0]));
      f[first("colour.m")] = clamp255(255 * (1 - rgb[1]));
      f[first("colour.y")] = clamp255(255 * (1 - rgb[2]));
    }
    /* a mechanical colour wheel: pick the slot nearest the wanted colour, or by
       name. The wheel is discrete, so this is a snap, not a mix. */
    if (has("colour_wheel") && profile.colour_wheel) {
      let slot = null;
      /* a colour may arrive as a wheel-slot NAME (string, from head gestures) or as
         an rgb triple to snap to the nearest slot */
      const name = intent.colourName || (typeof intent.colour === "string" ? intent.colour : null);
      if (name) slot = profile.colour_wheel.find(s => s.name === name) || null;
      if (!slot && Array.isArray(intent.colour)) slot = nearestSlot(profile.colour_wheel, intent.colour);
      if (slot) f[first("colour_wheel")] = slot.value;
    }
    if (brightness === "master" && intent.level != null && has("master"))
      f[first("master")] = clamp255(255 * lvl);
    if (intent.dim != null && has("master")) f[first("master")] = clamp255(intent.dim);
    /* one channel doing shutter AND strobe, the way most real heads wire it:
       strobe 0 means "shutter open", not "channel 0" -- which on these fixtures
       is the shutter CLOSED and the lamp dark. */
    if (has("strobe")) {
      const sr = profile.strobe_range;
      if (sr) f[first("strobe")] = clamp255(!intent.strobe ? sr.open
                                            : sr.lo + intent.strobe * (sr.hi - sr.lo));
      else if (intent.strobe != null) f[first("strobe")] = clamp255(255 * intent.strobe);
    }
    if (intent.speed != null && has("speed")) f[first("speed")] = clamp255(255 * intent.speed);
    for (const role of ["zoom", "frost", "iris", "focus", "strobe_duration"])
      if (intent[role] != null && has(role)) f[first(role)] = clamp255(255 * intent[role]);
    if (intent.pan != null && has("pan")) set16(f, "pan", "pan_fine", intent.pan, win && win.pan);
    if (intent.tilt != null && has("tilt")) set16(f, "tilt", "tilt_fine", intent.tilt, win && win.tilt);

    if (intent.gobo != null && has("gobo")) {
      const g = (profile.gobo && typeof intent.gobo === "string") ? profile.gobo[intent.gobo] : intent.gobo;
      if (g != null) f[first("gobo")] = clamp255(g);
    }
    if (intent.prism != null && has("prism")) {
      const pr = intent.prism === true ? (profile.prism ? profile.prism.six : 255)
               : intent.prism === false ? (profile.prism ? profile.prism.off : 0)
               : intent.prism;
      f[first("prism")] = clamp255(pr);
    }
    /* a continuous colour-wheel spin overrides any slot chosen above */
    if (intent.spin && has("colour_wheel") && profile.spin_min != null)
      f[first("colour_wheel")] = clamp255(profile.spin_min);

    return lockZeros(f);
  }

  /* normalized 0..1 -> a 16-bit value split across coarse + fine, or 8-bit if the
     device has no fine channel. With a window [lo, hi] (DMX), 0..1 spans the window:
     the coarse channel is the whole DMX step, the fine one the remainder. */
  function set16(f, coarseRole, fineRole, n, window) {
    const nn = Math.max(0, Math.min(1, n));
    if (Array.isArray(window) && (window.length === 2 || window.length === 3)) {
      const raw = window.length === 3
        ? (nn <= 0.5 ? window[0] + (nn / 0.5) * (window[1] - window[0])
                     : window[1] + ((nn - 0.5) / 0.5) * (window[2] - window[1]))
        : window[0] + nn * (window[1] - window[0]);
      const dmx = Math.max(0, Math.min(255, raw));
      const coarse = Math.floor(dmx + 1e-9);
      f[first(coarseRole)] = coarse;
      if (has(fineRole)) f[first(fineRole)] = clamp255(255 * (dmx - coarse));
      return;
    }
    if (has(fineRole)) {
      const v = Math.round(nn * 65535);
      f[first(coarseRole)] = (v >> 8) & 255;
      f[first(fineRole)] = v & 255;
    } else {
      f[first(coarseRole)] = clamp255(255 * nn);
    }
  }

  /* the safe frame: the device's declared park intent (dimmer dark), full-footprint,
     locked channels zeroed. Never all-zero for a device with an on-by-default channel. */
  function park() { return render(profile.park || { level: 0 }, { raw: true }); }

  return { can, footprint, profile, render, park };
}
if (typeof module !== "undefined" && module.exports) module.exports = { Driver };
