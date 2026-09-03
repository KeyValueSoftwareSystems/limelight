/* wire(frame, wiring) -> bytes on a universe.  OWNER: Alnas.

   This is a deliberately naive reference, committed as a floor to beat -- the
   same way listen/baseline.py is. It is correct enough to see a universe move
   and wrong in ways real hardware will punish.

   The split that matters: a FRAME is normalised and knows nothing about
   hardware -- levels 0..1, colours 0..255, pan and tilt as a fraction of each
   fixture's own range. WIRING is the only place that knows about universes,
   addresses, channel order and physical lag. That is why the browser room and
   the real room load the same layout file and differ only here.

   Known to be wrong, and left for whoever owns this:
     - 8-bit only. Real heads want 16-bit pan and tilt or they visibly step.
     - lag_ms is recorded per fixture and ignored. Fog takes nine seconds to
       reach the room and a LED takes two milliseconds; sending both at t means
       the fog arrives late every time.
     - no dimmer curve. Hardware dimming is not linear in perceived brightness.
     - strobe rate is written raw, not mapped to a fixture's own rate table.
*/
const MODES = {
  "rgb+dim":  { n: 4, ch: ["r", "g", "b", "dim"] },
  "dim+rate": { n: 2, ch: ["dim", "rate"] },
  "1ch":      { n: 1, ch: ["dim"] },
  "head8":    { n: 8, ch: ["pan", "tilt", "dim", "r", "g", "b", "strobe", "zoom"] },
};

const b255 = v => Math.max(0, Math.min(255, Math.round(v)));

function wire(frame, wiring) {
  const out = {};
  for (const u of wiring.universes || [{ id: 1 }]) out[u.id] = new Uint8Array(512);
  const byId = {};
  for (const f of frame.fixtures) byId[f.id] = f;

  for (const p of wiring.fixtures || []) {
    const f = byId[p.id];
    if (!f) continue;
    if (p.mode === "pixels" || f.pixels) {
      const uni = out[p.universe] || (out[p.universe] = new Uint8Array(512));
      let a = (p.address || 1) - 1;
      for (const px of (f.pixels || [])) {
        if (a + 2 > 511) break;
        uni[a++] = b255(px[0]); uni[a++] = b255(px[1]); uni[a++] = b255(px[2]);
      }
      continue;
    }
    const m = MODES[p.mode];
    if (!m) continue;
    const uni = out[p.universe] || (out[p.universe] = new Uint8Array(512));
    const base = (p.address || 1) - 1;
    m.ch.forEach((name, i) => {
      const a = base + i;
      if (a > 511) return;
      let v = 0;
      if (name === "dim")    v = (f.level || 0) * 255;
      else if (name === "r") v = f.r !== undefined ? f.r : 255;
      else if (name === "g") v = f.g !== undefined ? f.g : 255;
      else if (name === "b") v = f.b !== undefined ? f.b : 255;
      else if (name === "pan")   v = (f.pan  !== undefined ? f.pan  : 0.5) * 255;
      else if (name === "tilt")  v = (f.tilt !== undefined ? f.tilt : 0.5) * 255;
      else if (name === "zoom")  v = (f.zoom !== undefined ? f.zoom : 0) * 255;
      else if (name === "rate" || name === "strobe") v = ((f.strobe || 0) / 25) * 255;
      uni[a] = b255(v);
    });
  }
  return out;
}

function channelOwners(wiring) {
  /* which fixture and which channel name owns each slot -- for the display */
  const own = {};
  for (const p of wiring.fixtures || []) {
    const m = MODES[p.mode];
    if (!m) continue;
    m.ch.forEach((name, i) => { own[`${p.universe}:${(p.address || 1) + i}`] = `${p.id}.${name}`; });
  }
  return own;
}

if (typeof module !== "undefined") module.exports = { wire, channelOwners, MODES };
