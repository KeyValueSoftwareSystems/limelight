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
     { colour:[r,g,b] 0..1, level 0..1, dim 0..255, strobe 0..1, ... } */
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

  /* intent -> a channel slice of `footprint` values */
  function render(intent) {
    intent = intent || {};
    const f = base();
    const lvl = intent.level == null ? 1 : intent.level;

    if (intent.colour && has("colour.r")) {
      const s = brightness === "colour" ? lvl : 1;
      f[first("colour.r")] = clamp255(255 * intent.colour[0] * s);
      f[first("colour.g")] = clamp255(255 * intent.colour[1] * s);
      f[first("colour.b")] = clamp255(255 * intent.colour[2] * s);
    }
    /* a mechanical colour wheel: pick the slot nearest the wanted colour, or by
       name. The wheel is discrete, so this is a snap, not a mix. */
    if (has("colour_wheel") && profile.colour_wheel) {
      let slot = null;
      if (intent.colourName)
        slot = profile.colour_wheel.find(s => s.name === intent.colourName) || null;
      if (!slot && intent.colour) slot = nearestSlot(profile.colour_wheel, intent.colour);
      if (slot) f[first("colour_wheel")] = slot.value;
    }
    if (brightness === "master" && intent.level != null && has("master"))
      f[first("master")] = clamp255(255 * lvl);
    if (intent.dim != null && has("master")) f[first("master")] = clamp255(intent.dim);
    if (intent.strobe != null && has("strobe")) f[first("strobe")] = clamp255(255 * intent.strobe);
    if (intent.speed != null && has("speed")) f[first("speed")] = clamp255(255 * intent.speed);
    if (intent.pan != null && has("pan")) set16(f, "pan", "pan_fine", intent.pan);
    if (intent.tilt != null && has("tilt")) set16(f, "tilt", "tilt_fine", intent.tilt);

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
     device has no fine channel. */
  function set16(f, coarseRole, fineRole, n) {
    const nn = Math.max(0, Math.min(1, n));
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
  function park() { return render(profile.park || { level: 0 }); }

  return { can, footprint, profile, render, park };
}
if (typeof module !== "undefined" && module.exports) module.exports = { Driver };
