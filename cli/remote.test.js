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
const SCORE = fs.readFileSync(path.join(REPO, "scores", "levels.score"));

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
  /* a root that does not exist yet, as on a fresh clone: the server must create it */
  const port = await freePort(), root = path.join(scratch(), "files");
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

  /* ---- versions: every .score keeps its history ----------------------------- */
  {
    fake.files.clear();
    const url = fake.url + "/v.score";
    const v1 = Buffer.from('{"score":"v","version":1,"grid":{"bpm":100}}');
    const v2 = Buffer.from('{"score":"v","version":2,"grid":{"bpm":110}}');
    const v3 = Buffer.from('{"score":"v","version":3,"grid":{"bpm":120}}');
    const put = (u, body) => fetch(u, { method: "PUT", body });
    const json = async r => JSON.parse(await r.text());

    let r = await put(url, v1);
    ok("the first upload is version 1", r.status === 201 && (await json(r)).version === 1);
    ok("uploads of new bytes are versions 2 and 3",
       (await json(await put(url, v2))).version === 2 && (await json(await put(url, v3))).version === 3);
    const hist = await json(await fetch(url + "?versions"));
    ok("?versions lists three, latest 3",
       hist.latest === 3 && hist.versions.map(v => v.version).join(",") === "1,2,3", JSON.stringify(hist));
    ok("each version knows its size", hist.versions[0].size === v1.length);
    ok("a plain GET is the latest", Buffer.from(await (await fetch(url)).arrayBuffer()).equals(v3));
    ok("?v=1 is the first", Buffer.from(await (await fetch(url + "?v=1")).arrayBuffer()).equals(v1));
    r = await fetch(url + "?v=7");
    ok("a version that does not exist is 404 and says so", r.status === 404 && /no version 7/.test(await r.text()));
    ok("identical bytes again are still a new version", (await json(await put(url, v3))).version === 4);
    ok("the top-level file is a copy of the latest", fake.files.get("v.score").equals(v3));

    const listing = await json(await fetch(fake.url + "/?json"));
    ok(".versions is hidden from the listing", !listing.paths.some(p => p.name === ".versions"), JSON.stringify(listing.paths.map(p => p.name)));
    const row = listing.paths.find(p => p.name === "v.score");
    ok("the row carries its version and metadata flag", row && row.version === 4 && row.has_metadata === false, JSON.stringify(row));
    r = await fetch(fake.url + "/.versions/v.score/1.score");
    ok(".versions cannot be addressed by URL", r.status === 403, String(r.status));

    await put(fake.url + "/notes.txt", "one"); await put(fake.url + "/notes.txt", "two");
    ok("a .txt still overwrites", fake.files.get("notes.txt").toString() === "two");
    r = await fetch(fake.url + "/notes.txt?versions");
    ok("and is not a versioned file", r.status === 400, String(r.status));
  }

  /* ---- metadata fields: x- keys at the root, and an x-enforced list ---------- */
  {
    fake.files.clear();
    const url = fake.url + "/m.score";
    const v1 = Buffer.from('{"score":"m","version":1,"grid":{"bpm":100}}');
    const v2 = Buffer.from('{"score":"m","version":2,"grid":{"bpm":110}}');
    const put = (u, body) => fetch(u, { method: "PUT", body: typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body) });
    const text = async r => await r.text();
    await put(url, v1); await put(url, v2);
    const fields = { author: { value: "renjith", enforced: true }, bpm: { value: 128, enforced: false } };

    let r = await put(url + "?meta&v=1", fields);
    ok("fields on a version are accepted", r.status === 204, String(r.status) + " " + await text(r));
    ok("and read back unchanged", JSON.stringify(await (await fetch(url + "?meta&v=1")).json()) === JSON.stringify(fields));
    ok("a version without fields reads back {}", (await text(await fetch(url + "?meta&v=2"))).trim() === "{}");

    const merged = JSON.parse(await text(await fetch(url + "?v=1")));
    ok("the download has each field at the root with an x- prefix",
       merged["x-author"] === "renjith" && merged["x-bpm"] === 128 && typeof merged["x-bpm"] === "number", JSON.stringify(merged));
    ok("and one x-enforced list naming the enforced keys", JSON.stringify(merged["x-enforced"]) === '["x-author"]', JSON.stringify(merged["x-enforced"]));
    ok("the score's own keys are kept", merged.grid.bpm === 100 && merged.score === "m");
    ok("and author_metadata is gone", !("author_metadata" in merged));
    ok("?raw is the uploaded bytes exactly", Buffer.from(await (await fetch(url + "?v=1&raw")).arrayBuffer()).equals(v1));
    ok("a version without fields downloads byte-identical", Buffer.from(await (await fetch(url + "?v=2")).arrayBuffer()).equals(v2));

    r = await put(url + "?meta", { who: { value: "me" } });
    ok("?meta with no v means the latest, and enforced defaults to false",
       r.status === 204 && (await (await fetch(url + "?meta&v=2")).json()).who.enforced === false);
    const latest = JSON.parse(await text(await fetch(url)));
    ok("nothing enforced means no x-enforced key", latest["x-who"] === "me" && !("x-enforced" in latest), JSON.stringify(latest));
    const head = await fetch(url, { method: "HEAD" });
    ok("HEAD reports the merged length", Number(head.headers.get("content-length")) === Buffer.byteLength(JSON.stringify(latest, null, 1)));

    const refused = [
      ["[1,2]", /object/],
      [{ a: 1 }, /a.*not an object/],
      [{ a: { value: { nested: 1 } } }, /a.*string, number, boolean or null/],
      [{ a: { value: 1, enforced: "yes" } }, /a.*enforced must be true or false/],
      [{ "": { value: 1 } }, /empty field name/],
      [{ " a ": { value: 1 } }, /leading or trailing/],
      [{ a: { enforced: true } }, /a.*value is missing/],
    ];
    for (const [body, why] of refused) {
      r = await put(url + "?meta&v=1", typeof body === "string" ? body : JSON.stringify(body));
      const t = await text(r);
      ok(`refused: ${typeof body === "string" ? body : JSON.stringify(body)}`, r.status === 400 && why.test(t), `${r.status} ${t}`);
    }
    ok("and the earlier fields are untouched", (await (await fetch(url + "?meta&v=1")).json()).author.value === "renjith");
    r = await put(url + "?meta&v=9", "{}");
    ok("fields on a missing version are 404", r.status === 404);

    const hist = await (await fetch(url + "?versions")).json();
    ok("?versions counts fields and enforced per version",
       hist.versions[0].fields === 2 && hist.versions[0].enforced === 1 && hist.versions[1].fields === 1 && hist.versions[1].enforced === 0, JSON.stringify(hist.versions));
    ok("and still flags has_metadata", hist.versions.map(v => v.has_metadata).join(",") === "true,true");
    const row = (await (await fetch(fake.url + "/?json")).json()).paths.find(p => p.name === "m.score");
    ok("the listing row says the latest has metadata", row.has_metadata === true, JSON.stringify(row));

    const odd = fake.url + "/odd.score";
    await put(odd, "this is not json at all");
    await put(odd + "?meta&v=1", { a: { value: 1 } });
    ok("a .score that is not JSON downloads unchanged even with fields", (await text(await fetch(odd))) === "this is not json at all");
    ok("and ?versions says it is not mergeable", (await (await fetch(odd + "?versions")).json()).versions[0].mergeable === false);
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
    ok("and says where it went, how big, and which version",
       r.out.trim() === `pushed levels.score → ${fake.url}/levels.score (${SCORE.length} bytes, v1)`, r.out);

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

    /* versions from the command line */
    const vurl = fake.url + "/lv.score";
    const a = Buffer.from('{"score":"lv","version":1}'), b = Buffer.from('{"score":"lv","version":2}');
    await fetch(vurl, { method: "PUT", body: a }); await fetch(vurl, { method: "PUT", body: b });
    await fetch(vurl + "?meta&v=2", { method: "PUT", body: JSON.stringify({ who: { value: "me" } }) });

    r = await run(["pull", "lv.score@1"], fake.url, dir);
    ok("pull name@1 writes version 1", r.code === 0 && fs.readFileSync(path.join(dir, "lv.score")).equals(a), r.err);
    ok("and says which version", /lv\.score@1 ←/.test(r.out), r.out);
    r = await run(["pull", "lv.score"], fake.url, dir);
    ok("pull without @ is the latest, merged",
       r.code === 0 && JSON.parse(fs.readFileSync(path.join(dir, "lv.score"), "utf8"))["x-who"] === "me", r.err);
    r = await run(["pull", "lv.score@9"], fake.url, dir);
    ok("pull of a missing version exits 1 and lists the versions", r.code === 1 && /versions: 1, 2/.test(r.err), r.err);
  }

  /* ---- the hub itself: page and API ---------------------------------------- */
  {
    ok("the server created a root that did not exist", fs.statSync(fake.root).isDirectory());
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

    r = await fetch(fake.url + "/levels.score?page");
    ok("a .score answers ?page with HTML", r.status === 200 && /text\/html/.test(r.headers.get("content-type")) && /versions/.test(await r.text()), String(r.status));
    r = await fetch(fake.url + "/never-uploaded.score?page");
    ok("even a .score with no versions yet answers ?page", r.status === 200, String(r.status));
    r = await fetch(fake.url + "/notes.txt?page");
    ok("a .txt does not have a page", r.status === 400, String(r.status));
    const rowLatest = (await (await fetch(fake.url + "/?json")).json()).paths.find(p => p.name === "levels.score");
    /* this file was written straight to disk by the pull block, so it has no history: version is null, and the keys are still there */
    ok("the listing row still carries version and has_metadata", rowLatest && "version" in rowLatest && "has_metadata" in rowLatest, JSON.stringify(rowLatest));
  }

  await fake.close();

  for (const [pass, name, detail] of out)
    console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
  const bad = out.filter(r => !r[0]).length;
  console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
