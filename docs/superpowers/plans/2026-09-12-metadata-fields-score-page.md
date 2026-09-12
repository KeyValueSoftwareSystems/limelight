# Metadata fields and a page per score Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Metadata on a score version becomes named fields with an *enforce* flag, folded into the download as `x-` prefixed root keys plus an `x-enforced` list, edited on a page of the score's own instead of inside the folder listing.

**Architecture:** `hub/versions.py` validates the new stored shape (`{name: {value, enforced}}`), merges it into downloads, and reports field counts in the history. `hub/hub.py` adds one route: `?page` on a `.score` serves the new `hub/score.html`. That page lists versions, uploads a new one, and edits fields with a row editor. `hub/hub.html` shrinks: the score name links to its page and the inline expansion is removed. The CLI is untouched.

**Tech Stack:** Python 3 stdlib, Node ≥ 18 built-ins, vanilla browser JS. No packages. Spec: `docs/superpowers/specs/2026-09-12-metadata-fields-score-page-design.md`. Tests: `node cli/remote.test.js`.

---

## File structure

| file | responsibility |
|---|---|
| `hub/versions.py` (modify) | `validate_meta`, `merge`, `set_meta` using them, `read` using `merge`, `history` with `fields`/`enforced` counts. |
| `hub/hub.py` (modify) | `?page` → `hub/score.html`; `page` joins the version-only queries. |
| `hub/score.html` (new) | The score page: header, upload new version, versions table, row editor. |
| `hub/hub.html` (modify) | Name links to `?page`; `download` link beside the badge; inline versions/editor removed. |
| `cli/remote.test.js` (modify) | Metadata block rewritten; CLI merged-latest check reads `x-who`; `?page` checks. |
| `README.md` (modify) | Metadata paragraph rewritten. |

---

### Task 1: Clear the hub on this machine

**Files:** none in git. `hub/files/` is gitignored.

- [ ] **Step 1: Look, then delete**

Run:
```bash
find hub/files -mindepth 1 | head -20; echo "---"
find hub/files -mindepth 1 -delete && ls -la hub/files
```
Expected: the listing of what was there, then an empty directory (only `.` and `..`).

No commit: nothing tracked changed.

---

### Task 2: The stored shape, the merge, and the counts

**Files:**
- Modify: `hub/versions.py`
- Modify: `cli/remote.test.js`

- [ ] **Step 1: Rewrite the metadata block in the test**

In `cli/remote.test.js`, replace the whole block from `  /* ---- author metadata: added to a version, folded into its download -------- */` up to (not including) `  /* ---- limelight push` with:

```js
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

```

In the `/* ---- limelight pull` block, change the two lines

```js
    await fetch(vurl + "?meta&v=2", { method: "PUT", body: JSON.stringify({ who: "me" }) });
```
to
```js
    await fetch(vurl + "?meta&v=2", { method: "PUT", body: JSON.stringify({ who: { value: "me" } }) });
```
and
```js
       r.code === 0 && JSON.parse(fs.readFileSync(path.join(dir, "lv.score"), "utf8")).author_metadata.who === "me", r.err);
```
to
```js
       r.code === 0 && JSON.parse(fs.readFileSync(path.join(dir, "lv.score"), "utf8"))["x-who"] === "me", r.err);
```

- [ ] **Step 2: Run, expect the new block to fail**

Run: `node cli/remote.test.js 2>&1 | grep -E "FAIL|all .* pass"`
Expected: FAIL on the x- keys, on the refusals that today's code accepts (`{a:1}`, nested value, `enforced: "yes"`, empty key, spaces, missing value), on the counts, and on the CLI `x-who` check.

- [ ] **Step 3: Change the store**

In `hub/versions.py`, replace `set_meta`, `read` and `history` with:

```python
SCALARS = (str, int, float, bool, type(None))


def validate_meta(obj):
    """The stored shape: { name: { value: <scalar>, enforced: <bool> } }.
    Returns a normalised copy, or raises ValueError saying exactly what is wrong."""
    if not isinstance(obj, dict):
        raise ValueError("metadata must be a JSON object of fields")
    out = {}
    for key, entry in obj.items():
        if not key.strip():
            raise ValueError("empty field name")
        if key != key.strip():
            raise ValueError(f"field name {key!r} has leading or trailing spaces")
        if not isinstance(entry, dict):
            raise ValueError(f"entry {key!r} is not an object; expected {{\"value\": ..., \"enforced\": true|false}}")
        if "value" not in entry:
            raise ValueError(f"{key}: value is missing")
        if not isinstance(entry["value"], SCALARS):
            raise ValueError(f"{key}: value must be a string, number, boolean or null")
        enforced = entry.get("enforced", False)
        if not isinstance(enforced, bool):
            raise ValueError(f"{key}: enforced must be true or false")
        out[key] = {"value": entry["value"], "enforced": enforced}
    return out


def set_meta(path, n, data):
    """Store fields for version n. Raises ValueError with the reason when the
    body is not the shape above; nothing is written in that case."""
    try:
        obj = json.loads(data)
    except ValueError as e:
        raise ValueError(f"metadata is not JSON: {e}")
    fields = validate_meta(obj)
    _write(meta_path(path, n), _dump(fields))
    return fields


def merge(obj, fields):
    """Fold fields into a score object: each as an x- prefixed root key, and one
    x-enforced list naming the enforced ones when there are any."""
    enforced = []
    for key, entry in fields.items():
        obj["x-" + key] = entry["value"]
        if entry.get("enforced"):
            enforced.append("x-" + key)
    if enforced:
        obj["x-enforced"] = enforced
    return obj


def read(path, n, raw=False):
    """The bytes of version n. Unless raw, fields are folded in as x- keys --
    but only when there are fields and the file is a JSON object; otherwise
    the uploaded bytes come back exactly."""
    with open(version_path(path, n), "rb") as f:
        data = f.read()
    if raw:
        return data
    fields = get_meta(path, n)
    if fields is None:
        return data
    obj = parse_object(data)
    if obj is None:
        return data
    return _dump(merge(obj, fields))


def history(path):
    out = []
    for n in numbers(path):
        vp = version_path(path, n)
        st = os.stat(vp)
        with open(vp, "rb") as f:
            mergeable = parse_object(f.read()) is not None
        fields = get_meta(path, n) or {}
        out.append({"version": n, "size": st.st_size, "mtime": int(st.st_mtime * 1000),
                    "has_metadata": os.path.isfile(meta_path(path, n)), "mergeable": mergeable,
                    "fields": len(fields), "enforced": sum(1 for e in fields.values() if e.get("enforced"))})
    return {"name": os.path.basename(path), "latest": latest(path), "versions": out}
```

Also update the module docstring's tree comment line for the meta file to read
`score/.versions/levels.score/2.meta.json   fields for version 2: { name: { value, enforced } }`.

- [ ] **Step 4: Run, expect all to pass**

Run: `node cli/remote.test.js 2>&1 | grep -E "FAIL|all .* pass"`
Expected: `all 88 checks pass`

- [ ] **Step 5: Commit**

```bash
git add hub/versions.py cli/remote.test.js
git commit -m "Metadata is fields with an enforce flag, folded in as x- keys"
```

---

### Task 3: The score page

**Files:**
- Modify: `hub/hub.py`
- Create: `hub/score.html`
- Modify: `hub/hub.html`
- Modify: `cli/remote.test.js`

- [ ] **Step 1: Add the failing route checks**

In `cli/remote.test.js`, inside the `/* ---- the hub itself: page and API` block, before its closing `  }`:

```js
    r = await fetch(fake.url + "/levels.score?page");
    ok("a .score answers ?page with HTML", r.status === 200 && /text\/html/.test(r.headers.get("content-type")) && /versions/.test(await r.text()), String(r.status));
    r = await fetch(fake.url + "/never-uploaded.score?page");
    ok("even a .score with no versions yet answers ?page", r.status === 200, String(r.status));
    r = await fetch(fake.url + "/notes.txt?page");
    ok("a .txt does not have a page", r.status === 400, String(r.status));
    const rowLatest = (await (await fetch(fake.url + "/?json")).json()).paths.find(p => p.name === "levels.score");
    ok("the listing row still carries version and has_metadata", rowLatest && typeof rowLatest.version === "number" && "has_metadata" in rowLatest, JSON.stringify(rowLatest));
```

(That block runs after the push block has uploaded `levels.score`, so the file exists.)

- [ ] **Step 2: Run, expect the three ?page checks to fail**

Run: `node cli/remote.test.js 2>&1 | grep -E "FAIL|all .* pass"`
Expected: FAIL on the two `?page` 200 checks (today `?page` is not a known query, so the file bytes come back as `application/octet-stream`, or 404 for the never-uploaded name).

- [ ] **Step 3: The route**

In `hub/hub.py`:

Add after `PAGE = os.path.join(HERE, "hub.html")`:
```python
SCORE_PAGE = os.path.join(HERE, "score.html")
```

Change `VERSION_QUERIES = ("v", "raw", "versions", "meta")` to:
```python
VERSION_QUERIES = ("v", "raw", "versions", "meta", "page")
```

In `handle`, in the `GET`/`HEAD` branch, replace the lines from `asks_versions = any(...)` to `return _send(h, 404, "no " + parsed.path, head_only=head)` with:

```python
        asks_versions = any(q in query for q in VERSION_QUERIES)
        if asks_versions and not versioned:
            return _send(h, 400, "not a versioned file: only .score files keep versions", head_only=head)
        if "page" in query:                       # the score's own page, versions or not
            with open(SCORE_PAGE, "rb") as f:
                return _send(h, 200, f.read(), "text/html; charset=utf-8", head)
        if versioned and V.numbers(path):
            return _versioned_get(h, path, query, head)
        if os.path.isfile(path):
            if "versions" in query:
                return _json(h, 200, V.history(path), head)      # a .score uploaded before versioning existed
            return _send_file(h, path, head)
        return _send(h, 404, "no " + parsed.path, head_only=head)
```

Add to the docstring's `.score files only` table:
```
    GET   ...?page                the score's own page: versions, downloads, metadata fields
```

- [ ] **Step 4: The score page**

Create `hub/score.html`:

```html
<!-- One score: its versions, a download for each, a new version from here, and
     the metadata fields on any version. Every request this page makes is one
     the CLI or curl could make; nothing here is page-only. -->
<title>Score</title>
<style>
:root{--bg:#0a0d13;--pan:#0f141d;--line:#1b2230;--line2:#263047;--ink:#e6e9f0;
  --dim:#9aa3b8;--faint:#5c6478;--amb:#e8a33d;--ok:#5bb98c;--blu:#6fa8dc;--bad:#e06c6c}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font:13px/1.55 ui-sans-serif,system-ui,sans-serif;margin:0}
.wrap{max-width:920px;margin:0 auto;padding:18px 18px 70px}
h1{font:600 12px ui-monospace,monospace;letter-spacing:.18em;color:var(--amb);margin:0 0 16px}
h1 a{color:var(--amb);text-decoration:none} h1 a:hover{text-decoration:underline}
.head{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin:0 0 16px}
.name{font:600 22px ui-monospace,monospace;color:var(--ink)}
.badge{display:inline-block;font:600 10px ui-monospace,monospace;letter-spacing:.08em;color:var(--amb);
  border:1px solid var(--line2);border-radius:4px;padding:1px 5px;vertical-align:2px}
button,label.btn,a.btn{background:#182031;color:var(--ink);border:1px solid var(--line2);
  border-radius:6px;padding:7px 13px;font:inherit;cursor:pointer;text-decoration:none;display:inline-block}
button:hover,label.btn:hover,a.btn:hover{border-color:#41506e}
button.small{padding:3px 9px;font:11px ui-monospace,monospace;margin-left:8px}
button.x{padding:3px 8px;font:11px ui-monospace,monospace;color:var(--bad)}
input[type=file]{display:none}
#msg{font:11.5px ui-monospace,monospace;color:var(--bad);white-space:pre-wrap;flex:1;min-width:200px}
table{border-collapse:collapse;width:100%;font:12px ui-monospace,monospace;background:var(--pan);
  border:1px solid var(--line);border-radius:6px}
th{font:600 10px ui-monospace,monospace;letter-spacing:.13em;text-transform:uppercase;color:var(--blu);
  text-align:left;padding:9px 12px;border-bottom:1px solid var(--line2)}
td{padding:7px 12px;border-bottom:1px solid #141a26;color:var(--dim);white-space:nowrap}
td.n{color:var(--ink)} td.r{text-align:right} td a{color:var(--blu);text-decoration:none} td a:hover{text-decoration:underline}
td .meta-on{color:var(--ok)} td .meta-off{color:var(--faint)}
tr.edit td{background:#0b1018;padding:12px;white-space:normal}
.fields{display:grid;grid-template-columns:1fr 2fr auto auto;gap:6px 10px;align-items:center;max-width:720px}
.fields .h{font:600 10px ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}
.fields input[type=text]{background:#05070b;color:var(--ink);border:1px solid var(--line2);border-radius:5px;
  padding:6px 8px;font:12px ui-monospace,monospace;width:100%}
.fields label{color:var(--dim);font-size:11px;display:flex;gap:5px;align-items:center;white-space:nowrap}
.fields input[type=checkbox]{accent-color:var(--amb)}
.editbar{display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap}
.editbar .err{color:var(--bad);font:11.5px ui-monospace,monospace;white-space:pre-wrap;flex:1}
.editbar .warn{color:var(--amb);font:11.5px ui-monospace,monospace;flex-basis:100%}
.empty{padding:26px 12px;color:var(--faint);text-align:center}
.note{color:var(--faint);font-size:12px;margin:10px 0 0}
</style>

<div class="wrap">
<h1 id="crumb">HUB</h1>

<div class="head">
  <span class="name" id="name"></span>
  <span class="badge" id="latest">—</span>
  <a class="btn" id="dl" href="" download>download latest</a>
  <label class="btn" for="file">upload new version</label>
  <input type="file" id="file">
  <span id="msg"></span>
</div>

<table>
  <thead><tr><th>version</th><th>uploaded</th><th>size</th><th>metadata</th><th></th></tr></thead>
  <tbody id="rows"></tbody>
</table>
<p class="note">A download folds the fields of that version into the file as
<span style="color:var(--dim)">x-&lt;name&gt;</span> keys at the root, and lists the enforced ones under
<span style="color:var(--dim)">x-enforced</span>. The uploaded bytes are never rewritten.</p>
</div>

<script>
const $ = id => document.getElementById(id);
const file = location.pathname;                                  /* /hub/score/levels.score */
const name = decodeURIComponent(file.slice(file.lastIndexOf("/") + 1));
const enc = s => s.split("/").map(encodeURIComponent).join("/");
const err = m => { $("msg").textContent = m; if (m) console.error(m); };
const human = n => n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(2) + " MB";
const when = ms => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

function crumbs() {
  const parts = file.replace(/^\/hub\/?/, "").split("/").filter(Boolean);
  let html = `<a href="/hub/">HUB</a>`, href = "/hub/";
  parts.forEach((p, i) => {
    if (i < parts.length - 1) { href += enc(p) + "/"; html += ` / <a href="${href}">${esc(p.toUpperCase())}</a>`; }
    else html += ` / ${esc(p)}`;
  });
  $("crumb").innerHTML = html;
  $("name").textContent = name;
  $("dl").href = file;
  document.title = name;
}

let HIST = null;
async function load() {
  err("");
  let r;
  try { r = await fetch(file + "?versions"); } catch (e) { return err("cannot reach the server: " + e.message); }
  if (r.status === 404) { HIST = { latest: null, versions: [] }; }
  else if (!r.ok) return err(`${r.status} ${r.statusText} listing versions`);
  else HIST = await r.json();
  $("latest").textContent = HIST.latest ? "v" + HIST.latest : "no versions yet";
  $("dl").hidden = !HIST.latest;
  const rows = [];
  for (const v of [...HIST.versions].reverse()) {
    const meta = v.fields ? `<span class="meta-on">${v.fields} field${v.fields === 1 ? "" : "s"} · ${v.enforced} enforced</span>`
                          : `<span class="meta-off">no metadata</span>`;
    rows.push(`<tr data-version="${v.version}"><td class="n">v${v.version}${v.version === HIST.latest ? ' <span class="badge">latest</span>' : ""}</td>` +
      `<td>${when(v.mtime)}</td><td>${human(v.size)}</td><td>${meta}</td>` +
      `<td class="r"><a href="${file}?v=${v.version}" download>download</a>` +
      `<button class="small edit" data-version="${v.version}" data-mergeable="${v.mergeable}">${v.fields ? "edit" : "add"} metadata</button></td></tr>`);
  }
  $("rows").innerHTML = rows.join("") || `<tr><td colspan="5" class="empty">no versions yet — upload one above, or <span style="color:var(--dim)">limelight push</span> it</td></tr>`;
}

$("file").addEventListener("change", async e => {
  const f = e.target.files[0]; if (!f) return;
  err("");
  const r = await fetch(file, { method: "PUT", body: f });
  if (!r.ok) return err(`${r.status} ${r.statusText} uploading: ${await r.text()}`);
  e.target.value = "";
  load();
});

/* ---- the field editor ------------------------------------------------------ */
function typed(text) {
  /* a JSON number, true, false or null becomes that scalar; anything else is the string as typed */
  const t = text.trim();
  try { const v = JSON.parse(t); if (v === null || typeof v === "number" || typeof v === "boolean") return v; } catch (e) {}
  return text;
}
const shown = v => typeof v === "string" ? v : JSON.stringify(v);

function fieldRow(key, value, enforced) {
  return `<input type="text" class="k" placeholder="name" value="${esc(key)}">` +
         `<input type="text" class="v" placeholder="value" value="${esc(value)}">` +
         `<label><input type="checkbox" class="e" ${enforced ? "checked" : ""}> enforce</label>` +
         `<button class="x" title="remove this field">remove</button>`;
}

async function openEditor(version, mergeable) {
  document.querySelectorAll("tr.edit").forEach(tr => tr.remove());
  const verRow = document.querySelector(`tr[data-version="${version}"]`);
  const r = await fetch(`${file}?meta&v=${version}`);
  const current = r.ok ? await r.json() : {};
  const tr = document.createElement("tr");
  tr.className = "edit";
  const rows = Object.entries(current).map(([k, e]) => fieldRow(k, shown(e.value), e.enforced)).join("");
  tr.innerHTML = `<td colspan="5"><div class="fields"><span class="h">name</span><span class="h">value</span><span></span><span></span>${rows}</div>` +
    `<div class="editbar"><button class="add">add field</button><button class="save">save</button><button class="cancel">cancel</button>` +
    `<span class="err"></span>` +
    `${mergeable === "false" ? '<span class="warn">this file is not a JSON object, so fields are stored but will not be folded into downloads</span>' : ""}</div></td>`;
  verRow.after(tr);
  const grid = tr.querySelector(".fields"), msg = tr.querySelector(".err");
  const addRow = () => { grid.insertAdjacentHTML("beforeend", fieldRow("", "", false)); grid.querySelector(".k:last-of-type").focus(); };
  if (!rows) addRow();
  tr.querySelector(".add").onclick = addRow;
  tr.querySelector(".cancel").onclick = () => tr.remove();
  grid.addEventListener("click", e => {
    if (!e.target.classList.contains("x")) return;
    /* a row is four cells: key, value, label, remove */
    const cells = [...grid.children].slice(4);
    const i = cells.indexOf(e.target), start = i - (i % 4);
    cells.slice(start, start + 4).forEach(c => c.remove());
  });
  tr.querySelector(".save").onclick = async () => {
    const ks = [...grid.querySelectorAll(".k")], vs = [...grid.querySelectorAll(".v")], es = [...grid.querySelectorAll(".e")];
    const out = {};
    for (let i = 0; i < ks.length; i++) {
      const k = ks[i].value, v = vs[i].value;
      if (k === "" && v === "") continue;
      if (k.trim() === "") { msg.textContent = `row ${i + 1}: a value needs a name`; return; }
      if (k !== k.trim()) { msg.textContent = `"${k}": remove the spaces around the name`; return; }
      if (k in out) { msg.textContent = `"${k}" is listed twice`; return; }
      out[k] = { value: typed(v), enforced: es[i].checked };
    }
    const res = await fetch(`${file}?meta&v=${version}`, { method: "PUT", body: JSON.stringify(out) });
    if (!res.ok) { msg.textContent = `${res.status} ${res.statusText}: ${await res.text()}`; return; }
    tr.remove();
    await load();
  };
}

$("rows").addEventListener("click", e => {
  const b = e.target.closest("button.edit");
  if (b) openEditor(b.dataset.version, b.dataset.mergeable);
});

crumbs(); load();
</script>
```

- [ ] **Step 5: Shrink the folder page**

In `hub/hub.html`:

Remove these style rules (everything added for inline versions):
```
tr.ver td{...} tr.ver td.n{...} tr.ver .meta-on{...}
tr.edit td{...}
textarea.json{...}
.editbar{...} .editbar .err{...} .editbar .warn{...}
```
Keep `.badge` and `button.small`. Add:
```css
td a.dl{color:var(--dim);font-size:11px;margin-left:10px}
```

In `load()`, replace the loop body with:
```js
  for (const p of data.paths) {
    const dir = p.path_type === "Dir";
    const score = !dir && /\.score$/.test(p.name);
    const a = dir   ? `<a class="dir" href="${base}${enc(p.name)}/">${p.name}</a>`
            : score ? `<a href="${base}${enc(p.name)}?page">${p.name}</a>`
                    : `<a href="${base}${enc(p.name)}" download>${p.name}</a>`;
    const extra = score && p.version ? `<span class="badge">v${p.version}</span><a class="dl" href="${base}${enc(p.name)}" download>download</a>` : "";
    rows.push(`<tr><td class="n">${a}${extra}</td><td>${when(p.mtime)}</td><td class="r">${dir ? "" : human(p.size)}</td></tr>`);
  }
  $("rows").innerHTML = rows.join("") || `<tr><td colspan="3" class="empty">empty — upload something</td></tr>`;
}
```
(the `for (const name of openRows) …` line goes away with the loop.)

Delete everything from `/* ---- versions of one .score, expanded under its row` down to, but not including, `$("reload").addEventListener("click", load);`.

Update the note paragraph to:
```html
<p class="note">Anything you upload here everyone on this network can pull with
<span class="mono">limelight pull &lt;name&gt;</span>. Click a score for its versions and
metadata. Nothing can be deleted from the page; a mistake is fixed by uploading over it.</p>
```

- [ ] **Step 6: Run the API tests**

Run: `node cli/remote.test.js 2>&1 | grep -E "FAIL|all .* pass"`
Expected: `all 92 checks pass`

Also syntax-check both pages' scripts:
```bash
for f in hub/hub.html hub/score.html; do python3 -c "s=open('$f').read();open('/tmp/p.js','w').write(s[s.index('<script>')+8:s.rindex('</script>')])" && node --check /tmp/p.js && echo "$f ok"; done
```

- [ ] **Step 7: Drive the score page in headless Chrome**

Start a private server with two versions:
```bash
HUBROOT=$(mktemp -d); PORT=8773 HUB_ROOT=$HUBROOT HOST=127.0.0.1 python3 serve.py >/dev/null 2>&1 & SP=$!; sleep 1
R=http://127.0.0.1:8773/hub/score; cp protocol/score.levels.json /tmp/levels.score
LIMELIGHT_REMOTE=$R ./limelight push /tmp/levels.score; LIMELIGHT_REMOTE=$R ./limelight push /tmp/levels.score
```

From the scratchpad `pw/` folder (playwright-core is installed there), `ui-score.js`:
```js
const { chromium } = require('playwright-core'); const fs = require('fs');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await b.newPage({ acceptDownloads: true });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8773/hub/score/', { waitUntil: 'networkidle' });
  await page.click('a[href$="levels.score?page"]'); await page.waitForSelector('tr[data-version]');
  console.log('url:', page.url(), '| latest badge:', await page.$eval('#latest', e => e.textContent));
  console.log('versions:', await page.$$eval('tr[data-version] td.n', t => t.map(x => x.textContent.trim())));
  await page.click('tr[data-version="1"] button.edit'); await page.waitForSelector('.fields .k');
  await page.fill('.fields .k', 'author'); await page.fill('.fields .v', 'muzammil'); await page.check('.fields .e');
  await page.click('button.add'); const ks = await page.$$('.fields .k'); const vs = await page.$$('.fields .v');
  await ks[1].fill('bpm'); await vs[1].fill('128');
  await page.click('button.add'); const ks2 = await page.$$('.fields .k'); await ks2[2].fill('author');
  await page.click('button.save'); console.log('duplicate says:', await page.$eval('.editbar .err', e => e.textContent));
  const xs = await page.$$('.fields .x'); await xs[2].click();
  await page.click('button.save'); await page.waitForSelector('tr[data-version="1"] .meta-on');
  console.log('row says:', await page.$eval('tr[data-version="1"] .meta-on', e => e.textContent));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('tr[data-version="1"] a[download]')]);
  const got = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  console.log('x-author:', got['x-author'], '| x-bpm:', got['x-bpm'], typeof got['x-bpm'], '| x-enforced:', JSON.stringify(got['x-enforced']), '| author_metadata present:', 'author_metadata' in got);
  await page.click('tr[data-version="1"] button.edit'); await page.waitForSelector('.fields .k');
  console.log('reopened prefilled:', await page.$$eval('.fields .k', k => k.map(x => x.value)), await page.$$eval('.fields .v', v => v.map(x => x.value)), await page.$$eval('.fields .e', e => e.map(x => x.checked)));
  await page.click('button.cancel');
  await page.setInputFiles('#file', '/tmp/levels.score'); await page.waitForFunction(() => document.querySelector('#latest').textContent === 'v3');
  console.log('after upload from page:', await page.$eval('#latest', e => e.textContent));
  console.log('page errors:', errors.length ? errors : 'none');
  await b.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
```
Run: `node ui-score.js; kill $SP`
Expected: url ends in `levels.score?page`, `latest badge: v2`, two versions, `duplicate says: "author" is listed twice`, `row says: 2 fields · 1 enforced`, `x-author: muzammil | x-bpm: 128 number | x-enforced: ["x-author"] | author_metadata present: false`, prefilled `['author','bpm'] ['muzammil','128'] [true,false]`, `after upload from page: v3`, `page errors: none`.

- [ ] **Step 8: Commit**

```bash
git add hub/hub.py hub/score.html hub/hub.html cli/remote.test.js
git commit -m "A page per score: its versions, a new one from here, and its fields"
```

---

### Task 4: Documentation and the full run

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite the metadata paragraph**

In `README.md`, replace the paragraph beginning `**Author metadata.**` with:

```markdown
**Metadata fields.** Click a score in the hub for its own page: every version,
a download for each, a new version from a file picker, and the metadata on any
version as named fields, each with an *enforce* checkbox. A download of that
version carries every field at the root of the JSON as `x-<name>` (a value typed
as `128` or `true` becomes a number or boolean), and one `x-enforced` list
naming the enforced keys when there are any. The uploaded bytes are never
rewritten; `?raw` on the file URL skips the merge.
```

- [ ] **Step 2: Run everything**

```bash
node cli/remote.test.js 2>&1 | tail -1 && node protocol/session.test.js | tail -1 && node protocol/respond.test.js | tail -1
```
Expected: `all 92 checks pass`, `all 42 checks pass`, `all 12 checks pass`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Say how metadata fields work"
```

---

## Self-review

**Spec coverage.** Clearing (Task 1) · stored shape and the seven refusals with reasons (Task 2; the spec lists five, the test adds spaces and missing value, both stated in the spec's shape rules) · merge with `x-` keys, `x-enforced` only when needed, `author_metadata` gone, raw/no-metadata/non-JSON rules (Task 2) · `?versions` counts (Task 2) · `?page` for any `.score` including never uploaded, 400 for others (Task 3) · folder page: name links to `?page`, download beside badge, inline removed (Task 3) · score page: breadcrumb, badge, download latest, upload new version, versions table with counts, editor rows with enforce and remove, add/save/cancel, the four save rules, typed values, mergeable warning (Task 3) · CLI unchanged except its test reads `x-who` (Task 2) · browser run (Task 3 step 7) · README (Task 4).

**Type consistency.** `validate_meta`, `merge`, `set_meta`, `read`, `history` in `versions.py`; `hub.py` calls only `V.history`, `V.set_meta`, `V.read`, `V.numbers`, `V.latest`, `V.get_meta`, `V.is_versioned`, `V.store`, `V.resolve_version`, `V.VDIR`, all existing. The page reads `fields`, `enforced`, `mergeable`, `has_metadata`, `latest`, `version`, `size`, `mtime` from `?versions`, all produced by `history`. The stored shape `{value, enforced}` is what `openEditor` prefills from and `save` sends.

**Counts.** 80 today; Task 2 rewrites the 17-check block into 25 (88); Task 3 adds 4 (92).
