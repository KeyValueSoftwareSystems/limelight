/* Stream frames to a real rig over sACN (E1.31).  OWNER: Alnas.

   node readers/lights/mvr/send_sacn.js                      # calibration sweep, multicast
   node readers/lights/mvr/send_sacn.js --host 127.0.0.1     # unicast to BlenderDMX on this box
   node readers/lights/mvr/send_sacn.js --print 30           # no network: print the universe at t=30
   node readers/lights/mvr/send_sacn.js --selftest           # loopback: prove a packet is well-formed

   This is the missing last mile. Everything upstream produces a normalised
   FRAME -- levels 0..1, colours 0..255, pan/tilt as a fraction. This maps a
   frame onto the DMX channels a REAL fixture declares (read from its GDTF by
   gen_mvr.py into out/<layout>.patch.json) and puts the bytes on the wire, so
   BlenderDMX -- or a physical rig on the same patch -- lights up.

   Node stdlib only: dgram + Buffer. No npm, no e131 package -- the E1.17/E1.31
   packet is built by hand below so there is nothing to install.

   Frames come from readers/lights/calibrate.js (the commissioning sweep), the
   same file the browser uses, so there is one writer of that logic. A show
   recipe swaps in here later; the transport does not change.
*/
const dgram = require("dgram");
const fs = require("fs");
const path = require("path");

const HERE = __dirname;
const REPO = path.resolve(HERE, "..", "..", "..");
const CAL = require(path.join(REPO, "readers/lights/calibrate.js"));

// ---- args ------------------------------------------------------------------
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const has = (name) => argv.includes(name);
const LAYOUT = opt("--layout", "club");
const HOST = opt("--host", null);              // unicast target; else multicast
const FPS = parseInt(opt("--fps", "40"), 10);
const PRINT_AT = has("--print") ? parseFloat(opt("--print", "30")) : null;
const SELFTEST = has("--selftest");
const SACN_PORT = 5568;

const layout = JSON.parse(fs.readFileSync(path.join(REPO, "readers/lights", LAYOUT, "layout.json")));
const patch = JSON.parse(fs.readFileSync(path.join(HERE, "out", `${LAYOUT}.patch.json`)));

// stable component id for this sender (any fixed 16 bytes)
const CID = Buffer.from([0x4c, 0x69, 0x6d, 0x65, 0x6c, 0x69, 0x67, 0x68,
                         0x74, 0x53, 0x41, 0x43, 0x4e, 0x00, 0x00, 0x01]);
const SOURCE_NAME = "Limelight sACN";

// ---- frame -> universe bytes ----------------------------------------------
// map one GDTF attribute name to a normalised 0..1 value from a frame fixture.
// returns null when the frame does not drive this attribute -> the sender then
// writes the GDTF idle default (e.g. a shutter's OPEN value), never a raw 0.
function attrValue(attr, fx) {
  const a = attr.toLowerCase();
  if (a === "dimmer" || a === "intensity") return fx.level == null ? 0 : fx.level;
  if (a.startsWith("coloradd_r") || a === "red")   return (fx.r ?? 0) / 255;
  if (a.startsWith("coloradd_g") || a === "green") return (fx.g ?? 0) / 255;
  if (a.startsWith("coloradd_b") || a === "blue")  return (fx.b ?? 0) / 255;
  if (a.startsWith("coloradd_w") || a === "white") return 0;   // frame carries no white yet
  if (a === "pan")  return fx.pan  ?? 0.5;
  if (a === "tilt") return fx.tilt ?? 0.5;
  // dedicated strobe fixtures (e.g. Atomic 3000): rate 0..25 Hz -> 0..1, duration mid when active
  if (a === "stroberate")     return fx.strobe > 0 ? Math.min(1, (fx.strobe || 0) / 25) : 0;
  if (a === "strobeduration") return fx.strobe > 0 ? 0.5 : 0;
  // Shutter1, Zoom, Color1, CTC, Control1, ... not driven by the frame -> use the
  // GDTF default. Critically that keeps a head's shutter OPEN (Closed=0 on the Aura).
  return null;
}

// resample a pixel list [[r,g,b], ...] down (or up) to n cells by averaging groups
function resample(pixels, n) {
  const out = [];
  const P = pixels.length;
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * P / n), b = Math.max(a + 1, Math.floor((i + 1) * P / n));
    let r = 0, g = 0, bl = 0, c = 0;
    for (let j = a; j < b && j < P; j++) { r += pixels[j][0]; g += pixels[j][1]; bl += pixels[j][2]; c++; }
    out.push(c ? [r / c, g / c, bl / c] : [0, 0, 0]);
  }
  return out;
}

// a pixel bar's channels repeat ColorAdd_R/G/B(/W) per cell; spread the frame's pixels across them
function writeStrip(p, fx, uni) {
  const cells = [];
  p.channels.forEach((attr, i) => {
    const a = attr.toLowerCase();
    if (a.startsWith("coloradd_r")) cells.push({});
    const cell = cells[cells.length - 1];
    if (!cell) return;
    if (a.startsWith("coloradd_r")) cell.r = i;
    else if (a.startsWith("coloradd_g")) cell.g = i;
    else if (a.startsWith("coloradd_b")) cell.b = i;
    else if (a.startsWith("coloradd_w")) cell.w = i;
  });
  const px = resample(fx.pixels || [], Math.max(1, cells.length));
  const put = (idx, val) => { if (idx == null) return; uni[p.address + p.offsets[idx][0] - 2] = Math.max(0, Math.min(255, Math.round(val))); };
  cells.forEach((cell, ci) => {
    const [r, g, b] = px[ci] || [0, 0, 0];
    put(cell.r, r); put(cell.g, g); put(cell.b, b); put(cell.w, 0);
  });
}

// build {universeId: Buffer(512)} for a given frame
function universesForFrame(frame) {
  const byId = {};
  for (const f of frame.fixtures) byId[f.id] = f;
  const out = {};
  for (const p of patch.fixtures) {
    const fx = byId[p.id];
    if (!fx) continue;
    const uni = out[p.universe] || (out[p.universe] = Buffer.alloc(512));
    if (Array.isArray(fx.pixels)) { writeStrip(p, fx, uni); continue; }   // pixel bar
    p.channels.forEach((attr, i) => {
      const offs = p.offsets[i];               // 1-based slots within the fixture
      const raw = attrValue(attr, fx);
      if (raw == null) {                        // frame doesn't drive it -> GDTF idle default
        uni[p.address + offs[0] - 2] = (p.defaults ? p.defaults[i] : 0) & 0xff;
        return;
      }
      const v = Math.max(0, Math.min(1, raw));
      if (offs.length >= 2) {                   // 16-bit: coarse, fine
        const w = Math.round(v * 65535);
        uni[p.address + offs[0] - 2] = (w >> 8) & 0xff;
        uni[p.address + offs[1] - 2] = w & 0xff;
      } else {
        uni[p.address + offs[0] - 2] = Math.round(v * 255);
      }
    });
  }
  return out;
}

// ---- E1.31 packet ----------------------------------------------------------
function e131Packet(universe, seq, dmx512) {
  const pkt = Buffer.alloc(638);
  let o = 0;
  // Root layer
  pkt.writeUInt16BE(0x0010, o); o += 2;                 // preamble size
  pkt.writeUInt16BE(0x0000, o); o += 2;                 // postamble size
  Buffer.from("ASC-E1.17\0\0\0", "latin1").copy(pkt, o); o += 12;
  pkt.writeUInt16BE(0x7000 | (638 - 16), o); o += 2;    // flags+length
  pkt.writeUInt32BE(0x00000004, o); o += 4;             // vector: root data
  CID.copy(pkt, o); o += 16;
  // Framing layer
  pkt.writeUInt16BE(0x7000 | (638 - 38), o); o += 2;    // flags+length
  pkt.writeUInt32BE(0x00000002, o); o += 4;             // vector: data packet
  Buffer.from(SOURCE_NAME, "utf8").copy(pkt, o); o += 64;
  pkt.writeUInt8(100, o); o += 1;                        // priority
  pkt.writeUInt16BE(0x0000, o); o += 2;                  // sync address
  pkt.writeUInt8(seq & 0xff, o); o += 1;                 // sequence
  pkt.writeUInt8(0x00, o); o += 1;                        // options
  pkt.writeUInt16BE(universe, o); o += 2;               // universe
  // DMP layer
  pkt.writeUInt16BE(0x7000 | (638 - 115), o); o += 2;   // flags+length
  pkt.writeUInt8(0x02, o); o += 1;                       // vector: set property
  pkt.writeUInt8(0xa1, o); o += 1;                       // address+data type
  pkt.writeUInt16BE(0x0000, o); o += 2;                  // first property addr
  pkt.writeUInt16BE(0x0001, o); o += 2;                  // address increment
  pkt.writeUInt16BE(513, o); o += 2;                     // property value count
  pkt.writeUInt8(0x00, o); o += 1;                       // DMX start code
  dmx512.copy(pkt, o); o += 512;
  return pkt;
}

function multicastAddr(universe) {
  return `239.255.${(universe >> 8) & 0xff}.${universe & 0xff}`;
}

// ---- modes -----------------------------------------------------------------
function printFrame(t) {
  const frame = CAL.calFrame(t, layout);
  const unis = universesForFrame(frame);
  console.log(`t=${t}  look=${frame.look}`);
  for (const p of patch.fixtures.slice(0, 4)) {
    const u = unis[p.universe];
    const slots = p.channels.map((c, i) => `${c}=${u[p.address + p.offsets[i][0] - 2]}`);
    console.log(`  ${p.id} u${p.universe}@${p.address}: ${slots.join("  ")}`);
  }
}

function selftest() {
  // build a packet, send to loopback, receive it, assert header + a known byte
  const rx = dgram.createSocket({ type: "udp4", reuseAddr: true });
  rx.bind(SACN_PORT, "127.0.0.1", () => {
    const dmx = Buffer.alloc(512); dmx[0] = 200;            // channel 1 = 200
    const pkt = e131Packet(1, 7, dmx);
    const tx = dgram.createSocket("udp4");
    tx.send(pkt, SACN_PORT, "127.0.0.1", () => tx.close());
  });
  rx.on("message", (msg) => {
    const okId = msg.slice(4, 16).toString("latin1") === "ASC-E1.17\0\0\0";
    const okLen = msg.length === 638;
    const okUni = msg.readUInt16BE(113) === 1;
    const okSeq = msg[111] === 7;
    const okStart = msg[125] === 0x00;
    const okData = msg[126] === 200;
    console.log("sACN loopback self-test:");
    console.log(`  length 638             : ${okLen}`);
    console.log(`  ACN packet id          : ${okId}`);
    console.log(`  universe field == 1    : ${okUni}`);
    console.log(`  sequence field == 7    : ${okSeq}`);
    console.log(`  DMX start code == 0    : ${okStart}`);
    console.log(`  channel 1 == 200       : ${okData}`);
    const pass = okId && okLen && okUni && okSeq && okStart && okData;
    console.log(pass ? "PASS" : "FAIL");
    rx.close();
    process.exit(pass ? 0 : 1);
  });
}

function stream() {
  const sock = dgram.createSocket("udp4");
  const seq = {};
  const start = Date.now();
  const unis = sorted(patch.fixtures.map(f => f.universe));
  const dest = HOST || null;
  if (!dest) { sock.bind(() => sock.setBroadcast(true)); }
  console.log(`streaming ${LAYOUT} at ${FPS} fps to ` +
              (dest ? `${dest} (unicast)` : `multicast ${unis.map(multicastAddr).join(", ")}`) +
              `  [universes ${unis.join(",")}]  Ctrl-C to stop`);
  const send = () => {
    const t = ((Date.now() - start) / 1000) % CAL.CAL_DUR;
    const frame = CAL.calFrame(t, layout);
    const built = universesForFrame(frame);
    for (const u of unis) {
      const dmx = built[u] || Buffer.alloc(512);
      seq[u] = ((seq[u] || 0) + 1) & 0xff;
      const pkt = e131Packet(u, seq[u], dmx);
      sock.send(pkt, SACN_PORT, dest || multicastAddr(u));
    }
  };
  setInterval(send, Math.round(1000 / FPS));
}

function sorted(a) { return [...new Set(a)].sort((x, y) => x - y); }

// ---- go --------------------------------------------------------------------
if (SELFTEST) selftest();
else if (PRINT_AT != null) { [0, 3.5, 33, PRINT_AT].forEach(printFrame); }
else stream();
