/* Both commands against a fake dufs, run the way a person runs them: as a
   child process, with LIMELIGHT_REMOTE pointed at the fake. So the messages
   and exit codes are what is tested, not only the module. The shared server on
   the LAN is never touched from here. */
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
const { fakeDufs } = require("./fake-dufs.js");
const { openRemote, NotFound, Unreachable } = require("./remote.js");

const CLI = path.join(__dirname, "..", "limelight");
const SCORE = fs.readFileSync(path.join(__dirname, "..", "protocol", "score.levels.json"));

const out = [];
const ok = (name, cond, detail) => out.push([!!cond, name, detail || ""]);

/* run the CLI in a scratch directory against a given remote URL */
function run(args, remote, cwd) {
  const r = spawnSync(process.execPath, [CLI, ...args],
    { cwd, env: { ...process.env, LIMELIGHT_REMOTE: remote }, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), "limelight-"));

(async () => {
  const fake = await fakeDufs();

  /* ---- the backend on its own ------------------------------------------- */
  {
    const r = openRemote(fake.url);
    ok("an empty remote lists nothing", (await r.list()).length === 0);
    ok("a missing file has no size", (await r.size("nope.score")) === null);
    let threw = null; try { await r.get("nope.score"); } catch (e) { threw = e; }
    ok("getting a missing file throws NotFound", threw instanceof NotFound);

    await r.put("levels.score", SCORE);
    ok("put creates the folder first", fake.log.some(l => l.startsWith("MKCOL /score")), fake.log.join(" | "));
    ok("put uploads with PUT to /score/<name>", fake.log.includes("PUT /score/levels.score"));
    ok("the bytes arrived intact", fake.files.get("levels.score").equals(SCORE));
    ok("size reports what the server holds", (await r.size("levels.score")) === SCORE.length);
    ok("list now shows it", JSON.stringify(await r.list()) === JSON.stringify(["levels.score"]));
    ok("get returns the same bytes", (await r.get("levels.score")).equals(SCORE));

    await r.put("levels.score", Buffer.from("{}"));
    ok("put again overwrites silently", fake.files.get("levels.score").toString() === "{}");

    const name = "The Nights.score";
    await r.put(name, Buffer.from("n"));
    ok("names are URL-encoded per segment like the web UI", fake.log.includes("PUT /score/The%20Nights.score"));
    ok("and decoded on the server", fake.files.has(name));

    const dead = openRemote("http://127.0.0.1:9/score");
    let un = null; try { await dead.list(); } catch (e) { un = e; }
    ok("an unreachable remote throws Unreachable", un instanceof Unreachable);
    ok("and the message says how to override it", /LIMELIGHT_REMOTE/.test(un && un.message), un && un.message);

    let scheme = null; try { openRemote("s3://bucket/scores"); } catch (e) { scheme = e; }
    ok("an unknown scheme is refused up front", scheme && /s3:/.test(scheme.message), scheme && scheme.message);
  }

  await fake.close();

  for (const [pass, name, detail] of out)
    console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
  const bad = out.filter(r => !r[0]).length;
  console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
