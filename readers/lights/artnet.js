/* frame bytes -> Art-Net on the wire.  OWNER: Alnas.
   ---------------------------------------------------------------------------
   sacn.js was written first because sACN is the better protocol and most kit
   made this century speaks it. Then we bought a node and the node is Art-Net.
   That is the whole reason this file exists: the network you have beats the
   protocol you prefer.

   Art-Net is a simpler packet than sACN -- an 18-byte header and up to 512 data
   bytes on UDP 6454, no nested PDUs, no CID, no priority arbitration. It is
   older and chattier (it broadcasts by default, which is why big rigs moved to
   sACN multicast) but for one node and two fixtures it is strictly less to get
   wrong.

   TWO THINGS THAT COST PEOPLE EVENINGS, both handled here:

   1. Art-Net universes are ZERO-based. sACN universe 1 is Art-Net universe 0.
      A node whose web page says "Universe 1" may mean either. `--discover`
      prints what the node actually reports, and you can try both.

   2. Broadcast vs unicast. Art-Net's default is broadcast, which works until
      it doesn't -- Wi-Fi access points and some switches drop it. Unicast
      straight at the node is more reliable, so `--to <ip>` is preferred and
      `--discover` is how you learn the ip.

     node readers/lights/artnet.js --selftest              prove the packet is legal
     node readers/lights/artnet.js --discover              find nodes on this network
     node readers/lights/artnet.js --ramp --to 2.0.0.10    fade channel 1 up and down
     node readers/lights/artnet.js --all 40 --to 2.0.0.10  hold every channel at 40

   Deliberately not here: ArtSync, ArtAddress (remote configuration of a node),
   ArtRdm. Real, none of them the hackathon.
*/
const dgram = require("dgram");

const PORT = 6454;                                   // Art-Net 4, all opcodes
const ID = Buffer.from("Art-Net\0", "ascii");        // 8 bytes including the null
const OP_DMX   = 0x5000;
const OP_POLL  = 0x2000;
const OP_REPLY = 0x2100;
const PROT_VER = 14;

/* A 15-bit Port-Address is Net(7) : Sub-Net(4) : Universe(4). Callers pass one
   number 0..32767 and it is split here, because every node's web page disagrees
   about how to present the three parts and the wire only cares about the sum. */
function splitAddress(portAddress) {
  const a = portAddress & 0x7fff;
  return { subUni: a & 0xff, net: (a >> 8) & 0x7f };
}

/* sACN counts universes from 1, Art-Net from 0. Anything in this repo that
   says "universe 1" means the sACN sense, so convert at the boundary. */
const fromSacn = u => Math.max(0, (u | 0) - 1);

function packet({ universe = 0, slots, sequence = 0, physical = 0 }) {
  const src = slots || new Uint8Array(512);
  /* Length must be even and 2..512. An odd length is legal in the spec's letter
     and rejected in practice by enough nodes that it is not worth the risk. */
  let n = Math.min(512, src.length);
  if (n < 2) n = 2;
  if (n & 1) n += 1;
  const buf = Buffer.alloc(18 + n);
  ID.copy(buf, 0);
  buf.writeUInt16LE(OP_DMX, 8);                      // opcodes are little-endian
  buf[10] = (PROT_VER >> 8) & 0xff;                  // ... and ProtVer is not
  buf[11] = PROT_VER & 0xff;
  buf[12] = sequence & 0xff;
  buf[13] = physical & 0xff;
  const { subUni, net } = splitAddress(universe);
  buf[14] = subUni;
  buf[15] = net;
  buf.writeUInt16BE(n, 16);
  for (let i = 0; i < n && i < src.length; i++) buf[18 + i] = src[i] & 0xff;
  return buf;
}

function pollPacket({ talkToMe = 0 } = {}) {
  const buf = Buffer.alloc(14);
  ID.copy(buf, 0);
  buf.writeUInt16LE(OP_POLL, 8);
  buf[10] = 0; buf[11] = PROT_VER;
  buf[12] = talkToMe & 0xff;
  buf[13] = 0;                                       // diagnostics priority
  return buf;
}

function parseReply(buf, rinfo) {
  if (buf.length < 26 || !buf.slice(0, 8).equals(ID)) return null;
  if (buf.readUInt16LE(8) !== OP_REPLY) return null;
  const str = (a, b) => buf.slice(a, b).toString("ascii").replace(/\0.*$/, "").trim();
  const ip = `${buf[10]}.${buf[11]}.${buf[12]}.${buf[13]}`;
  return {
    ip, from: rinfo && rinfo.address, port: buf.readUInt16LE(14),
    net: buf.length > 18 ? buf[18] : null,
    subnet: buf.length > 19 ? buf[19] : null,
    short: buf.length >= 44 ? str(26, 44) : "",
    long: buf.length >= 108 ? str(44, 108) : "",
    report: buf.length >= 172 ? str(108, 172) : "",
    ports: buf.length >= 174 ? buf.readUInt16BE(172) : null,
  };
}

/* Sequence must increment and wrap at 255, and 0 means "sequencing disabled".
   A sender stuck at one value looks like a broken source; a sender that sends 0
   forever tells the node not to reorder, which is what we want only if we never
   drop a packet. We increment, and skip 0 on the wrap. */
function sender({ to, universe = 0, broadcast } = {}) {
  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
  const dest = to || "255.255.255.255";
  const wantBroadcast = broadcast === undefined ? !to : !!broadcast;
  const seq = new Map();
  let open = false;
  sock.bind(() => {
    if (wantBroadcast) { try { sock.setBroadcast(true) } catch (e) {} }
    open = true;
  });
  return {
    dest, port: PORT,
    send(slots, u = universe) {
      let n = ((seq.get(u) || 0) + 1) & 0xff;
      if (n === 0) n = 1;
      seq.set(u, n);
      const p = packet({ universe: u, slots, sequence: n });
      if (open) sock.send(p, PORT, dest);
      return p;
    },
    close() { try { sock.close() } catch (e) {} },
  };
}

function discover({ ms = 2500, to } = {}) {
  return new Promise(resolve => {
    const found = new Map();
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    sock.on("error", () => resolve({ error: "could not bind UDP 6454 -- is another "
      + "Art-Net app (QLC+, a node tool) already running?", nodes: [] }));
    sock.on("message", (m, rinfo) => {
      const r = parseReply(m, rinfo);
      if (r) found.set(r.ip + "|" + r.short, r);
    });
    sock.bind(PORT, () => {
      try { sock.setBroadcast(true) } catch (e) {}
      const p = pollPacket({ talkToMe: 0 });
      for (const d of (to ? [to] : ["255.255.255.255", "2.255.255.255", "10.255.255.255"]))
        try { sock.send(p, PORT, d) } catch (e) {}
      setTimeout(() => { try { sock.close() } catch (e) {}
        resolve({ nodes: [...found.values()] }); }, ms);
    });
  });
}

module.exports = { packet, pollPacket, parseReply, sender, discover,
                   splitAddress, fromSacn, PORT, OP_DMX, OP_POLL, OP_REPLY };

/* ---------------------------------------------------------------------------
   The self-test takes our own packets apart against the spec, and sends two
   DELIBERATELY WRONG ones, because a parser that accepts everything proves
   nothing. Same rule as sacn.js and as every check in listen/.
*/
function selftest() {
  const out = [];
  const T = (name, cond, detail) => out.push([!!cond, name, detail || ""]);

  const slots = new Uint8Array(512);
  slots[0] = 255; slots[1] = 128; slots[511] = 7;
  const p = packet({ universe: 0, slots, sequence: 9 });

  T("a full universe is 18 + 512 = 530 bytes", p.length === 530, `got ${p.length}`);
  T('the header starts with "Art-Net" and a null',
    p.slice(0, 8).equals(ID), JSON.stringify(p.slice(0, 8).toString("ascii")));
  T("opcode is OpDmx, little-endian", p.readUInt16LE(8) === OP_DMX,
    "0x" + p.readUInt16LE(8).toString(16));
  T("protocol version 14 is big-endian", p[10] === 0 && p[11] === 14);
  T("length field is big-endian and counts data only",
    p.readUInt16BE(16) === 512, `${p.readUInt16BE(16)}`);
  T("slot 1 is the first data byte", p[18] === 255);
  T("slot 512 is the last byte of the packet", p[p.length - 1] === 7);
  T("sequence is carried", p[12] === 9);

  /* address splitting -- the part every node's web page describes differently */
  const a = splitAddress(0);      T("universe 0 -> net 0, subuni 0", a.net === 0 && a.subUni === 0);
  const b = splitAddress(1);      T("universe 1 -> net 0, subuni 1", b.net === 0 && b.subUni === 1);
  const c = splitAddress(16);     T("universe 16 -> net 0, subuni 16 (sub-net 1, uni 0)",
                                    c.net === 0 && c.subUni === 16);
  const d = splitAddress(256);    T("universe 256 -> net 1, subuni 0", d.net === 1 && d.subUni === 0);
  T("sACN universe 1 is Art-Net universe 0", fromSacn(1) === 0);
  T("sACN universe 2 is Art-Net universe 1", fromSacn(2) === 1);

  /* lengths that must be corrected rather than sent as given */
  T("an odd slot count is rounded up to even",
    packet({ slots: new Uint8Array(3) }).readUInt16BE(16) === 4);
  T("a 1-slot frame is padded to the legal minimum of 2",
    packet({ slots: new Uint8Array(1) }).readUInt16BE(16) === 2);
  T("an oversized slot array is truncated, not overflowed",
    packet({ slots: new Uint8Array(900) }).length === 530);
  T("a short frame sends a short packet, not a padded universe",
    packet({ slots: new Uint8Array(24) }).length === 42);

  /* deliberately wrong: the parser must refuse these */
  const bad1 = Buffer.alloc(20); ID.copy(bad1, 0); bad1.writeUInt16LE(OP_DMX, 8);
  T("an ArtDmx packet is not accepted as an ArtPollReply", parseReply(bad1, {}) === null);
  const bad2 = Buffer.alloc(240); bad2.write("Art-Nut\0", 0, "ascii");
  bad2.writeUInt16LE(OP_REPLY, 8);
  T("a reply with the wrong magic is refused", parseReply(bad2, {}) === null);

  /* a real socket, so the packet is proved on the wire and not just in memory */
  const rx = dgram.createSocket({ type: "udp4", reuseAddr: true });
  rx.on("message", m => {
    T("a packet sent over a real socket arrives byte-identical", m.equals(p),
      `${m.length} bytes`);
    rx.close();
    const bad = out.filter(r => !r[0]);
    for (const [ok, name, detail] of out)
      console.log(`  ${ok ? "pass" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
    console.log(bad.length ? `\n${bad.length} FAILED` : `\nall ${out.length} Art-Net checks pass`);
    process.exit(bad.length ? 1 : 0);
  });
  rx.bind(0, "127.0.0.1", () => {
    const tx = dgram.createSocket("udp4");
    tx.send(p, rx.address().port, "127.0.0.1", () => tx.close());
  });
}

if (require.main === module) {
  const A = process.argv.slice(2);
  const arg = (k, d) => { const i = A.indexOf(k); return i < 0 ? d : A[i + 1] };
  const has = k => A.includes(k);

  if (has("--selftest")) { selftest(); }
  else if (has("--discover")) {
    discover({ to: arg("--to"), ms: +arg("--ms", 2500) }).then(r => {
      if (r.error) { console.log("  " + r.error); process.exit(1) }
      if (!r.nodes.length) {
        console.log("  no Art-Net nodes replied.");
        console.log("  Things to check, in this order:");
        console.log("    - is the node powered and its link light on?");
        console.log("    - are you on the SAME subnet? many nodes ship as 2.0.0.x or 10.0.0.x");
        console.log("      while a laptop is 192.168.x.x -- they cannot see each other");
        console.log("    - Wi-Fi drops broadcast. Use a cable.");
        console.log("    - some nodes never send ArtPollReply; try --ramp --to <its ip> anyway");
        process.exit(1);
      }
      for (const n of r.nodes) {
        console.log(`  ${n.ip}  ${n.short || "(no name)"}  ${n.long || ""}`);
        console.log(`     net ${n.net}  sub-net ${n.subnet}  ports ${n.ports}`
                    + `  seen from ${n.from}`);
        if (n.report) console.log(`     reports: ${n.report}`);
      }
      /* A node reports its own IP in the reply, and Art-Net convention has that
         be a 2.x.x.x address even when the thing actually lives on a normal
         subnet -- QLC+ answers 2.0.0.1 from 192.168.1.x. Unicast at the address
         the packet CAME FROM, never the one it claims. */
      const n0 = r.nodes[0], route = n0.from || n0.ip;
      if (n0.from && n0.ip !== n0.from)
        console.log(`\n  Note: it reports ${n0.ip} but answered from ${n0.from}.`
                    + ` Send to ${n0.from} -- the reported address is often unroutable.`);
      console.log(`\n  Send to it with:  node readers/lights/artnet.js --ramp --to ${route}`);
    });
  }
  else {
    const to = arg("--to");
    const uni = +arg("--universe", 0);
    const s = sender({ to, universe: uni });
    console.log(`  Art-Net -> ${s.dest}:${PORT}  universe ${uni}`
                + `${to ? " (unicast)" : " (broadcast)"}`);
    if (has("--all")) {
      const v = +arg("--all", 40);
      const slots = new Uint8Array(512).fill(v);
      console.log(`  holding all 512 channels at ${v}. Ctrl-C to stop.`);
      setInterval(() => s.send(slots), 1000 / 30);
    } else if (has("--ramp")) {
      const ch = +arg("--ch", 1);
      console.log(`  ramping channel ${ch} up and down at 30 Hz. Ctrl-C to stop.`);
      let t = 0;
      setInterval(() => {
        t += 1 / 30;
        const slots = new Uint8Array(512);
        slots[ch - 1] = Math.round(127.5 * (1 - Math.cos(t * 1.4)));
        s.send(slots);
      }, 1000 / 30);
    } else {
      console.log("  nothing to do. Try --selftest, --discover, --ramp or --all <v>.");
      s.close();
    }
  }
}
