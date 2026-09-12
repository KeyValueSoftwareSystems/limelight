"""The hub: one folder everybody on the network can read and write.

Mounted by serve.py at /hub. It speaks the same small HTTP dialect the dufs
file server did, so cli/remote.js works against it unchanged and anybody with
curl can use it:

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
    PUT   ...?meta[&v=N]          store metadata fields { name: { value, enforced } } -> 204, else 400
    GET   ...?page                the score's own page: versions, downloads, metadata fields

No delete and no auth, on purpose: a shared folder on a LAN where the only way
to correct a mistake is to overwrite it is a folder nobody can empty by accident.

Files live in hub/files/ (gitignored) or wherever HUB_ROOT points.
"""
import json, os, urllib.parse
from . import versions as V

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.environ.get("HUB_ROOT", os.path.join(HERE, "files")))
PAGE = os.path.join(HERE, "hub.html")
SCORE_PAGE = os.path.join(HERE, "score.html")
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


VERSION_QUERIES = ("v", "raw", "versions", "meta", "page")


def handle(h, method):
    parsed = urllib.parse.urlparse(h.path)
    path = resolve(parsed.path)
    if path is None:
        return _send(h, 403, "that path is not reachable")
    query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
    versioned = path != ROOT and V.is_versioned(path)

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
            v = query.get("v", [""])[0]
            try:
                n = V.resolve_version(path, v)
            except KeyError:
                return _send(h, 404, f"no version {v or 'latest'} of {os.path.basename(path)}")
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

    return _send(h, 405, method + " is not something the hub does")
