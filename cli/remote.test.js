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
/* Bytes to push and pull, not a score to read. The committed fixture this used
   to load went stale every time the pipeline changed -- it was refreshed three
   times in one night -- so it is gone. A built score is used when one is there,
   because exercising a realistic size is worth something, and a deterministic
   blob stands in when there is not. */
const SCORE = (() => {
  const store = path.join(REPO, "hub", "files", "score", ".versions", "levels.score");
  const built = (() => {
    let ns = [];
    try { ns = fs.readdirSync(store).map(x => parseInt(x, 10)).filter(n => n > 0); }
    catch (e) { return null; }
    return ns.length ? path.join(store, Math.max(...ns) + ".score") : null;
  })();
  if (built && fs.existsSync(built)) return fs.readFileSync(built);
  const rows = [];
  for (let i = 0; i < 400; i++) rows.push({ bar: i, beat: 1 + (i % 4), weight: (i % 97) / 97 });
  return Buffer.from(JSON.stringify({ score: "stand-in", version: 0, beats: rows }));
})();

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
async function startHub(extraEnv = {}) {
  /* a root that does not exist yet, as on a fresh clone: the server must create it */
  const port = await freePort(), root = path.join(scratch(), "files");
  const proc = spawn("python3", [path.join(REPO, "serve.py")],
    { env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", HUB_ROOT: root,
             LIMELIGHT_SCORE_BUILDER: "stub", ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = ""; proc.stderr.on("data", d => stderr += d);
  const origin = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {                     /* up to ~5 s to come up */
    try { await fetch(origin + "/hub/?json"); break; } catch (e) { await new Promise(r => setTimeout(r, 50)); }
    if (i === 99) throw new Error("serve.py never answered\n" + stderr);
  }
  const score = path.join(root, "score");
  const at = n => {
    const flat = path.join(score, n);
    if (!n.endsWith(".score") || fs.existsSync(flat)) return flat;
    const store = path.join(score, ".versions", n);
    let ns = [];
    try { ns = fs.readdirSync(store).map(x => parseInt(x, 10)).filter(v => v > 0); }
    catch (e) { return flat; }
    return ns.length ? path.join(store, Math.max(...ns) + ".score") : flat;
  };
  const files = {
    clear: () => fs.rmSync(score, { recursive: true, force: true }),
    has: n => fs.existsSync(at(n)),
    get: n => fs.readFileSync(at(n)),
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
    ok("the store is the only copy; no top-level file is written",
       !fs.existsSync(path.join(fake.score, "v.score")));

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
      [{ a: { value: { nested: 1 } } }, /a.*string, number, boolean, null, or a list of flat objects/],
      /* a list of flat objects IS allowed -- that is how `effects` travels -- but
         a list with a nested object in it is not, and the message says which */
      [{ a: { value: [{ ok: 1 }, { deep: { no: 1 } }] } }, /list of flat objects/],
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

  /* ---- personalities: how the artist wants this song to look ---------------- */
  {
    fake.files.clear();
    const url = fake.url + "/p.score";
    const v1 = Buffer.from('{"score":"p","version":1,"grid":{"bpm":100}}');
    const put = (u, body) => fetch(u, { method: "PUT", body: typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body) });
    const text = async r => await r.text();
    const json = async r => JSON.parse(await r.text());
    await put(url, v1);
    await put(url + "?meta&v=1", { author: { value: "renjith", enforced: true } });

    let info = await json(await fetch(url + "?personalities"));
    ok("a score starts with the palette and no personalities",
       info.colours.length === 7 && info.colours.map(c => c.name).join(",") === "red,green,blue,yellow,cyan,magenta,white"
       && info.colours[0].hex === "#ff0000" && info.personalities.length === 0, JSON.stringify(info));

    let r = await put(url + "?personality=sarath", { colours: ["magenta", "cyan"] });
    ok("a personality with two colours is accepted", r.status === 204, `${r.status} ${await text(r)}`);
    info = await json(await fetch(url + "?personalities"));
    ok("and listed with each colour resolved to a hex, in the order given",
       JSON.stringify(info.personalities) === JSON.stringify([{ user: "sarath", colours: [{ name: "magenta", hex: "#ff00ff" }, { name: "cyan", hex: "#00ffff" }] }]), JSON.stringify(info.personalities));

    await put(url + "?personality=alnas", { colours: ["green"] });
    info = await json(await fetch(url + "?personalities"));
    ok("two personalities, sorted by user", info.personalities.map(p => p.user).join(",") === "alnas,sarath");
    const row = (await json(await fetch(fake.url + "/?json"))).paths.find(p => p.name === "p.score");
    ok("the listing row counts them", row.personalities === 2, JSON.stringify(row));

    r = await put(url + "?personality=sarath", { colours: ["blue"] });
    info = await json(await fetch(url + "?personalities"));
    ok("saving the same user again replaces the personality",
       r.status === 204 && info.personalities.length === 2 && info.personalities.find(p => p.user === "sarath").colours.map(c => c.hex).join() === "#0000ff");

    /* the old spelling still answers, so nothing written last week breaks */
    const old = await json(await fetch(url + "?profiles"));
    ok("?profiles still answers, under the new key",
       old.personalities.length === 2, JSON.stringify(Object.keys(old)));
    r = await put(url + "?profile=sarath", { colours: ["red"] });
    ok("?profile= still saves", r.status === 204, `${r.status}`);
    info = await json(await fetch(url + "?personalities"));
    ok("and it is the same personality it wrote to",
       info.personalities.find(p => p.user === "sarath").colours[0].name === "red");
    await put(url + "?personality=sarath", { colours: ["blue"] });

    const refused = [
      [url + "?personality=sarath", { colours: ["purple"] }, /purple.*one of: red, green, blue/],
      [url + "?personality=sarath", {}, /colours is missing/],
      [url + "?personality=sarath", { colours: [] }, /at least one/],
      [url + "?personality=sarath", { colours: "red" }, /must be a list/],
      [url + "?personality=sarath", { colours: ["red", "red"] }, /repeated/],
      [url + "?personality=sarath", "[1]", /object/],
      [url + "?personality=bad%20name!", { colours: ["red"] }, /letters, digits/],
      [url + "?personality=" + "a".repeat(41), { colours: ["red"] }, /letters, digits/],
    ];
    for (const [u, body, why] of refused) {
      r = await put(u, body);
      const t = await text(r);
      ok(`refused: ${decodeURIComponent(u.split("?personality=")[1])} ${typeof body === "string" ? body : JSON.stringify(body)}`, r.status === 400 && why.test(t), `${r.status} ${t}`);
    }
    info = await json(await fetch(url + "?personalities"));
    ok("and nothing changed", info.personalities.length === 2 && info.personalities.find(p => p.user === "sarath").colours[0].name === "blue");

    const dl = await json(await fetch(url + "?v=1&personality=sarath"));
    ok("a download with a personality embeds it",
       dl.personality && dl.personality.user === "sarath" && dl.personality.colours[0].hex === "#0000ff", JSON.stringify(dl.personality));
    ok("after the author's keys, which are kept", dl["x-author"] === "renjith" && dl.grid.bpm === 100 && JSON.stringify(dl["x-enforced"]) === '["x-author"]');
    const latest = await json(await fetch(url + "?personality=alnas"));
    ok("without v it is the latest with that personality", latest.personality.user === "alnas" && latest.version === 1);

    r = await fetch(url + "?personality=nobody");
    let t = await text(r);
    ok("a missing personality is 404 and lists the users", r.status === 404 && /no personality nobody/.test(t) && /alnas, sarath/.test(t), `${r.status} ${t}`);
    r = await fetch(url + "?v=1&personality=nobody");
    ok("with a version too", r.status === 404);
    r = await fetch(url + "?raw&personality=sarath");
    ok("raw and personality contradict", r.status === 400 && /contradict/.test(await text(r)));

    const odd = fake.url + "/oddp.score";
    await put(odd, "not json"); await put(odd + "?profile=muzammil", { colours: ["red"] });
    r = await fetch(odd + "?profile=muzammil");
    ok("a .score that is not a JSON object cannot embed a profile", r.status === 409, String(r.status));

    const plain = await json(await fetch(url));
    ok("a download without profile has no profile key", !("profile" in plain));
    await put(fake.url + "/notes.txt", "x");
    r = await fetch(fake.url + "/notes.txt?profiles");
    ok("only .score files have profiles", r.status === 400, String(r.status));
  }

  /* ---- POST /hub/score: protocol load, with an optional profile ------------ */
  {
    fake.files.clear();
    const url = fake.url + "/loadme.score";
    const score = {
      score: "loadme", version: 1,
      grid: { bpm: 100, beats_per_bar: 4, first_beat_s: 0 },
      beats: { list: [[1, 1]], count: 1, derived_from: "grid", as: "[bar, beat]" },
    };
    await fetch(url, { method: "PUT", body: Buffer.from(JSON.stringify(score)) });
    await fetch(url + "?profile=muzammil", { method: "PUT", body: JSON.stringify({ colours: ["red", "blue"] }) });

    const load = payload => fetch(fake.origin + "/hub/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const jsonOrText = async r => {
      const t = await r.text();
      try { return { raw: t, body: JSON.parse(t) }; } catch (e) { return { raw: t, body: null }; }
    };

    let r = await load({ score: "loadme", fields: ["beats"], personality: "muzammil" });
    let got = await jsonOrText(r);
    ok("POST /hub/score with a personality embeds it in the response",
       r.status === 200 && got.body && got.body.personality && got.body.personality.user === "muzammil"
       && got.body.personality.colours.map(c => c.hex).join() === "#ff0000,#0000ff",
       `${r.status} ${got.raw}`);
    ok("and under the old key as well, so nothing breaks mid-week",
       got.body && got.body.profile && got.body.profile.user === "muzammil");

    r = await load({ score: "loadme", fields: ["beats"], profile: "muzammil" });
    got = await jsonOrText(r);
    ok("asking with the old key still works",
       r.status === 200 && got.body && got.body.personality
       && got.body.personality.user === "muzammil", `${r.status} ${got.raw}`);

    r = await load({ score: "loadme", fields: ["beats"] });
    got = await jsonOrText(r);
    ok("without one, neither key is sent",
       r.status === 200 && got.body && !("personality" in got.body) && !("profile" in got.body),
       `${r.status} ${got.raw}`);

    r = await load({ score: "loadme", fields: ["beats"], personality: "nobody" });
    got = await jsonOrText(r);
    ok("a missing personality is 400 and lists the users",
       r.status === 400 && got.body && /no personality nobody/.test(got.body.error || "") && /muzammil/.test(got.body.error || ""),
       `${r.status} ${got.raw}`);
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

    /* personalities from the command line */
    await fetch(vurl + "?personality=sarath", { method: "PUT", body: JSON.stringify({ colours: ["magenta", "cyan"] }) });
    r = await run(["pull", "lv.score", "--personality=sarath"], fake.url, dir);
    let pulled = JSON.parse(fs.readFileSync(path.join(dir, "lv.score"), "utf8"));
    ok("pull --personality=user embeds it", r.code === 0 && pulled.personality && pulled.personality.colours.map(c => c.hex).join() === "#ff00ff,#00ffff", r.err);
    ok("and the message names it", /personality sarath\)$/.test(r.out.trim()), r.out);
    r = await run(["pull", "lv.score@1", "--personality", "sarath"], fake.url, dir);
    pulled = JSON.parse(fs.readFileSync(path.join(dir, "lv.score"), "utf8"));
    ok("the space form works, with a version", r.code === 0 && pulled.version === 1 && pulled.personality.user === "sarath", r.err);
    r = await run(["pull", "lv.score", "--personality=nobody"], fake.url, dir);
    ok("a missing personality exits 1 and lists them", r.code === 1 && /no personality nobody/.test(r.err) && /personalities: sarath/.test(r.err), r.err);
    r = await run(["pull", "lv.score"], fake.url, dir);
    pulled = JSON.parse(fs.readFileSync(path.join(dir, "lv.score"), "utf8"));
    ok("no flag, nothing embedded", r.code === 0 && !("personality" in pulled), r.err);
    r = await run(["pull", "lv.score", "--profile=sarath"], fake.url, dir);
    pulled = JSON.parse(fs.readFileSync(path.join(dir, "lv.score"), "utf8"));
    ok("--profile still works, and writes the new key", r.code === 0 && pulled.personality && pulled.personality.user === "sarath", r.err);
    r = await run(["pull", "lv.score", "--colour=red"], fake.url, dir);
    ok("an unknown option is refused", r.code === 1 && /unknown option --colour/.test(r.err), r.err);
  }

  /* ---- the hub itself: page and API ---------------------------------------- */
  {
    ok("the server created a root that did not exist", fs.statSync(fake.root).isDirectory());
    let r = await fetch(fake.origin + "/hub/");
    ok("GET /hub/ is the page", r.status === 200 && /text\/html/.test(r.headers.get("content-type")) && /Hub/.test(await r.text()));
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

    fake.files.clear();
    const libScore = Buffer.from('{"score":"lib","version":1,"grid":{"bpm":100,"beats_per_bar":4,"bars":8,"first_beat_s":0},"song":{"length_s":10}}');
    await fetch(fake.url + "/lib.score", { method: "PUT", body: libScore });
    await fetch(fake.url + "/lib.mp3", { method: "PUT", body: Buffer.from("fake-mp3") });
    let lib = await (await fetch(fake.origin + "/library.json")).json();
    ok("/library.json lists hub score latest",
       lib.some(x => x.slug === "lib" && x.audio === "/hub/audio/lib.mp3"
         && x.score === "/hub/score/lib.score"), JSON.stringify(lib));
    ok("mp3 is not listed beside scores",
       !(await (await fetch(fake.url + "/?json")).json()).paths.some(p => /\.mp3$/i.test(p.name)));
    ok("audio/ folder is hidden from hub root listing",
       !(await (await fetch(fake.origin + "/hub/?json")).json()).paths.some(p => p.name === "audio"));
    await fetch(fake.origin + "/hub/rooty.score", {
      method: "PUT", body: Buffer.from('{"score":"rooty","version":1,"grid":{"bpm":90}}') });
    lib = await (await fetch(fake.origin + "/library.json")).json();
    ok("/library.json ignores scores left at hub root (canonical is score/)",
       !lib.some(x => x.slug === "rooty"), JSON.stringify(lib));
    const home = await fetch(fake.origin + "/");
    const homeHtml = await home.text();
    ok("home page links to hub", home.status === 200 && /href="\/hub\/score\/"/.test(homeHtml), String(home.status));
    const hubPage = await (await fetch(fake.origin + "/hub/")).text();
    ok("hub page links home", /href="\/"/.test(hubPage) && />Home</.test(hubPage));
    const hubScore = await (await fetch(fake.origin + "/hub/score/lib.score")).json();
    ok("home can load score from hub path", hubScore.score === "lib" && hubScore.grid.bpm === 100);
  }

  /* ---- migrate root songs into score/, mp3s into audio/ ------------------ */
  {
    const port = await freePort(), root = path.join(scratch(), "files");
    fs.mkdirSync(root, { recursive: true });
    const body = Buffer.from('{"score":"old","version":1,"grid":{"bpm":88}}');
    fs.writeFileSync(path.join(root, "old.score"), body);
    fs.writeFileSync(path.join(root, "old.mp3"), Buffer.from("audio-bytes"));
    fs.mkdirSync(path.join(root, ".versions", "old.score"), { recursive: true });
    fs.writeFileSync(path.join(root, ".versions", "old.score", "1.score"), body);
    fs.writeFileSync(path.join(root, ".versions", "old.score", "1.meta.json"),
      Buffer.from('{"author":{"value":"renjith","enforced":true}}'));
    const proc = spawn("python3", [path.join(REPO, "serve.py")],
      { env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", HUB_ROOT: root,
               LIMELIGHT_SCORE_BUILDER: "stub" }, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = ""; proc.stderr.on("data", d => stderr += d);
    const origin = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 100; i++) {
      try { await fetch(origin + "/hub/?json"); break; } catch (e) { await new Promise(r => setTimeout(r, 50)); }
      if (i === 99) throw new Error("migrate serve.py never answered\n" + stderr);
    }
    try {
      ok("migrate moved the score into score/",
         fs.existsSync(path.join(root, "score", "old.score")) && !fs.existsSync(path.join(root, "old.score")));
      ok("migrate moved the mp3 into audio/",
         fs.existsSync(path.join(root, "audio", "old.mp3")) && !fs.existsSync(path.join(root, "old.mp3"))
           && !fs.existsSync(path.join(root, "score", "old.mp3")));
      ok("migrate moved .versions under score/",
         fs.existsSync(path.join(root, "score", ".versions", "old.score", "1.score"))
           && !fs.existsSync(path.join(root, ".versions")));
      const lib = await (await fetch(origin + "/library.json")).json();
      const row = lib.find(x => x.slug === "old");
      ok("/library.json lists the migrated song under /hub/score/ with /hub/audio/",
         row && row.score === "/hub/score/old.score" && row.audio === "/hub/audio/old.mp3", JSON.stringify(row));
      const got = await (await fetch(origin + "/hub/score/old.score?v=1&raw")).arrayBuffer();
      ok("migrated version 1 is still downloadable", Buffer.from(got).equals(body));
    } finally {
      await new Promise(r => { proc.on("exit", r); proc.kill(); });
    }
  }

  /* ---- generate score from mp3 ------------------------------------------ */
  {
    fake.files.clear();
    const put = (u, body) => fetch(u, { method: "PUT", body });
    const text = async r => await r.text();
    const json = async r => JSON.parse(await r.text());
    const waitDone = async (url, scoreName, { minVersion = 1, afterId = null, ms = 5000 } = {}) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const info = await json(await fetch(url + "/?jobs"));
        const job = (info.jobs || []).find(j => j.score_name === scoreName
          && (j.status === "done" || j.status === "error")
          && (j.version == null || j.version >= minVersion)
          && (!afterId || j.id !== afterId));
        if (job) return job;
        await new Promise(r => setTimeout(r, 50));
      }
      return null;
    };

    let r = await put(fake.url + "/song.mp3", Buffer.from("not-really-mp3"));
    ok("an mp3 upload is accepted", r.status === 201, `${r.status} ${await text(r)}`);
    ok("mp3 landed under audio/, not score/",
       fs.existsSync(path.join(fake.root, "audio", "song.mp3"))
         && !fs.existsSync(path.join(fake.score, "song.mp3")));
    r = await fetch(fake.url + "/song.mp3?generate", { method: "POST" });
    let body = await json(r);
    ok("POST ?generate returns 202 with a job", r.status === 202 && body.job && body.job.score_name === "song.score"
       && body.job.status === "queued", JSON.stringify(body));

    let job = await waitDone(fake.url, "song.score", { minVersion: 1 });
    ok("the stub builder finishes", job && job.status === "done" && job.version === 1, JSON.stringify(job));
    let listing = await json(await fetch(fake.url + "/?json"));
    let row = listing.paths.find(p => p.name === "song.score");
    ok("the listing shows the new score at v1", row && row.version === 1, JSON.stringify(row));
    ok("and the mp3 is not listed in score/", !listing.paths.some(p => p.name === "song.mp3"));

    const libAfter = await json(await fetch(fake.origin + "/library.json"));
    const songLib = libAfter.find(x => x.slug === "song");
    ok("/library.json pairs the hub mp3 with the generated score",
       songLib && songLib.audio === "/hub/audio/song.mp3" && songLib.score === "/hub/score/song.score",
       JSON.stringify(songLib));
    r = await fetch(fake.origin + "/hub/audio/song.mp3", { headers: { Range: "bytes=0-1" } });
    ok("hub mp3 answers Range with 206 and audio/mpeg",
       r.status === 206 && /audio\/mpeg/.test(r.headers.get("content-type") || "")
         && r.headers.get("content-range") === "bytes 0-1/14"
         && Buffer.from(await r.arrayBuffer()).equals(Buffer.from("no")),
       `${r.status} ${r.headers.get("content-type")} ${r.headers.get("content-range")}`);
    r = await fetch(fake.url + "/song.mp3", { headers: { Range: "bytes=0-1" } });
    ok("GET /hub/score/song.mp3 still serves from audio/",
       r.status === 206 && Buffer.from(await r.arrayBuffer()).equals(Buffer.from("no")));

    const firstId = job.id;
    r = await fetch(fake.url + "/song.mp3?generate", { method: "POST" });
    body = await json(r);
    ok("generating again is accepted", r.status === 202, JSON.stringify(body));
    job = await waitDone(fake.url, "song.score", { minVersion: 2, afterId: firstId });
    ok("a second generate bumps the version", job && job.status === "done" && job.version === 2, JSON.stringify(job));
    row = (await json(await fetch(fake.url + "/?json"))).paths.find(p => p.name === "song.score");
    ok("the listing shows v2", row && row.version === 2, JSON.stringify(row));

    r = await fetch(fake.url + "/notes.txt?generate", { method: "POST" });
    ok("POST ?generate on a non-mp3 is 400", r.status === 400 && /mp3/i.test(await text(r)), String(r.status));
    r = await fetch(fake.url + "/missing.mp3?generate", { method: "POST" });
    ok("POST ?generate without a prior upload is 400", r.status === 400, String(r.status));
  }

  /* ---- generate: same score in flight is 409; different names queue ------ */
  {
    const slow = await startHub({ LIMELIGHT_SCORE_BUILDER_DELAY_MS: "400" });
    try {
      const json = async r => JSON.parse(await r.text());
      const text = async r => await r.text();
      await fetch(slow.url + "/a.mp3", { method: "PUT", body: Buffer.from("a") });
      await fetch(slow.url + "/b.mp3", { method: "PUT", body: Buffer.from("b") });
      let r = await fetch(slow.url + "/a.mp3?generate", { method: "POST" });
      ok("slow generate starts", r.status === 202, await text(r));
      r = await fetch(slow.url + "/a.mp3?generate", { method: "POST" });
      ok("a second generate for the same score while in flight is 409",
         r.status === 409 && /already/i.test(await text(r)), String(r.status));
      r = await fetch(slow.url + "/b.mp3?generate", { method: "POST" });
      const body = await json(r);
      ok("a different mp3 is queued", r.status === 202 && body.job.status === "queued", JSON.stringify(body));
      const wait = async name => {
        for (let i = 0; i < 80; i++) {
          const info = await json(await fetch(slow.url + "/?jobs"));
          const job = (info.jobs || []).find(j => j.score_name === name);
          if (job && job.status === "done") return job;
          await new Promise(x => setTimeout(x, 50));
        }
        return null;
      };
      const a = await wait("a.score"), b = await wait("b.score");
      ok("both queued jobs complete", a && a.version === 1 && b && b.version === 1, JSON.stringify({ a, b }));
    } finally {
      await slow.close();
    }
  }

  await fake.close();

  for (const [pass, name, detail] of out)
    console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
  const bad = out.filter(r => !r[0]).length;
  console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
