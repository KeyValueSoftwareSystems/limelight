# Score versions and author metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every `.score` in the hub keeps every version it was uploaded as, any version can carry a JSON object of author metadata, and a download folds that metadata into the file under `author_metadata`.

**Architecture:** A new `hub/versions.py` owns the on-disk version store (a hidden `.versions/<name>/N.score` and `N.meta.json` beside each `.score`, with the top-level file kept as a copy of the latest). `hub/hub.py` routes query strings on the existing file URL (`?v`, `?raw`, `?versions`, `?meta`) to it and hides `.versions` from listings and URLs. `cli/remote.js` gains an optional version on `get`, returns the upload reply, and can fetch the history; `limelight` understands `pull name@N`. The page lists versions per `.score` row with a download link and an inline JSON editor.

**Tech Stack:** Python 3 stdlib (`json`, `os`), Node ≥ 18 built-ins. No packages. Spec: `docs/superpowers/specs/2026-09-12-score-versions-metadata-design.md`. Tests: `node cli/remote.test.js`, which starts a private `serve.py`.

---

## File structure

| file | responsibility |
|---|---|
| `hub/versions.py` (new) | The version store. Pure functions on a file path: `is_versioned`, `store`, `numbers`, `latest`, `resolve_version`, `read`, `history`, `get_meta`, `set_meta`. Knows nothing about HTTP. |
| `hub/hub.py` (modify) | Routes `?v` / `?raw` / `?versions` / `?meta` to the store, hides `.versions`, adds `version` and `has_metadata` to listing rows. |
| `hub/hub.html` (modify) | Version badge, versions toggle, per-version download and inline metadata editor. |
| `cli/remote.js` (modify) | `get(name, version)`, `put` returns the reply object, new `versions(name)`. |
| `limelight` (modify) | `pull name@N`; push message shows the version. |
| `cli/remote.test.js` (modify) | Hub versions/metadata block and CLI checks. |
| `README.md` (modify) | Versions and metadata in the "Sharing scores" section. |

---

### Task 1: The version store, and versioned upload/download in the hub

**Files:**
- Create: `hub/versions.py`
- Modify: `hub/hub.py`
- Modify: `cli/remote.test.js` (new block before the `/* ---- limelight push` block)

- [ ] **Step 1: Add the failing hub checks to the test**

Insert immediately before the line `  /* ---- limelight push ----------------------------------------------------- */`:

```js
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

```

- [ ] **Step 2: Run the test, expect the new block to fail**

Run: `node cli/remote.test.js 2>&1 | grep -E "FAIL|all .* pass"`
Expected: several `FAIL` lines in the versions block (the first upload returns a text body, so `json()` throws or `.version` is undefined; `.versions` is not hidden; `?versions` is a 404).

- [ ] **Step 3: Write the store**

Create `hub/versions.py`:

```python
"""The version store: every .score keeps every version it was uploaded as.

On disk, beside the file:

    score/levels.score                         a copy of the latest version's bytes
    score/.versions/levels.score/1.score       version 1, exactly as uploaded
    score/.versions/levels.score/2.score
    score/.versions/levels.score/2.meta.json   author metadata for version 2, once somebody adds it

The top-level copy is what keeps every plain GET, the listing, `limelight pull`
and any dufs client working with no idea versions exist. Nothing in here knows
about HTTP; hub.py asks these functions and answers the request.
"""
import json, os

VDIR = ".versions"
EXT = ".score"
META = ".meta.json"


def is_versioned(path):
    return path.endswith(EXT)


def _store(path):
    return os.path.join(os.path.dirname(path), VDIR, os.path.basename(path))


def _write(path, data):
    # Write beside, then rename: a reader never sees half a file.
    tmp = path + ".uploading"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def _dump(obj):
    # The formatting of protocol/score.levels.json.
    return json.dumps(obj, indent=1, ensure_ascii=False).encode("utf-8")


def version_path(path, n):
    return os.path.join(_store(path), f"{n}{EXT}")


def meta_path(path, n):
    return os.path.join(_store(path), f"{n}{META}")


def numbers(path):
    """Every version number present, ascending. [] for a file with no history."""
    d = _store(path)
    if not os.path.isdir(d):
        return []
    return sorted(int(f[:-len(EXT)]) for f in os.listdir(d)
                  if f.endswith(EXT) and f[:-len(EXT)].isdigit())


def latest(path):
    ns = numbers(path)
    return ns[-1] if ns else None


def store(path, data):
    """Write data as the next version and copy it to the top level. Returns N."""
    os.makedirs(_store(path), exist_ok=True)
    n = (latest(path) or 0) + 1
    _write(version_path(path, n), data)
    _write(path, data)
    return n


def resolve_version(path, v):
    """A query value ('' or None for latest, else digits) -> an existing N, or KeyError."""
    if v in (None, ""):
        n = latest(path)
    elif str(v).isdigit():
        n = int(v)
    else:
        raise KeyError(v)
    if n is None or not os.path.isfile(version_path(path, n)):
        raise KeyError(v)
    return n


def parse_object(data):
    """bytes -> dict when the bytes are a JSON object, else None."""
    try:
        obj = json.loads(data)
    except ValueError:
        return None
    return obj if isinstance(obj, dict) else None


def get_meta(path, n):
    """The stored metadata object for version n, or None when none was added."""
    p = meta_path(path, n)
    if not os.path.isfile(p):
        return None
    with open(p, "rb") as f:
        return json.load(f)


def set_meta(path, n, data):
    """Store metadata for version n. Raises ValueError with the reason when the
    body is not a JSON object; nothing is written in that case."""
    try:
        obj = json.loads(data)
    except ValueError as e:
        raise ValueError(f"metadata is not JSON: {e}")
    if not isinstance(obj, dict):
        raise ValueError("metadata must be a JSON object")
    _write(meta_path(path, n), _dump(obj))
    return obj


def read(path, n, raw=False):
    """The bytes of version n. Unless raw, metadata is folded in under
    author_metadata -- but only when there is metadata and the file is a JSON
    object; otherwise the uploaded bytes come back exactly."""
    with open(version_path(path, n), "rb") as f:
        data = f.read()
    if raw:
        return data
    meta = get_meta(path, n)
    if meta is None:
        return data
    obj = parse_object(data)
    if obj is None:
        return data
    obj["author_metadata"] = meta
    return _dump(obj)


def history(path):
    out = []
    for n in numbers(path):
        vp = version_path(path, n)
        st = os.stat(vp)
        with open(vp, "rb") as f:
            mergeable = parse_object(f.read()) is not None
        out.append({"version": n, "size": st.st_size, "mtime": int(st.st_mtime * 1000),
                    "has_metadata": os.path.isfile(meta_path(path, n)), "mergeable": mergeable})
    return {"name": os.path.basename(path), "latest": latest(path), "versions": out}
```

- [ ] **Step 4: Route the hub to the store**

In `hub/hub.py`, replace the module docstring's request table and everything from `import json, os, urllib.parse` to the end with:

```python
import json, os, urllib.parse
from . import versions as V

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.environ.get("HUB_ROOT", os.path.join(HERE, "files")))
PAGE = os.path.join(HERE, "hub.html")
PREFIX = "/hub"
os.makedirs(ROOT, exist_ok=True)   # a fresh clone has no hub/files/ yet; without this, /hub/ is a 404


def resolve(urlpath):
    """URL path -> absolute path under ROOT, or None when it tries to leave or
    reaches for the version store, which is only addressable through the API."""
    rel = urllib.parse.unquote(urlpath[len(PREFIX):]).lstrip("/")
    if V.VDIR in rel.split("/"):
        return None
    path = os.path.normpath(os.path.join(ROOT, rel)) if rel else ROOT
    if path != ROOT and not path.startswith(ROOT + os.sep):
        return None
    return path


def _send(h, code, body=b"", ctype="text/plain; charset=utf-8", head_only=False, extra=()):
    if isinstance(body, str):
        body = body.encode("utf-8")
    h.send_response(code)
    h.send_header("Content-Type", ctype)
    h.send_header("Content-Length", str(len(body)))
    h.send_header("Cache-Control", "no-store")
    for k, v in extra:
        h.send_header(k, v)
    h.end_headers()
    if not head_only:
        h.wfile.write(body)


def _json(h, code, obj, head_only=False):
    _send(h, code, json.dumps(obj), "application/json", head_only)


def _read_body(h):
    """The whole request body, or None when there is no usable Content-Length."""
    length = h.headers.get("Content-Length")
    if length is None:
        return None
    remaining, chunks = int(length), []
    while remaining > 0:
        chunk = h.rfile.read(min(remaining, 1 << 20))
        if not chunk:
            return None
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def _listing(urlpath, path):
    entries = []
    names = [n for n in os.listdir(path) if n != V.VDIR]
    for name in sorted(names, key=lambda n: (not os.path.isdir(os.path.join(path, n)), n.lower())):
        full = os.path.join(path, name)
        st = os.stat(full)
        row = {
            "path_type": "Dir" if os.path.isdir(full) else "File",
            "name": name,
            "mtime": int(st.st_mtime * 1000),
            "size": 0 if os.path.isdir(full) else st.st_size,
        }
        if row["path_type"] == "File" and V.is_versioned(full):
            n = V.latest(full)
            row["version"] = n
            row["has_metadata"] = bool(n) and V.get_meta(full, n) is not None
        entries.append(row)
    return json.dumps({"href": urlpath, "kind": "Index", "allow_upload": True,
                       "allow_delete": False, "paths": entries})


def _send_file(h, path, head):
    size = os.path.getsize(path)
    h.send_response(200)
    h.send_header("Content-Type", "application/octet-stream")
    h.send_header("Content-Length", str(size))
    h.send_header("Cache-Control", "no-store")
    h.end_headers()
    if not head:
        with open(path, "rb") as f:
            while True:
                chunk = f.read(1 << 20)
                if not chunk:
                    break
                h.wfile.write(chunk)


def _versioned_get(h, path, query, head):
    """GET/HEAD on a .score that has a history: ?versions, ?meta, ?v, ?raw."""
    if "versions" in query:
        return _json(h, 200, V.history(path), head)
    v = query.get("v", [""])[0]
    try:
        n = V.resolve_version(path, v)
    except KeyError:
        return _send(h, 404, f"no version {v or 'latest'} of {os.path.basename(path)}", head_only=head)
    if "meta" in query:
        return _json(h, 200, V.get_meta(path, n) or {}, head)
    return _send(h, 200, V.read(path, n, raw="raw" in query), "application/octet-stream", head)


VERSION_QUERIES = ("v", "raw", "versions", "meta")


def handle(h, method):
    parsed = urllib.parse.urlparse(h.path)
    path = resolve(parsed.path)
    if path is None:
        return _send(h, 403, "that path is not reachable")
    query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
    versioned = os.path.basename(path) != "" and V.is_versioned(path)

    if method == "MKCOL":
        if os.path.exists(path):
            return _send(h, 405, "already exists")
        os.makedirs(path)
        return _send(h, 201, "created")

    if method == "PUT":
        if os.path.isdir(path) or path == ROOT:
            return _send(h, 405, "that is a folder")
        body = _read_body(h)
        if body is None:
            return _send(h, 411, "Content-Length required, and the body must be complete")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if versioned and "meta" in query:
            try:
                n = V.resolve_version(path, query.get("v", [""])[0])
            except KeyError:
                return _send(h, 404, f"no version {query.get('v', [''])[0] or 'latest'} of {os.path.basename(path)}")
            try:
                V.set_meta(path, n, body)
            except ValueError as e:
                return _send(h, 400, str(e))
            return _send(h, 204)
        if versioned:
            n = V.store(path, body)
            return _json(h, 201, {"name": os.path.basename(path), "version": n})
        tmp = path + ".uploading"
        with open(tmp, "wb") as f:
            f.write(body)
        os.replace(tmp, path)
        return _send(h, 201, "created")

    if method in ("GET", "HEAD"):
        head = method == "HEAD"
        if os.path.isdir(path):
            if "json" in query:
                return _send(h, 200, _listing(parsed.path, path), "application/json", head)
            if not parsed.path.endswith("/"):
                return _send(h, 301, "", head_only=True, extra=[("Location", parsed.path + "/")])
            with open(PAGE, "rb") as f:
                return _send(h, 200, f.read(), "text/html; charset=utf-8", head)
        asks_versions = any(q in query for q in VERSION_QUERIES)
        if asks_versions and not versioned:
            return _send(h, 400, "not a versioned file: only .score files keep versions", head_only=head)
        if versioned and V.numbers(path):
            return _versioned_get(h, path, query, head)
        if os.path.isfile(path):
            if asks_versions and "versions" in query:
                return _json(h, 200, V.history(path), head)      # a .score uploaded before versioning existed
            return _send_file(h, path, head)
        return _send(h, 404, "no " + parsed.path, head_only=head)

    return _send(h, 405, method + " is not something the hub does")
```

And update the docstring table at the top of `hub/hub.py` to read:

```
    GET   /hub/<dir>/?json        list           -> { paths: [{ name, path_type, size, mtime, version?, has_metadata? }] }
    GET   /hub/<dir>/             the page
    MKCOL /hub/<dir>              new folder     -> 201, or 405 when it already exists
    PUT   /hub/<dir>/<name>       upload, raw body, parents created  -> 201 (overwrites)
                                  a .score becomes a new version: 201 {"name","version"}
    GET   /hub/<dir>/<name>       download (a .score: the latest, with author metadata folded in)
    HEAD  /hub/<dir>/<name>       content-length, so a push can check it landed whole

    .score files only, on the same URL (hub/versions.py):
    GET   ...?versions            -> { latest, versions: [{ version, size, mtime, has_metadata, mergeable }] }
    GET   ...?v=N[&raw]           version N; raw skips the metadata merge
    GET   ...?meta[&v=N]          the metadata object, {} when none
    PUT   ...?meta[&v=N]          store metadata; body must be a JSON object -> 204, else 400
```

Note `from . import versions as V` requires `hub` to be imported as a package, which `serve.py` already does with `from hub import hub`.

- [ ] **Step 5: Run the test, expect the versions block to pass**

Run: `node cli/remote.test.js 2>&1 | grep -E "FAIL|all .* pass"`
Expected: `all 59 checks pass`

- [ ] **Step 6: Commit**

```bash
git add hub/versions.py hub/hub.py cli/remote.test.js
git commit -m "A score keeps every version it was uploaded as"
```

---

### Task 2: Author metadata, folded into the download

**Files:**
- Modify: `cli/remote.test.js` (new block after the versions block, before `/* ---- limelight push`)

The store and routes were written in Task 1; this task proves them and fixes whatever the proof finds.

- [ ] **Step 1: Add the failing metadata checks**

Insert immediately before the line `  /* ---- limelight push ----------------------------------------------------- */`:

```js
  /* ---- author metadata: added to a version, folded into its download -------- */
  {
    fake.files.clear();
    const url = fake.url + "/m.score";
    const v1 = Buffer.from('{"score":"m","version":1,"grid":{"bpm":100}}');
    const v2 = Buffer.from('{"score":"m","version":2,"grid":{"bpm":110}}');
    const put = (u, body) => fetch(u, { method: "PUT", body });
    const text = async r => await r.text();
    await put(url, v1); await put(url, v2);
    const meta = { author: "renjith", verified_bars: [1, 33], note: "downbeats checked by ear" };

    let r = await put(url + "?meta&v=1", JSON.stringify(meta));
    ok("metadata on a version is accepted", r.status === 204, String(r.status) + " " + await text(r));
    ok("and reads back", JSON.stringify(await (await fetch(url + "?meta&v=1")).json()) === JSON.stringify(meta));
    ok("a version without metadata reads back {}", (await text(await fetch(url + "?meta&v=2"))).trim() === "{}");

    const merged = JSON.parse(await text(await fetch(url + "?v=1")));
    ok("the download of that version carries author_metadata",
       JSON.stringify(merged.author_metadata) === JSON.stringify(meta) && merged.grid.bpm === 100, JSON.stringify(merged));
    ok("?raw is the uploaded bytes exactly", Buffer.from(await (await fetch(url + "?v=1&raw")).arrayBuffer()).equals(v1));
    ok("a version without metadata downloads byte-identical", Buffer.from(await (await fetch(url + "?v=2")).arrayBuffer()).equals(v2));

    r = await put(url + "?meta", JSON.stringify({ latest: true }));
    ok("?meta with no v means the latest", r.status === 204 && (await (await fetch(url + "?meta&v=2")).json()).latest === true);
    const plain = await fetch(url);
    const body = await text(plain);
    ok("a plain GET of the latest now carries author_metadata", JSON.parse(body).author_metadata.latest === true);
    const head = await fetch(url, { method: "HEAD" });
    ok("and HEAD reports the merged length", Number(head.headers.get("content-length")) === Buffer.byteLength(body), head.headers.get("content-length") + " vs " + Buffer.byteLength(body));

    r = await put(url + "?meta&v=1", "[1,2]");
    ok("metadata that is not an object is refused", r.status === 400 && /object/.test(await text(r)));
    r = await put(url + "?meta&v=1", "not json");
    ok("metadata that is not JSON is refused with the parser's reason", r.status === 400 && /not JSON/.test(await text(r)));
    ok("and the earlier metadata is untouched", (await (await fetch(url + "?meta&v=1")).json()).author === "renjith");
    r = await put(url + "?meta&v=9", "{}");
    ok("metadata on a missing version is 404", r.status === 404);

    const hist = await (await fetch(url + "?versions")).json();
    ok("?versions shows which versions have metadata", hist.versions.map(v => v.has_metadata).join(",") === "true,true");
    const row = (await (await fetch(fake.url + "/?json")).json()).paths.find(p => p.name === "m.score");
    ok("the listing row says the latest has metadata", row.has_metadata === true, JSON.stringify(row));

    const odd = fake.url + "/odd.score";
    await put(odd, "this is not json at all");
    await put(odd + "?meta&v=1", JSON.stringify({ a: 1 }));
    ok("a .score that is not JSON downloads unchanged even with metadata", (await text(await fetch(odd))) === "this is not json at all");
    ok("and ?versions says it is not mergeable", (await (await fetch(odd + "?versions")).json()).versions[0].mergeable === false);
  }

```

- [ ] **Step 2: Run the test**

Run: `node cli/remote.test.js 2>&1 | grep -E "FAIL|all .* pass"`
Expected: `all 76 checks pass`. If a check fails, the store or the route is wrong: read the FAIL line's detail, fix `hub/versions.py` or `hub/hub.py`, and rerun. Do not adjust the check to fit.

- [ ] **Step 3: Commit**

```bash
git add cli/remote.test.js hub/versions.py hub/hub.py
git commit -m "Author metadata rides along in the download, never in the stored bytes"
```

---

### Task 3: The CLI learns versions

**Files:**
- Modify: `cli/remote.js`
- Modify: `limelight`
- Modify: `cli/remote.test.js` (extend the push block; add checks to the pull block)

- [ ] **Step 1: Add the failing CLI checks**

In the `/* ---- limelight push` block, after the line
`    ok("and says where it went and how big",` … `r.out);`
change that check to expect the version, and add one more:

```js
    ok("and says where it went, how big, and which version",
       r.out.trim() === `pushed levels.score → ${fake.url}/levels.score (${SCORE.length} bytes, v1)`, r.out);
```

In the `/* ---- limelight pull` block, immediately before its closing `  }`:

```js
    /* versions from the command line */
    const vurl = fake.url + "/lv.score";
    const a = Buffer.from('{"score":"lv","version":1}'), b = Buffer.from('{"score":"lv","version":2}');
    await fetch(vurl, { method: "PUT", body: a }); await fetch(vurl, { method: "PUT", body: b });
    await fetch(vurl + "?meta&v=2", { method: "PUT", body: JSON.stringify({ who: "me" }) });

    r = await run(["pull", "lv.score@1"], fake.url, dir);
    ok("pull name@1 writes version 1", r.code === 0 && fs.readFileSync(path.join(dir, "lv.score")).equals(a), r.err);
    ok("and says which version", /lv\.score@1 ←/.test(r.out), r.out);
    r = await run(["pull", "lv.score"], fake.url, dir);
    ok("pull without @ is the latest, merged",
       r.code === 0 && JSON.parse(fs.readFileSync(path.join(dir, "lv.score"), "utf8")).author_metadata.who === "me", r.err);
    r = await run(["pull", "lv.score@9"], fake.url, dir);
    ok("pull of a missing version exits 1 and lists the versions", r.code === 1 && /versions: 1, 2/.test(r.err), r.err);
```

- [ ] **Step 2: Run the test, expect those to fail**

Run: `node cli/remote.test.js 2>&1 | grep -E "FAIL|all .* pass"`
Expected: FAIL on "which version" (push prints no version), "pull name@1" (file `lv.score@1` not found), and "lists the versions".

- [ ] **Step 3: Extend the backend**

In `cli/remote.js`, replace the `put`, `get` functions and the `return` line of `dufs()` with:

```js
  async function put(name, bytes) {
    await ensureFolder();
    const url = fileUrl(name);
    const res = await call("PUT", url, bytes);
    if (!res.ok) await fail("PUT", url, res);
    /* our hub answers {"name","version"}; a dufs answers text. Either is fine. */
    const text = await res.text().catch(() => "");
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  async function get(name, version) {
    const url = fileUrl(name) + (version ? `?v=${version}` : "");
    const res = await call("GET", url);
    if (res.status === 404) throw new NotFound(version ? `no version ${version} of ${name} on ${base}` : `${name} is not on ${base}`);
    if (!res.ok) await fail("GET", url, res);
    return Buffer.from(await res.arrayBuffer());
  }

  /* the history of a .score: { latest, versions: [{ version, size, mtime, has_metadata, mergeable }] } */
  async function versions(name) {
    const url = fileUrl(name) + "?versions";
    const res = await call("GET", url);
    if (res.status === 404) throw new NotFound(`${name} is not on ${base}`);
    if (!res.ok) await fail("GET", url, res);
    return res.json();
  }
```

and

```js
  return { base, url: fileUrl, list, put, get, size, versions };
```

Also update the request table in the file's header comment to add:

```
     GET  <base>/<name>?v=N      one version of a .score (our hub only)
     GET  <base>/<name>?versions its history
```

- [ ] **Step 4: Extend the CLI**

In `limelight`, replace the `push` and `pull` functions with:

```js
async function push(remote, file) {
  if (!file) usage();
  /* extension check parked for now: any file goes up under its basename.
     Re-enable by uncommenting the line below. */
  // if (!file.endsWith(".score")) throw new Exit(1, `${file}: a score file ends in .score`);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Exit(1, `${file}: no such file`);
  const bytes = fs.readFileSync(file);
  const name = path.basename(file);
  const reply = await remote.put(name, bytes);
  /* a truncated upload that reports success is the expensive kind of failure */
  const held = await remote.size(name);
  if (held !== bytes.length)
    throw new Exit(2, `uploaded ${bytes.length} bytes but the server holds ${held === null ? "nothing" : held} — push again`);
  const version = reply && reply.version ? `, v${reply.version}` : "";
  console.log(`pushed ${name} → ${remote.url(name)} (${bytes.length} bytes${version})`);
}

/* "levels.score@2" -> { name: "levels.score", version: "2" }; no @digits -> latest */
function parseTarget(arg) {
  const m = /^(.+)@(\d+)$/.exec(arg);
  return m ? { name: path.basename(m[1]), version: m[2] } : { name: path.basename(arg), version: null };
}

async function pull(remote, arg) {
  if (!arg) usage();
  const { name, version } = parseTarget(arg);   /* a name, never a path */
  let bytes;
  try {
    bytes = await remote.get(name, version);
  } catch (e) {
    if (!(e instanceof NotFound)) throw e;
    if (version) {
      /* the file may exist and only the version be missing: say which versions there are */
      let hist = null;
      try { hist = await remote.versions(name); } catch (e2) { if (!(e2 instanceof NotFound)) throw e2; }
      if (hist) throw new Exit(1, `${name} has no version ${version}\nversions: ${hist.versions.map(v => v.version).join(", ")}`);
    }
    /* the miss is the listing: say what is there instead */
    const names = await remote.list();
    const have = names.length ? `on the server:\n${names.map(n => "  " + n).join("\n")}`
                              : "the server has no scores yet";
    throw new Exit(1, `${name} is not on ${remote.base}\n${have}`);
  }
  fs.writeFileSync(path.join(process.cwd(), name), bytes);
  const tag = version ? `@${version}` : "";
  console.log(`pulled ${name}${tag} ← ${remote.url(name)}${version ? `?v=${version}` : ""} (${bytes.length} bytes)`);
}
```

Update `USAGE` to:

```js
const USAGE = `usage:
  limelight push <path/to/file.score>   upload to the shared score folder (a .score becomes a new version)
  limelight pull <name.score>           download the latest into the current directory
  limelight pull <name.score>@<N>       download version N

remote: ${REMOTE}   (override with LIMELIGHT_REMOTE=<url>)`;
```

- [ ] **Step 5: Run the test, expect everything to pass**

Run: `node cli/remote.test.js 2>&1 | grep -E "FAIL|all .* pass"`
Expected: `all 80 checks pass`

Also confirm the earlier pull check "and says where it came from" still passes: its expected string has no `@` and no `?v=`, which the code above preserves when `version` is null.

- [ ] **Step 6: Commit**

```bash
git add cli/remote.js limelight cli/remote.test.js
git commit -m "limelight pull name@N, and push says which version it made"
```

---

### Task 4: The page — versions and the metadata editor

**Files:**
- Modify: `hub/hub.html`

- [ ] **Step 1: Add styles**

In `hub/hub.html`, before the closing `</style>`, add:

```css
.badge{display:inline-block;font:600 10px ui-monospace,monospace;letter-spacing:.08em;color:var(--amb);
  border:1px solid var(--line2);border-radius:4px;padding:1px 5px;margin-left:8px;vertical-align:1px}
button.small{padding:3px 9px;font:11px ui-monospace,monospace;margin-left:8px}
tr.ver td{background:#0b1018;color:var(--dim);padding-left:28px}
tr.ver td.n{color:var(--ink)} tr.ver a{color:var(--blu)} tr.ver .meta-on{color:var(--ok);margin-left:8px;font-size:11px}
tr.edit td{background:#0b1018;padding:10px 12px 12px 28px}
textarea.json{width:100%;min-height:150px;background:#05070b;color:var(--ink);border:1px solid var(--line2);
  border-radius:6px;padding:9px;font:12px/1.5 ui-monospace,monospace;resize:vertical}
.editbar{display:flex;gap:8px;align-items:center;margin-top:8px}
.editbar .err{color:var(--bad);font:11.5px ui-monospace,monospace;white-space:pre-wrap;flex:1}
.editbar .warn{color:var(--amb);font:11.5px ui-monospace,monospace;flex:1}
```

- [ ] **Step 2: Render the badge and the toggle**

In the `load()` function, replace the loop body that builds `rows` with:

```js
  for (const p of data.paths) {
    const dir = p.path_type === "Dir";
    const score = !dir && /\.score$/.test(p.name) && p.version;
    const a = dir ? `<a class="dir" href="${base}${enc(p.name)}/">${p.name}</a>`
                  : `<a href="${base}${enc(p.name)}" download>${p.name}</a>`;
    const extra = score ? `<span class="badge">v${p.version}</span>` +
      `<button class="small versions" data-name="${enc(p.name)}">versions</button>` : "";
    rows.push(`<tr data-name="${enc(p.name)}"><td class="n">${a}${extra}</td><td>${when(p.mtime)}</td><td class="r">${dir ? "" : human(p.size)}</td></tr>`);
  }
```

- [ ] **Step 3: The version list and the editor**

Before the line `$("reload").addEventListener("click", load);` add:

```js
/* ---- versions of one .score, expanded under its row ----------------------- */
const openRows = new Set();          /* names whose version list is expanded */

function rowFor(name) { return document.querySelector(`tr[data-name="${name}"]`); }
function clearUnder(name) { document.querySelectorAll(`tr[data-under="${name}"]`).forEach(tr => tr.remove()); }

async function showVersions(name) {
  clearUnder(name);
  const r = await fetch(base + name + "?versions");
  if (!r.ok) return err(`${r.status} ${r.statusText} listing versions of ${decodeURIComponent(name)}`);
  const hist = await r.json();
  let after = rowFor(name);
  for (const v of [...hist.versions].reverse()) {
    const tr = document.createElement("tr");
    tr.className = "ver"; tr.dataset.under = name; tr.dataset.version = v.version;
    tr.innerHTML = `<td class="n">v${v.version}${v.version === hist.latest ? ' <span class="badge">latest</span>' : ""}` +
      `${v.has_metadata ? '<span class="meta-on">has metadata</span>' : ""}</td>` +
      `<td>${when(v.mtime)}</td>` +
      `<td class="r"><a href="${base}${name}?v=${v.version}" download>download</a>` +
      `<button class="small edit" data-name="${name}" data-version="${v.version}" data-mergeable="${v.mergeable}">${v.has_metadata ? "edit" : "add"} metadata</button></td>`;
    after.after(tr); after = tr;
  }
}

async function openEditor(name, version, mergeable) {
  document.querySelectorAll("tr.edit").forEach(tr => tr.remove());
  const verRow = document.querySelector(`tr.ver[data-under="${name}"][data-version="${version}"]`);
  const r = await fetch(`${base}${name}?meta&v=${version}`);
  const current = r.ok ? await r.json() : {};
  const tr = document.createElement("tr");
  tr.className = "edit"; tr.dataset.under = name;
  tr.innerHTML = `<td colspan="3">` +
    `<textarea class="json" spellcheck="false">${JSON.stringify(current, null, 1).replace(/</g, "&lt;")}</textarea>` +
    `<div class="editbar"><button class="save">save</button><button class="cancel">cancel</button>` +
    `${mergeable === "false" ? '<span class="warn">this file is not a JSON object, so metadata is stored but will not be folded into downloads</span>' : '<span class="err"></span>'}</div></td>`;
  verRow.after(tr);
  const ta = tr.querySelector("textarea"), msg = tr.querySelector(".err") || tr.querySelector(".warn");
  tr.querySelector(".cancel").onclick = () => tr.remove();
  tr.querySelector(".save").onclick = async () => {
    let obj;
    try { obj = JSON.parse(ta.value); } catch (e) { msg.textContent = "not JSON: " + e.message; return; }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) { msg.textContent = "metadata must be a JSON object, like {\"author\": \"…\"}"; return; }
    const res = await fetch(`${base}${name}?meta&v=${version}`, { method: "PUT", body: JSON.stringify(obj) });
    if (!res.ok) { msg.textContent = `${res.status} ${res.statusText}: ${await res.text()}`; return; }
    tr.remove();
    await load();
  };
  ta.focus();
}

$("rows").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.classList.contains("versions")) {
    const name = b.dataset.name;
    if (openRows.has(name)) { openRows.delete(name); clearUnder(name); }
    else { openRows.add(name); showVersions(name); }
  }
  if (b.classList.contains("edit")) openEditor(b.dataset.name, b.dataset.version, b.dataset.mergeable);
});
```

And make `load()` re-expand what was open: at the end of `load()`, after the line that sets `$("rows").innerHTML`, add:

```js
  for (const name of openRows) if (rowFor(name)) showVersions(name);
```

- [ ] **Step 4: Drive it in headless Chrome**

Start a private server and run a Playwright script from the scratchpad (playwright-core is already installed there):

```bash
HUBROOT=$(mktemp -d); PORT=8772 HUB_ROOT=$HUBROOT python3 serve.py & SP=$!; sleep 1
cp protocol/score.levels.json /tmp/levels.score
LIMELIGHT_REMOTE=http://127.0.0.1:8772/hub/score ./limelight push /tmp/levels.score
LIMELIGHT_REMOTE=http://127.0.0.1:8772/hub/score ./limelight push /tmp/levels.score
```

```js
// ui-versions.js
const { chromium } = require('playwright-core'); const fs = require('fs');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await b.newPage({ acceptDownloads: true });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8772/hub/score/', { waitUntil: 'networkidle' });
  console.log('badge:', await page.$eval('.badge', e => e.textContent));
  await page.click('button.versions'); await page.waitForSelector('tr.ver');
  console.log('versions shown:', await page.$$eval('tr.ver td.n', tds => tds.map(t => t.textContent.trim())));
  await page.click('tr.ver[data-version="1"] button.edit'); await page.waitForSelector('textarea.json');
  await page.fill('textarea.json', 'nope'); await page.click('button.save');
  console.log('bad json says:', await page.$eval('.editbar .err', e => e.textContent));
  await page.fill('textarea.json', '{"author":"muzammil","checked":true}'); await page.click('button.save');
  await page.waitForSelector('tr.ver[data-version="1"] .meta-on');
  console.log('after save:', await page.$eval('tr.ver[data-version="1"] td.n', e => e.textContent.trim()));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('tr.ver[data-version="1"] a[download]')]);
  const got = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  console.log('downloaded v1 author_metadata:', JSON.stringify(got.author_metadata));
  console.log('page errors:', errors.length ? errors : 'none');
  await b.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
```

Run: `node ui-versions.js; kill $SP`
Expected: `badge: v2`, two versions shown with `v2 latest` first, `bad json says: not JSON: …`, `after save: v1 has metadata`, `downloaded v1 author_metadata: {"author":"muzammil","checked":true}`, `page errors: none`.

- [ ] **Step 5: Commit**

```bash
git add hub/hub.html
git commit -m "The page shows every version of a score, and edits its metadata in place"
```

---

### Task 5: Documentation and the full run

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document versions and metadata**

In `README.md`, in the "Sharing scores" section, after the code block, replace the closing paragraph with:

```markdown
A pull of a name that is not there prints the names that are. `push` checks
the server holds exactly the bytes it sent.

**Versions.** Every `.score` keeps every version it was uploaded as. `push` of
an existing name makes the next version and says so; the page shows a `vN`
badge and a *versions* list with a download for each; `./limelight pull
levels.score@2` fetches version 2, and plain `pull` is the latest. Other file
types simply overwrite.

**Author metadata.** Each version can carry a JSON object, added or edited from
the page's *metadata* button. It is stored beside the version and folded into
every download of that version under `author_metadata`; the uploaded bytes are
never rewritten. `?raw` on the file URL skips the merge.

`node cli/remote.test.js` starts a private serve.py on a free port and runs
both commands, the hub API, versions and metadata against it. The hub speaks
the same requests as a dufs server, so `LIMELIGHT_REMOTE` can point at one of
those instead (without versions).
```

- [ ] **Step 2: Run everything**

Run:
```bash
node cli/remote.test.js 2>&1 | tail -1 && node protocol/session.test.js | tail -1 && node protocol/respond.test.js | tail -1
```
Expected: `all 80 checks pass`, `all 42 checks pass`, `all 12 checks pass`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Say how versions and metadata work"
```

---

## Self-review

**Spec coverage.** Storage layout and hidden `.versions` (Task 1) · always a new version (Task 1 check) · API table: PUT reply, `?v`, `?raw`, `?versions`, `?meta` GET/PUT, listing fields, 400 for non-`.score` (Tasks 1–2) · merge rule including non-object and no-metadata cases (Task 1 code, Task 2 checks) · page: badge, toggle, per-version download, editor with local validation, mergeable warning (Task 4) · CLI `pull name@N`, push version, missing version lists versions (Task 3) · errors: 404 wording, 400 reasons, 403 (Tasks 1–2) · tests 1–14 of the spec map to the checks in Tasks 1–3, the page is driven in Task 4 · README (Task 5). Spec test 11 (`.txt` twice overwrites, `?versions` → 400) is in Task 1.

**Type consistency.** `remote.get(name, version)`, `remote.put()` → object or null, `remote.versions(name)` → `{ latest, versions }` are defined in Task 3 and used only there. `V.store / numbers / latest / resolve_version / read / history / get_meta / set_meta / is_versioned / VDIR` are defined in Task 1's `versions.py` and used with those names in `hub.py`. The page's `data-name` is the URL-encoded name and is used encoded in every fetch.

**Counts.** 45 checks today; Task 1 adds 14 (59), Task 2 adds 17 (76), Task 3 changes one and adds 4 (80).
