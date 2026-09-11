# Score push / pull Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `limelight push <file.score>` uploads a score to a shared folder on the LAN; `limelight pull <name.score>` downloads it into the current directory.

**Architecture:** A dependency-free Node CLI (`limelight`, repo root) that parses argv and prints messages, over one backend module (`cli/remote.js`) exposing `list / put / get / size`. The backend is picked by the URL scheme of `LIMELIGHT_REMOTE`; today `http(s):` means a dufs file server and speaks exactly the requests its web UI makes (`GET ?json`, `MKCOL`, `PUT`, `GET`, `HEAD`). Tests run the CLI as a child process against a fake dufs on 127.0.0.1, never against the shared server.

**Tech Stack:** Node ≥ 18 (built-in `fetch`, `http`, `fs`, `child_process`). No npm packages. Spec: `docs/superpowers/specs/2026-09-12-score-push-pull-design.md`.

---

## File structure

| file | responsibility |
|---|---|
| `cli/remote.js` | `openRemote(url)` → backend chosen by scheme. dufs backend: URL building, the five HTTP calls, error classes. Knows nothing about argv or files on disk. |
| `cli/fake-dufs.js` | Test double: an in-memory dufs on 127.0.0.1 with dufs's status codes. Used only by the test. |
| `cli/remote.test.js` | Runs the real CLI as a child process against the fake. Checks messages, bytes, exit codes. Same `ok()` harness style as `protocol/session.test.js`. |
| `limelight` | The command. argv → `push` / `pull`, local file checks, messages, exit codes. Executable, `#!/usr/bin/env node`. |
| `README.md` | A short "Sharing scores" section. |

Exit codes (from the spec): `0` ok · `1` usage / bad input / name not on server · `2` remote unreachable or errored.

---

### Task 1: The fake dufs server (test double)

**Files:**
- Create: `cli/fake-dufs.js`

- [ ] **Step 1: Write the fake**

```js
/* An in-memory dufs, for the test. Speaks exactly the subset of dufs 0.46 the
   web UI uses -- GET ?json to list, MKCOL for a folder, PUT to upload, GET and
   HEAD for a file -- with dufs's own status codes, so the CLI cannot tell it
   from the real thing on 192.168.1.42. Everything is served under /score. */
"use strict";
const http = require("http");

function fakeDufs() {
  const files = new Map();          /* name -> Buffer */
  let folder = false;               /* has /score been created */
  const log = [];                   /* "METHOD /path" per request, for assertions */

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://fake");
    log.push(`${req.method} ${u.pathname}${u.search}`);
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const end = (code, headers, out) => { res.writeHead(code, headers || {}); res.end(out); };
      if (u.pathname !== "/score" && !u.pathname.startsWith("/score/")) return end(404);
      const name = decodeURIComponent(u.pathname.slice("/score".length).replace(/^\//, ""));

      if (req.method === "MKCOL") {
        if (folder) return end(405);                       /* dufs: already exists */
        folder = true; return end(201);
      }
      if (name === "" && u.searchParams.has("json")) {
        if (!folder) return end(404);
        const paths = [...files].map(([n, b]) => ({ path_type: "File", name: n, size: b.length, mtime: 0 }));
        return end(200, { "content-type": "application/json" }, JSON.stringify({ href: "/score/", kind: "Index", paths }));
      }
      if (req.method === "PUT") {
        folder = true;                                       /* dufs creates parents on PUT */
        files.set(name, body); return end(201);
      }
      const b = files.get(name);
      if (req.method === "HEAD") return b ? end(200, { "content-length": String(b.length) }) : end(404);
      if (req.method === "GET")  return b ? end(200, { "content-length": String(b.length) }, b) : end(404);
      end(405);
    });
  });

  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve({
    url: `http://127.0.0.1:${server.address().port}/score`,
    files, log,
    get folder() { return folder; },
    close: () => new Promise(r => server.close(r)),
  })));
}

module.exports = { fakeDufs };
```

- [ ] **Step 2: Smoke it by hand**

Run:
```bash
node -e "require('./cli/fake-dufs.js').fakeDufs().then(async f=>{const r=await fetch(f.url+'/?json');console.log(r.status);const p=await fetch(f.url+'/a.score',{method:'PUT',body:'x'});console.log(p.status,(await (await fetch(f.url+'/?json')).json()).paths);await f.close()})"
```
Expected: `404`, then `201 [ { path_type: 'File', name: 'a.score', size: 1, mtime: 0 } ]`

- [ ] **Step 3: Commit**

```bash
git add cli/fake-dufs.js
git commit -m "A dufs the tests can hit without touching the shared one"
```

---

### Task 2: The remote backend, driven by a failing test

**Files:**
- Create: `cli/remote.js`
- Create: `cli/remote.test.js`

- [ ] **Step 1: Write the test file with the backend checks only**

```js
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
```

- [ ] **Step 2: Run it, expect the require to fail**

Run: `node cli/remote.test.js`
Expected: `Error: Cannot find module './remote.js'`

- [ ] **Step 3: Write the backend**

```js
/* The seam between the commands and wherever scores live.
   ---------------------------------------------------------------------------
   openRemote(url) looks at the scheme and hands back { list, put, get, size }.
   Today the only backend is dufs -- the file server on the LAN -- and it makes
   exactly the requests the dufs web UI makes, observed with Playwright:

     GET  <base>/?json          list the folder     -> { paths: [{ name, path_type, size }] }
     MKCOL <base>               create the folder   -> 201, or 405 when it already exists
     PUT  <base>/<name>         upload, raw bytes    -> 201 (overwrites)
     GET  <base>/<name>         download
     HEAD <base>/<name>         content-length, to check an upload landed whole

   Cloud storage later is another function here and one more case in the
   switch. The commands never learn which one they are talking to. */
"use strict";

const DEFAULT_REMOTE = "http://192.168.1.42:5000/score";

class RemoteError extends Error {}
class NotFound extends RemoteError {}
class Unreachable extends RemoteError {}

function openRemote(url) {
  const scheme = new URL(url).protocol;
  switch (scheme) {
    case "http:": case "https:": return dufs(url);
    default: throw new RemoteError(`no backend for ${scheme}// remotes yet (LIMELIGHT_REMOTE=${url})`);
  }
}

function dufs(base) {
  base = base.replace(/\/+$/, "");
  /* the same URL the web UI builds: base, slash, each segment encoded */
  const fileUrl = name => base + "/" + name.split("/").map(encodeURIComponent).join("/");

  async function call(method, url, body) {
    try {
      return await fetch(url, { method, body });
    } catch (e) {
      throw new Unreachable(`cannot reach ${base} — is the server up? Override with LIMELIGHT_REMOTE=<url>`);
    }
  }
  async function fail(method, url, res) {
    const line = (await res.text().catch(() => "")).split("\n")[0].trim().slice(0, 200);
    throw new RemoteError(`${method} ${url} → ${res.status} ${res.statusText}${line ? " — " + line : ""}`);
  }

  let folderExists = false;

  async function list() {
    const url = base + "/?json";
    const res = await call("GET", url);
    if (res.status === 404) return [];
    if (!res.ok) await fail("GET", url, res);
    folderExists = true;
    const data = await res.json();
    return (data.paths || []).filter(p => p.path_type === "File").map(p => p.name);
  }

  async function ensureFolder() {
    if (folderExists) return;
    const probe = await call("GET", base + "/?json");
    if (probe.ok) { folderExists = true; return; }
    const res = await call("MKCOL", base);
    if (!res.ok && res.status !== 405) await fail("MKCOL", base, res);
    folderExists = true;
  }

  async function put(name, bytes) {
    await ensureFolder();
    const url = fileUrl(name);
    const res = await call("PUT", url, bytes);
    if (!res.ok) await fail("PUT", url, res);
  }

  async function get(name) {
    const url = fileUrl(name);
    const res = await call("GET", url);
    if (res.status === 404) throw new NotFound(`${name} is not on ${base}`);
    if (!res.ok) await fail("GET", url, res);
    return Buffer.from(await res.arrayBuffer());
  }

  async function size(name) {
    const url = fileUrl(name);
    const res = await call("HEAD", url);
    if (res.status === 404) return null;
    if (!res.ok) await fail("HEAD", url, res);
    const n = Number(res.headers.get("content-length"));
    return Number.isFinite(n) ? n : null;
  }

  return { base, url: fileUrl, list, put, get, size };
}

module.exports = { openRemote, DEFAULT_REMOTE, RemoteError, NotFound, Unreachable };
```

- [ ] **Step 4: Run the test, expect all backend checks to pass**

Run: `node cli/remote.test.js`
Expected: every line `pass`, ending `all 15 checks pass`

- [ ] **Step 5: Commit**

```bash
git add cli/remote.js cli/remote.test.js
git commit -m "A remote is a URL; the scheme picks who answers"
```

---

### Task 3: The CLI — push

**Files:**
- Create: `limelight`
- Modify: `cli/remote.test.js` (add the push block before `await fake.close()`)

- [ ] **Step 1: Add the push checks to the test**

Insert immediately before the line `await fake.close();`:

```js
  /* ---- limelight push ----------------------------------------------------- */
  {
    fake.files.clear();
    const dir = scratch();
    fs.writeFileSync(path.join(dir, "levels.score"), SCORE);
    fs.writeFileSync(path.join(dir, "notes.txt"), "hello");

    let r = run([], fake.url, dir);
    ok("no arguments prints usage and exits 1", r.code === 1 && /usage/.test(r.err), r.err);

    r = run(["push"], fake.url, dir);
    ok("push with no file prints usage and exits 1", r.code === 1 && /usage/.test(r.err), r.err);

    r = run(["push", "notes.txt"], fake.url, dir);
    ok("push refuses a file that is not .score", r.code === 1 && /\.score/.test(r.err), r.err);
    ok("and sends nothing", !fake.files.has("notes.txt"));

    r = run(["push", "missing.score"], fake.url, dir);
    ok("push refuses a file that does not exist", r.code === 1 && /no such file/.test(r.err), r.err);

    r = run(["push", "levels.score"], fake.url, dir);
    ok("push uploads a .score", r.code === 0 && fake.files.get("levels.score").equals(SCORE), r.err);
    ok("and says where it went and how big",
       r.out.trim() === `pushed levels.score → ${fake.url}/levels.score (${SCORE.length} bytes)`, r.out);

    fs.writeFileSync(path.join(dir, "levels.score"), "{}");
    r = run(["push", path.join(dir, "levels.score")], fake.url, dir);
    ok("push accepts a path and uses the basename, overwriting",
       r.code === 0 && fake.files.get("levels.score").toString() === "{}", r.err);

    r = run(["push", "levels.score"], "http://127.0.0.1:9/score", dir);
    ok("an unreachable remote exits 2", r.code === 2 && /cannot reach/.test(r.err), r.err);
    ok("and the error names the override", /LIMELIGHT_REMOTE/.test(r.err));
  }
```

- [ ] **Step 2: Run the test, expect the push block to fail**

Run: `node cli/remote.test.js`
Expected: the backend checks pass, then several `FAIL` lines in the push block (the CLI does not exist yet, `spawnSync` returns a non-zero status and no output).

- [ ] **Step 3: Write the CLI with push only**

Create `limelight` at the repo root:

```js
#!/usr/bin/env node
/* limelight -- the command.
   ---------------------------------------------------------------------------
     limelight push <path/to/file.score>   upload to the shared score folder
     limelight pull <name.score>           download into the current directory

   The folder is LIMELIGHT_REMOTE, a URL; the scheme picks the backend in
   cli/remote.js. This file only knows about argv, files on disk, and what to
   say. Exit codes: 0 done, 1 usage or bad input or not on the server,
   2 the remote could not be reached or refused. */
"use strict";
const fs = require("fs"), path = require("path");
const { openRemote, DEFAULT_REMOTE, NotFound, RemoteError } = require("./cli/remote.js");

const REMOTE = process.env.LIMELIGHT_REMOTE || DEFAULT_REMOTE;
const USAGE = `usage:
  limelight push <path/to/file.score>   upload to the shared score folder (overwrites)
  limelight pull <name.score>           download into the current directory

remote: ${REMOTE}   (override with LIMELIGHT_REMOTE=<url>)`;

/* a deliberate exit with a message: thrown, so every path out goes through main */
class Exit extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const usage = () => { throw new Exit(1, USAGE); };

async function push(remote, file) {
  if (!file) usage();
  if (!file.endsWith(".score")) throw new Exit(1, `${file}: a score file ends in .score`);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Exit(1, `${file}: no such file`);
  const bytes = fs.readFileSync(file);
  const name = path.basename(file);
  await remote.put(name, bytes);
  /* a truncated upload that reports success is the expensive kind of failure */
  const held = await remote.size(name);
  if (held !== bytes.length)
    throw new Exit(2, `uploaded ${bytes.length} bytes but the server holds ${held === null ? "nothing" : held} — push again`);
  console.log(`pushed ${name} → ${remote.url(name)} (${bytes.length} bytes)`);
}

const COMMANDS = { push };

async function main(argv) {
  const [cmd, arg] = argv;
  if (!COMMANDS[cmd]) usage();
  const remote = openRemote(REMOTE);
  await COMMANDS[cmd](remote, arg);
}

main(process.argv.slice(2)).catch(e => {
  if (e instanceof Exit) { console.error(e.message); process.exit(e.code); }
  if (e instanceof RemoteError) { console.error(e.message); process.exit(2); }
  console.error(e && e.stack || e);            /* a bug: show all of it, never a blank */
  process.exit(2);
});
```

Then make it executable:
```bash
chmod +x limelight
```

- [ ] **Step 4: Run the test, expect the push block to pass**

Run: `node cli/remote.test.js`
Expected: every line `pass`, ending `all 26 checks pass`

- [ ] **Step 5: Commit**

```bash
git add limelight cli/remote.test.js
git commit -m "limelight push: a score goes to the shared folder, and we check it landed whole"
```

---

### Task 4: The CLI — pull

**Files:**
- Modify: `limelight` (add `pull`, register it)
- Modify: `cli/remote.test.js` (add the pull block before `await fake.close()`)

- [ ] **Step 1: Add the pull checks to the test**

Insert immediately before the line `await fake.close();`:

```js
  /* ---- limelight pull ----------------------------------------------------- */
  {
    fake.files.clear();
    fake.files.set("levels.score", SCORE);
    fake.files.set("The Nights.score", Buffer.from("n"));
    const dir = scratch();

    let r = run(["pull"], fake.url, dir);
    ok("pull with no name prints usage and exits 1", r.code === 1 && /usage/.test(r.err), r.err);

    r = run(["pull", "levels.score"], fake.url, dir);
    ok("pull writes the file into the current directory",
       r.code === 0 && fs.readFileSync(path.join(dir, "levels.score")).equals(SCORE), r.err);
    ok("and says where it came from",
       r.out.trim() === `pulled levels.score ← ${fake.url}/levels.score (${SCORE.length} bytes)`, r.out);

    r = run(["pull", "some/dir/levels.score"], fake.url, dir);
    ok("pull strips any directory part from the name", r.code === 0, r.err);

    r = run(["pull", "The Nights.score"], fake.url, dir);
    ok("pull handles a name with a space", r.code === 0 && fs.existsSync(path.join(dir, "The Nights.score")), r.err);

    r = run(["pull", "nope.score"], fake.url, dir);
    ok("pull of a missing name exits 1", r.code === 1, r.err);
    ok("and lists what the server does have",
       /levels\.score/.test(r.err) && /The Nights\.score/.test(r.err), r.err);
    ok("and writes nothing locally", !fs.existsSync(path.join(dir, "nope.score")));

    r = run(["pull", "levels.score"], "http://127.0.0.1:9/score", dir);
    ok("pull from an unreachable remote exits 2", r.code === 2 && /cannot reach/.test(r.err), r.err);
  }
```

- [ ] **Step 2: Run the test, expect the pull block to fail**

Run: `node cli/remote.test.js`
Expected: push checks pass; the pull block fails with exit 1 and `usage` in stderr (pull is not a command yet).

- [ ] **Step 3: Add pull to the CLI**

In `limelight`, insert after the `push` function:

```js
async function pull(remote, arg) {
  if (!arg) usage();
  const name = path.basename(arg);            /* a name, never a path */
  let bytes;
  try {
    bytes = await remote.get(name);
  } catch (e) {
    if (!(e instanceof NotFound)) throw e;
    /* the miss is the listing: say what is there instead */
    const names = await remote.list();
    const have = names.length ? `on the server:\n${names.map(n => "  " + n).join("\n")}`
                              : "the server has no scores yet";
    throw new Exit(1, `${name} is not on ${remote.base}\n${have}`);
  }
  fs.writeFileSync(path.join(process.cwd(), name), bytes);
  console.log(`pulled ${name} ← ${remote.url(name)} (${bytes.length} bytes)`);
}
```

and change the command table to:

```js
const COMMANDS = { push, pull };
```

- [ ] **Step 4: Run the test, expect everything to pass**

Run: `node cli/remote.test.js`
Expected: every line `pass`, ending `all 35 checks pass`

- [ ] **Step 5: Commit**

```bash
git add limelight cli/remote.test.js
git commit -m "limelight pull: a name comes back as a file, and a miss tells you what is there"
```

---

### Task 5: Documentation and the first real push

**Files:**
- Modify: `README.md` (append a section)

- [ ] **Step 1: Document the commands**

Append to `README.md`:

```markdown
## Sharing scores

Scores live in one folder everyone on the network can read. Today that is a
dufs file server at `http://192.168.1.42:5000/score`; anyone can host the
same with `dufs -A -b 0.0.0.0 -p 5000 <dir>` and point `LIMELIGHT_REMOTE`
at it. Cloud storage later is a new backend in `cli/remote.js`, not a new
command.

```
./limelight push protocol/levels.score      # upload under its basename, overwriting
./limelight pull levels.score               # download into the current directory
LIMELIGHT_REMOTE=http://host:5000/score ./limelight pull levels.score
```

A pull of a name that is not there prints the names that are. `push` checks
the server holds exactly the bytes it sent. `node cli/remote.test.js` runs
both commands against a fake server and never touches the shared one.
```

- [ ] **Step 2: Run everything that can be affected**

Run:
```bash
node cli/remote.test.js && node protocol/session.test.js
```
Expected: `all 35 checks pass` then `all 19 checks pass`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Say how a score is shared"
```

- [ ] **Step 4: The one real push (by hand, once, creates the folder on the shared server)**

Run:
```bash
cp protocol/score.levels.json /tmp/levels.score && ./limelight push /tmp/levels.score && ./limelight pull levels.score && cmp levels.score protocol/score.levels.json && rm levels.score
```
Expected:
```
pushed levels.score → http://192.168.1.42:5000/score/levels.score (487 bytes)
pulled levels.score ← http://192.168.1.42:5000/score/levels.score (487 bytes)
```
and `cmp` prints nothing. Then open `http://192.168.1.42:5000/score/` in a browser and confirm the file is listed. If `MKCOL` returned something other than 201/405 on the real server, the push says so with the status; report it rather than working around it.

---

## Self-review

**Spec coverage:** commands and messages (Tasks 3, 4) · extension-only check and silent overwrite (Task 3) · size check after push (Task 3) · miss doubles as listing (Task 4) · env var with default and scheme dispatch (Task 2) · dufs requests mirror the web UI (Task 2, Task 1 fake) · error classes and exit codes 1/2 (Tasks 2–4) · tests never touch the shared server, one real push by hand (Task 5) · README and the self-hosting one-liner (Task 5). Nothing in the spec lacks a task.

**Type consistency:** `openRemote(url)` returns `{ base, url(name), list(), put(name, bytes), get(name), size(name) }` and every use in `limelight` and the test matches. Error classes `RemoteError`, `NotFound`, `Unreachable` are exported from `cli/remote.js` and imported by the same names. `fakeDufs()` resolves `{ url, files, log, folder, close }` and the test uses only those.
