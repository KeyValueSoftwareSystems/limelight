/* Both commands against the real server, run the way a person runs them: as a
   child process, with LIMELIGHT_REMOTE pointed at a serve.py started here on a
   free port with a temporary HUB_ROOT. So the messages, the exit codes and the
   server itself are what is tested, not a stand-in. Nothing here touches the
   hub anybody is actually using. */
"use strict";
const fs = require("fs"), os = require("os"), path = require("path"), net = require("net"), http = require("http");
const { execFile, spawn } = require("child_process");
const { openRemote, NotFound, Unreachable } = require("./remote.js");

const REPO = path.join(__dirname, "..");
const CLI = path.join(REPO, "limelight");
const SCORE = fs.readFileSync(path.join(REPO, "protocol", "score.levels.json"));

const out = [];
const ok = (name, cond, detail) => out.push([!!cond, name, detail || ""]);

/* run the CLI in a scratch directory against a given remote URL. Async, and it
   has to be: a blocking spawnSync would starve this process's event loop, and
   anything waiting on it (the readiness poll, the server's own output) with it. */
function run(args, remote, cwd) {
  return new Promise(resolve => execFile(process.execPath, [CLI, ...args],
    { cwd, env: { ...process.env, LIMELIGHT_REMOTE: remote }, encoding: "utf8" },
    (e, out, err) => resolve({ code: e ? e.code : 0, out, err })));
}
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), "limelight-"));
/* fetch() collapses %2e%2e to .. before sending, so a traversal probe has to go
   out raw, exactly as typed, for the server to be the thing under test */
const raw = (origin, method, p, body) => new Promise((resolve, reject) => {
  const u = new URL(origin);
  const req = http.request({ host: u.hostname, port: u.port, method, path: p }, res => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
  req.on("error", reject); req.end(body);
});
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });

/* start serve.py on a free port with a temp hub root; `files` reads and writes
   that root's score/ folder directly, which is what the assertions look at */
async function startHub() {
  const port = await freePort(), root = scratch();
  const proc = spawn("python3", [path.join(REPO, "serve.py")],
    { env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", HUB_ROOT: root }, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = ""; proc.stderr.on("data", d => stderr += d);
  const origin = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {                     /* up to ~5 s to come up */
    try { await fetch(origin + "/hub/?json"); break; } catch (e) { await new Promise(r => setTimeout(r, 50)); }
    if (i === 99) throw new Error("serve.py never answered\n" + stderr);
  }
  const score = path.join(root, "score");
  const files = {
    clear: () => fs.rmSync(score, { recursive: true, force: true }),
    has: n => fs.existsSync(path.join(score, n)),
    get: n => fs.readFileSync(path.join(score, n)),
    set: (n, b) => { fs.mkdirSync(score, { recursive: true }); fs.writeFileSync(path.join(score, n), b); },
  };
  return { origin, url: origin + "/hub/score", root, score, files,
           close: () => new Promise(r => { proc.on("exit", r); proc.kill(); }) };
}

(async () => {
  const fake = await startHub();

  /* ---- the backend on its own ------------------------------------------- */
  {
    const r = openRemote(fake.url);
    ok("an empty remote lists nothing", (await r.list()).length === 0);
    ok("a missing file has no size", (await r.size("nope.score")) === null);
    let threw = null; try { await r.get("nope.score"); } catch (e) { threw = e; }
    ok("getting a missing file throws NotFound", threw instanceof NotFound);

    await r.put("levels.score", SCORE);
    ok("put creates the folder first", fs.statSync(fake.score).isDirectory());
    ok("put lands the file under score/<name>", fake.files.has("levels.score"));
    ok("the bytes arrived intact", fake.files.get("levels.score").equals(SCORE));
    ok("size reports what the server holds", (await r.size("levels.score")) === SCORE.length);
    ok("list now shows it", JSON.stringify(await r.list()) === JSON.stringify(["levels.score"]));
    ok("get returns the same bytes", (await r.get("levels.score")).equals(SCORE));

    await r.put("levels.score", Buffer.from("{}"));
    ok("put again overwrites silently", fake.files.get("levels.score").toString() === "{}");

    const name = "The Nights.score";
    await r.put(name, Buffer.from("n"));
    ok("a name with a space round-trips through URL encoding", fake.files.has(name));
    ok("and comes back under the same name", JSON.stringify(await r.list()) === JSON.stringify(["levels.score", name]), JSON.stringify(await r.list()));

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
    ok("push accepts any extension while the .score check is parked", r.code === 0, r.err);
    ok("and it lands under its basename", fake.files.has("notes.txt") && fake.files.get("notes.txt").toString() === "hello");

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

  /* ---- the hub itself: page and API ---------------------------------------- */
  {
    let r = await fetch(fake.origin + "/hub/");
    ok("GET /hub/ is the page", r.status === 200 && /text\/html/.test(r.headers.get("content-type")) && /HUB/.test(await r.text()));
    r = await fetch(fake.origin + "/hub", { redirect: "manual" });
    ok("GET /hub redirects to /hub/", r.status === 301 && r.headers.get("location") === "/hub/", String(r.status));
    r = await fetch(fake.origin + "/hub/?json");
    const data = await r.json();
    ok("GET /hub/?json lists the root with score/ as a Dir",
       r.status === 200 && data.paths.some(p => p.name === "score" && p.path_type === "Dir"), JSON.stringify(data.paths));
    r = await fetch(fake.origin + "/hub/score", { method: "MKCOL" });
    ok("MKCOL on an existing folder is 405 like dufs", r.status === 405, String(r.status));
    let code = await raw(fake.origin, "GET", "/hub/%2e%2e/serve.py");
    ok("a path that leaves the hub is refused", code === 403, String(code));
    code = await raw(fake.origin, "PUT", "/hub/%2e%2e/escaped.txt", "x");
    ok("and so is writing there", code === 403, String(code));
    ok("nothing was written outside the root", !fs.existsSync(path.join(fake.root, "..", "escaped.txt")));
    r = await fetch(fake.origin + "/hub/score/", { method: "PUT", body: "x" });
    ok("PUT onto a folder is refused", r.status === 405, String(r.status));
    r = await fetch(fake.origin + "/protocol/session.js", { method: "PUT", body: "x" });
    ok("PUT outside /hub is refused by serve.py", r.status === 405, String(r.status));
    ok("and the file is untouched", !/^x$/.test(fs.readFileSync(path.join(REPO, "protocol", "session.js"), "utf8")));
  }

  await fake.close();

  for (const [pass, name, detail] of out)
    console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
  const bad = out.filter(r => !r[0]).length;
  console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
