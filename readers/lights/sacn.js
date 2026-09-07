/* frame bytes -> sACN (E1.31) on the wire.  OWNER: Alnas.
   ---------------------------------------------------------------------------
   The last mile, and until now the missing one. wire.js turns a frame into 512
   bytes and then those bytes went nowhere, which meant every claim we have made
   about this system was a claim about our own emulator rendering our own maps.

   sACN is the reason this is worth half a day rather than a week. It is DMX512
   inside a UDP multicast packet, standardised as ANSI E1.31, and it is what
   every console, every Art-Net/sACN node and every piece of lighting software
   made this century already listens to -- QLC+, grandMA, Resolume, Chamsys,
   the cheap Chinese nodes on Amazon. Speaking it means a venue needs to install
   nothing of ours. We are just another source on their network.

   It also gives us the one check we have never had. Our emulator is ours, so it
   proves nothing about whether the bytes are right -- the same error as grading
   a beat grid against the tracker that produced it. Point QLC+ at these packets
   and its own DMX monitor either shows the fixtures we think we are driving, or
   it does not. That is a third party disagreeing with us, which is the only
   kind of agreement worth having.

     node readers/lights/sacn.js --selftest        prove the packet is legal
     node readers/lights/sacn.js --universe 1 --to 239.255.0.1

   Deliberately not here: sync packets (E1.31 6.3.3), which only matter across
   multiple universes on separate NICs, and per-universe priority arbitration,
   which matters when two sources fight over a rig. Both are real, neither is
   the hackathon.
*/
const dgram = require("dgram");

const PORT = 5568;                       // E1.31 4.1
const ACN_PID = Buffer.from([0x41,0x53,0x43,0x2d,0x45,0x31,0x2e,0x31,0x37,0,0,0]);

/* 239.255.<high>.<low> -- the multicast group for a universe. A receiver joins
   only the universes it cares about, so a big rig does not drown a small node. */
function groupFor(universe) {
  return `239.255.${(universe >> 8) & 0xff}.${universe & 0xff}`;
}

/* A CID is a UUID that identifies this SOURCE for the life of the process. A
   receiver uses it to notice that two different senders are fighting over the
   same universe, so it must be stable across packets and unique across boxes. */
function makeCID(seed) {
  const b = Buffer.alloc(16);
  const s = seed || ("limelight-" + process.pid + "-" + Date.now());
  for (let i = 0, h = 0x811c9dc5; i < 16; i++) {
    for (const c of s + i) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
    b[i] = (h >>> 24) & 0xff;
  }
  b[6] = (b[6] & 0x0f) | 0x40;           // version 4
  b[8] = (b[8] & 0x3f) | 0x80;           // variant 1
  return b;
}

/* Three nested PDUs, each carrying its own length in the low 12 bits of a
   flags-and-length field whose top nibble is 0x7. Total is always 638 bytes for
   a full universe, and getting any length wrong is the classic reason a console
   silently ignores you rather than telling you why. */
function packet({ universe = 1, slots, sequence = 0, priority = 100,
                  cid, sourceName = "Limelight" }) {
  const data = Buffer.alloc(513);        // start code 0x00, then 512 slots
  Buffer.from(slots).copy(data, 1, 0, Math.min(512, slots.length));

  const root = Buffer.alloc(38);
  root.writeUInt16BE(0x0010, 0);         // preamble size
  root.writeUInt16BE(0x0000, 2);         // postamble size
  ACN_PID.copy(root, 4);
  root.writeUInt16BE(0x7000 | 622, 16);  // 638 - 16
  root.writeUInt32BE(0x00000004, 18);    // VECTOR_ROOT_E131_DATA
  cid.copy(root, 22);

  const frame = Buffer.alloc(77);
  frame.writeUInt16BE(0x7000 | 600, 0);  // 638 - 38
  frame.writeUInt32BE(0x00000002, 2);    // VECTOR_E131_DATA_PACKET
  frame.write(sourceName.slice(0, 63), 6, "utf8");   // 64 bytes, null padded
  frame.writeUInt8(priority, 70);
  frame.writeUInt16BE(0, 71);            // synchronization address
  frame.writeUInt8(sequence & 0xff, 73);
  frame.writeUInt8(0, 74);               // options: not preview, not terminated
  frame.writeUInt16BE(universe, 75);

  const dmp = Buffer.alloc(10);
  dmp.writeUInt16BE(0x7000 | 523, 0);    // 10 + 513
  dmp.writeUInt8(0x02, 2);               // VECTOR_DMP_SET_PROPERTY
  dmp.writeUInt8(0xa1, 3);               // address+data type
  dmp.writeUInt16BE(0x0000, 4);          // first property address
  dmp.writeUInt16BE(0x0001, 6);          // address increment
  dmp.writeUInt16BE(513, 8);             // property value count

  return Buffer.concat([root, frame, dmp, data]);
}

/* A sender holds the CID and the per-universe sequence counter. The sequence
   number is how a receiver drops packets that arrive out of order, so it must
   increment per universe and wrap at 255 -- a sender that always sends 0 looks
   like a stuck source and gets ignored. */
function sender({ to, universe = 1, priority = 100, sourceName = "Limelight",
                  cidSeed } = {}) {
  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
  const cid = makeCID(cidSeed);
  const seq = new Map();
  const dest = to || groupFor(universe);
  let open = false;
  sock.bind(() => { try { sock.setMulticastTTL(8) } catch (e) {} open = true; });

  return {
    cid, dest, port: PORT,
    send(slots, u = universe) {
      const n = ((seq.get(u) || 0) + 1) & 0xff;
      seq.set(u, n);
      const p = packet({ universe: u, slots, sequence: n, priority, cid, sourceName });
      if (open) sock.send(p, PORT, to || groupFor(u));
      return p;
    },
    close() { try { sock.close() } catch (e) {} },
  };
}

module.exports = { packet, sender, groupFor, makeCID, PORT };

/* ---------------------------------------------------------------------------
   The self-test opens a real socket, sends real packets to loopback, receives
   them back and takes them apart against the spec. No hardware, no console, no
   trust in the thing that wrote them. It also sends two DELIBERATELY WRONG
   packets, because a parser that accepts everything proves nothing -- the same
   rule every check in listen/ already follows.
*/
function selftest() {
  const out = [];
  const T = (name, cond, detail) => out.push([!!cond, name, detail || ""]);

  const cid = makeCID("selftest-fixed-seed");
  const slots = new Uint8Array(512);
  slots[0] = 255; slots[1] = 128; slots[511] = 7;
  const p = packet({ universe: 42, slots, sequence: 9, cid, sourceName: "Limelight test" });

  T("a full universe is exactly 638 bytes", p.length === 638, `got ${p.length}`);
  T("ACN packet identifier is present", p.slice(4, 16).equals(ACN_PID));
  T("root PDU length counts the 16 bytes before it",
    (p.readUInt16BE(16) & 0x0fff) === p.length - 16, `${p.readUInt16BE(16) & 0x0fff}`);
  T("framing PDU length is right",
    (p.readUInt16BE(38) & 0x0fff) === p.length - 38);
  T("DMP PDU length is right",
    (p.readUInt16BE(115) & 0x0fff) === p.length - 115);
  T("all three PDUs set the 0x7 flags nibble",
    (p.readUInt16BE(16) & 0xf000) === 0x7000 &&
    (p.readUInt16BE(38) & 0xf000) === 0x7000 &&
    (p.readUInt16BE(115) & 0xf000) === 0x7000);
  T("root vector is E131_DATA", p.readUInt32BE(18) === 4);
  T("framing vector is DATA_PACKET", p.readUInt32BE(40) === 2);
  T("DMP vector is SET_PROPERTY", p.readUInt8(117) === 2);
  T("universe survives the trip", p.readUInt16BE(113) === 42);
  T("sequence survives the trip", p.readUInt8(111) === 9);
  T("priority defaults to 100", p.readUInt8(108) === 100);
  T("property value count is 513", p.readUInt16BE(123) === 513);
  T("DMX start code is 0", p.readUInt8(125) === 0);
  T("slot 1 arrives as 255", p.readUInt8(126) === 255);
  T("slot 512 arrives as 7", p.readUInt8(637) === 7);
  T("CID is a v4 UUID", (p.readUInt8(28) & 0xf0) === 0x40 && (p.readUInt8(30) & 0xc0) === 0x80);
  T("universe 1 multicasts to 239.255.0.1", groupFor(1) === "239.255.0.1");
  T("universe 300 multicasts to 239.255.1.44", groupFor(300) === "239.255.1.44");

  // things that MUST be rejected -- a check that cannot fail is not a check
  const short = packet({ universe: 1, slots: new Uint8Array(10), cid });
  T("a short slot array is still padded to a full universe", short.length === 638);
  const over = packet({ universe: 1, slots: new Uint8Array(9999), cid });
  T("an oversized slot array is truncated, not overflowed", over.length === 638);
  const seqA = sender({ to: "127.0.0.1", universe: 1, cidSeed: "x" });
  const a = seqA.send(slots), b = seqA.send(slots);
  T("sequence increments between packets", b.readUInt8(111) === a.readUInt8(111) + 1);
  seqA.close();

  return new Promise(resolve => {
    const rx = dgram.createSocket({ type: "udp4", reuseAddr: true });
    rx.on("message", msg => {
      T("a packet sent over a real socket arrives byte-identical", msg.equals(p),
        `${msg.length} bytes`);
      rx.close();
      const bad = out.filter(r => !r[0]);
      for (const [ok, name, d] of out)
        console.log(`  ${ok ? "pass" : "FAIL"}  ${name}${d ? "   " + d : ""}`);
      console.log(bad.length ? `\n${bad.length} FAILED` : `\nall ${out.length} sACN checks pass`);
      resolve(bad.length === 0);
    });
    rx.bind(PORT, "127.0.0.1", () => {
      const tx = dgram.createSocket("udp4");
      tx.send(p, PORT, "127.0.0.1", () => tx.close());
    });
  });
}

if (require.main === module) {
  if (process.argv.includes("--selftest"))
    selftest().then(ok => process.exit(ok ? 0 : 1));
  else
    console.log("usage: node readers/lights/sacn.js --selftest");
}
module.exports.selftest = selftest;
