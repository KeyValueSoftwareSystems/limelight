/* Both commands against a fake dufs, run the way a person runs them: as a
   child process, with LIMELIGHT_REMOTE pointed at the fake. So the messages
   and exit codes are what is tested, not only the module. The shared server on
   the LAN is never touched from here. */
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const { execFile } = require("child_process");
const { fakeDufs } = require("./fake-dufs.js");
const { openRemote, NotFound, Unreachable } = require("./remote.js");

const CLI = path.join(__dirname, "..", "limelight");
const SCORE = fs.readFileSync(path.join(__dirname, "..", "protocol", "score.levels.json"));

const out = [];
const ok = (name, cond, detail) => out.push([!!cond, name, detail || ""]);

/* run the CLI in a scratch directory against a given remote URL. Async, and it
   has to be: the fake server lives in this process, so a blocking spawnSync
   would starve it of the event loop and the child would wait forever. */
function run(args, remote, cwd) {
  return new Promise(resolve => execFile(process.execPath, [CLI, ...args],
    { cwd, env: { ...process.env, LIMELIGHT_REMOTE: remote }, encoding: "utf8" },
    (e, out, err) => resolve({ code: e ? e.code : 0, out, err })));
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

  /* ---- limelight push ----------------------------------------------------- */
  {
    fake.files.clear();
    const dir = scratch();
    fs.writeFileSync(path.join(dir, "levels.score"), SCORE);
    fs.writeFileSync(path.join(dir, "notes.txt"), "hello");

    let r = await run([], fake.url, dir);
    ok("no arguments prints usage and exits 1", r.code === 1 && /usage/.test(r.err), r.err);

    r = await run(["push"], fake.url, dir);
    ok("push with no file prints usage and exits 1", r.code === 1 && /usage/.test(r.err), r.err);

    r = await run(["push", "notes.txt"], fake.url, dir);
    ok("push refuses a file that is not .score", r.code === 1 && /\.score/.test(r.err), r.err);
    ok("and sends nothing", !fake.files.has("notes.txt"));

    r = await run(["push", "missing.score"], fake.url, dir);
    ok("push refuses a file that does not exist", r.code === 1 && /no such file/.test(r.err), r.err);

    r = await run(["push", "levels.score"], fake.url, dir);
    ok("push uploads a .score", r.code === 0 && fake.files.get("levels.score").equals(SCORE), r.err);
    ok("and says where it went and how big",
       r.out.trim() === `pushed levels.score → ${fake.url}/levels.score (${SCORE.length} bytes)`, r.out);

    fs.writeFileSync(path.join(dir, "levels.score"), "{}");
    r = await run(["push", path.join(dir, "levels.score")], fake.url, dir);
    ok("push accepts a path and uses the basename, overwriting",
       r.code === 0 && fake.files.get("levels.score").toString() === "{}", r.err);

    r = await run(["push", "levels.score"], "http://127.0.0.1:9/score", dir);
    ok("an unreachable remote exits 2", r.code === 2 && /cannot reach/.test(r.err), r.err);
    ok("and the error names the override", /LIMELIGHT_REMOTE/.test(r.err));
  }

  /* ---- limelight pull ----------------------------------------------------- */
  {
    fake.files.clear();
    fake.files.set("levels.score", SCORE);
    fake.files.set("The Nights.score", Buffer.from("n"));
    const dir = scratch();

    let r = await run(["pull"], fake.url, dir);
    ok("pull with no name prints usage and exits 1", r.code === 1 && /usage/.test(r.err), r.err);

    r = await run(["pull", "levels.score"], fake.url, dir);
    ok("pull writes the file into the current directory",
       r.code === 0 && fs.readFileSync(path.join(dir, "levels.score")).equals(SCORE), r.err);
    ok("and says where it came from",
       r.out.trim() === `pulled levels.score ← ${fake.url}/levels.score (${SCORE.length} bytes)`, r.out);

    r = await run(["pull", "some/dir/levels.score"], fake.url, dir);
    ok("pull strips any directory part from the name", r.code === 0, r.err);

    r = await run(["pull", "The Nights.score"], fake.url, dir);
    ok("pull handles a name with a space", r.code === 0 && fs.existsSync(path.join(dir, "The Nights.score")), r.err);

    r = await run(["pull", "nope.score"], fake.url, dir);
    ok("pull of a missing name exits 1", r.code === 1, r.err);
    ok("and lists what the server does have",
       /levels\.score/.test(r.err) && /The Nights\.score/.test(r.err), r.err);
    ok("and writes nothing locally", !fs.existsSync(path.join(dir, "nope.score")));

    r = await run(["pull", "levels.score"], "http://127.0.0.1:9/score", dir);
    ok("pull from an unreachable remote exits 2", r.code === 2 && /cannot reach/.test(r.err), r.err);
  }

  await fake.close();

  for (const [pass, name, detail] of out)
    console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
  const bad = out.filter(r => !r[0]).length;
  console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
