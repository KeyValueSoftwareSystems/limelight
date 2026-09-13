/* play.js tests -- the effect picker renders any library entry, look or one-shot,
   into a playable show without a panel. Plain node idiom. */
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
const { execFileSync } = require("child_process");
const out = [];
const ok = (name, cond, detail) => out.push([!!cond, name, detail || ""]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "play-"));
const run = a => execFileSync("node", [path.join(__dirname, "play.js"), ...a], { encoding: "utf8", stdio: "pipe" });

const listing = run(["--list"]);
ok("--list numbers every effect in the cache", /^\s+1\. /m.test(listing) && /one-shot|oneshot/.test(listing) && /effects\./.test(listing), listing.split("\n").slice(-2).join(" "));
const cache = require("./arc4-head.matrix.json");
ok("the list is as long as the cache", listing.includes(`${cache.sequences.length} effects.`));

const look = run(["pair_call_response", "--no-play", "--bars", "2", "--out", tmp]);
ok("a look renders by id", /rendered #\d+ pair_call_response/.test(look), look.trim());
const L = JSON.parse(fs.readFileSync(path.join(tmp, "preview.lights.json"), "utf8"));
ok("the show is 41-channel frames at 40 fps for the bars asked", L.fps === 40 && L.frames.length === 2 * 4 * 60 / 128 * 40 && L.frames.every(f => f.length === 41), `${L.frames.length} frames`);
ok("the pars are lit in it", L.frames.some(f => f[1] > 0 || f[2] > 0 || f[3] > 0));
ok("a frames.json for the bridge is written too", fs.existsSync(path.join(tmp, "preview.frames.json")));

const shot = run(["impact", "--no-play", "--bars", "4", "--out", tmp]);
ok("a one-shot renders by id", /rendered #\d+ impact \(oneshot/.test(shot), shot.trim());
const S = JSON.parse(fs.readFileSync(path.join(tmp, "preview.lights.json"), "utf8"));
const white = S.frames.filter(f => f[1] === 255 && f[2] === 255 && f[3] === 255).length;
ok("the one-shot fires white blasts over a quiet base", white > 0 && white < S.frames.length / 4, `${white} white frames of ${S.frames.length}`);
const byNumber = run(["1", "--no-play", "--bars", "1", "--out", tmp]);
ok("a number picks the first effect", /rendered #1 /.test(byNumber), byNumber.trim());
fs.rmSync(tmp, { recursive: true, force: true });

for (const [pass, name, detail] of out) console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
const bad = out.filter(r => !r[0]).length;
console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
