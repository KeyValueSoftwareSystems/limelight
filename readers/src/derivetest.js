/* derive.js has to be a pure function of (map, t) like everything else a reader
   runs. It replaced four fields that were tables in the file, and a table is
   trivially pure -- so the thing that could regress here is the property the
   tables gave for free. Asked in random order, then asked again after two
   hundred other calls, every answer has to be identical. */
const fs = require("fs");
const D = require("./derive.js");

const slugs = ["levels", "starlight", "mizhiyoram", "dont-look-down", "the-nights"];
let ok = true;
function say(name, good, detail) {
  ok = ok && good;
  console.log("   " + (good ? "ok  " : "FAIL") + " " + name.padEnd(38) + detail);
}
console.log("== derive.js, the one place the four removed fields are computed");
for (const slug of slugs) {
  const p = "synth/maps/amal/" + slug + ".map.json";
  if (!fs.existsSync(p)) continue;
  const m = JSON.parse(fs.readFileSync(p, "utf8"));
  const d = D.make(m);
  const DUR = (m.song && m.song.length) || 100;

  const ts = [];
  for (let i = 0; i < 200; i++) ts.push(Math.random() * DUR);
  const snap = (t) => JSON.stringify([d.anticipationAt(t), d.remainingAt(t), d.leadAt(t)]);
  const first = new Map();
  for (const t of ts) first.set(t, snap(t));
  for (let i = 0; i < 200; i++) snap(Math.random() * DUR);      // 200 other calls
  let same = 0;
  for (const t of ts) if (snap(t) === first.get(t)) same++;
  say(slug + ": same t, same answer", same === ts.length,
      same + "/" + ts.length + " identical after 200 intervening calls");

  // and it must not throw on the edges, or on a map missing what it reads
  let threw = null;
  try { [0, -1, DUR, DUR + 10].forEach((t) => snap(t)); } catch (e) { threw = e.message; }
  say(slug + ": edges do not throw", threw === null, threw || "t = 0, -1, end, past the end");
}
const bare = D.make({ song: { length: 10 } });
let threw = null;
try { bare.anticipationAt(5); bare.remainingAt(5); bare.leadAt(5); } catch (e) { threw = e.message; }
say("a map with none of it", threw === null,
    threw || "no beats, no moments, no stems: arc=" + bare.arc + ", lead=" + bare.leadAt(5));
process.exit(ok ? 0 : 1);
