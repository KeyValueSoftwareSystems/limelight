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
    GET   ...?profiles            -> { colours: [{name,hex}], profiles: [{user, colours:[{name,hex}]}] }
    PUT   ...?profile=<user>      body {"colours": ["red","blue"]}; create or replace -> 204, else 400
    GET   ...?profile=<user>[&v=N] download with "profile": {user, colours:[{name,hex}]} embedded

    MP3 → score (hub/generate.py), after the file has been PUT:
    POST  /hub/<dir>/<name>.mp3?generate   start a background job -> 202 {"job": {...}}
                                           mp3 is stored under audio/; score under score/
                                           same score already in flight -> 409
    GET   /hub/<dir>/?jobs                 -> { jobs: [{id, name, status, version, error, ...}] }
    GET   /hub/audio/<name>.mp3            playback bytes (Range supported); audio/ is not listed

No delete and no auth, on purpose: a shared folder on a LAN where the only way
to correct a mistake is to overwrite it is a folder nobody can empty by accident.

Files live in hub/files/ (gitignored) or wherever HUB_ROOT points. Songs
(canonical) live under hub/files/score/ — latest .score and .versions/ —
matching LIMELIGHT_REMOTE=…/hub/score. Playback mp3s live under
hub/files/audio/ (not listed in the hub UI). On load, leftover root-level
scores/mp3s/.versions and any score/*.mp3 siblings are moved into place.
"""
import json, os, urllib.parse
from . import versions as V
from . import profiles as P
from . import generate as G
from . import migrate

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.environ.get("HUB_ROOT", os.path.join(HERE, "files")))
PAGE = os.path.join(HERE, "hub.html")
SCORE_PAGE = os.path.join(HERE, "score.html")
PREFIX = "/hub"
SCORE = "score"
AUDIO = "audio"
os.makedirs(ROOT, exist_ok=True)   # a fresh clone has no hub/files/ yet; without this, /hub/ is a 404
migrate.run(ROOT)                  # root songs → score/, mp3s → audio/ (idempotent)


def score_dir():
    return os.path.join(ROOT, SCORE)


def audio_dir():
    return os.path.join(ROOT, AUDIO)


def is_mp3_name(name):
    return bool(name) and name.lower().endswith(".mp3")


def mp3_disk_path(name):
    """Canonical on-disk path for an mp3 (basename only under audio/)."""
    return os.path.join(audio_dir(), os.path.basename(name))


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
    # audio/ is playback-only; .mp3 never appears beside scores in the UI.
    names = [n for n in os.listdir(path)
             if n != V.VDIR and n != AUDIO and not n.lower().endswith(".mp3")]
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
            row["profiles"] = len(P.all_of(full))
        entries.append(row)
    return json.dumps({"href": urlpath, "kind": "Index", "allow_upload": True,
                       "allow_delete": False, "paths": entries})


TYPES = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".score": "application/json",
}


def _send_file(h, path, head):
    """Serve a hub file. Audio needs byte ranges or the browser cannot seek."""
    size = os.path.getsize(path)
    ctype = TYPES.get(os.path.splitext(path)[1].lower(), "application/octet-stream")
    rng = h.headers.get("Range")
    start, end, code = 0, max(size - 1, 0), 200
    if size and rng and rng.startswith("bytes="):
        a, _, b = rng[6:].partition("-")
        try:
            start = int(a) if a else 0
            end = int(b) if b else size - 1
            code = 206
        except ValueError:
            pass
        start = max(0, min(start, size - 1))
        end = max(start, min(end, size - 1))
    length = size if not size else (end - start + 1)
    h.send_response(code if size else 200)
    h.send_header("Content-Type", ctype)
    h.send_header("Content-Length", str(length))
    h.send_header("Accept-Ranges", "bytes")
    if code == 206 and size:
        h.send_header("Content-Range", f"bytes {start}-{end}/{size}")
    h.send_header("Cache-Control", "no-store")
    h.end_headers()
    if head or not length:
        return
    with open(path, "rb") as f:
        f.seek(start)
        left = length
        while left > 0:
            chunk = f.read(min(left, 1 << 20))
            if not chunk:
                break
            h.wfile.write(chunk)
            left -= len(chunk)


def _versioned_get(h, path, query, head):
    """GET/HEAD on a .score that has a history: ?versions, ?profiles, ?meta, ?v, ?raw, ?profile."""
    name = os.path.basename(path)
    if "versions" in query:
        return _json(h, 200, V.history(path), head)
    if "profiles" in query:
        return _json(h, 200, {"name": name, "colours": P.colours(), "profiles": P.all_of(path)}, head)
    v = query.get("v", [""])[0]
    try:
        n = V.resolve_version(path, v)
    except KeyError:
        return _send(h, 404, f"no version {v or 'latest'} of {name}", head_only=head)
    if "meta" in query:
        return _json(h, 200, V.get_meta(path, n) or {}, head)
    user = query.get("profile", [None])[0]
    if user is None:
        return _send(h, 200, V.read(path, n, raw="raw" in query), "application/octet-stream", head)
    # a download with a profile: the version, the author's keys, then the profile
    if "raw" in query:
        return _send(h, 400, "raw and profile contradict", head_only=head)
    profile = P.get(path, user)
    if profile is None:
        users = [p["user"] for p in P.all_of(path)]
        return _send(h, 404, f"no profile {user} for {name}\nprofiles: {', '.join(users) if users else 'none yet'}", head_only=head)
    obj = V.parse_object(V.read(path, n))
    if obj is None:
        return _send(h, 409, "not a JSON object, cannot embed a profile", head_only=head)
    return _send(h, 200, V.dump(P.embed(obj, profile)), "application/octet-stream", head)


VERSION_QUERIES = ("v", "raw", "versions", "meta", "page", "profiles", "profile")


def handle(h, method):
    parsed = urllib.parse.urlparse(h.path)
    path = resolve(parsed.path)
    if path is None:
        return _send(h, 403, "that path is not reachable")
    query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
    versioned = path != ROOT and V.is_versioned(path)

    if method == "POST":
        if "generate" not in query:
            return _send(h, 405, "POST is only for ?generate")
        if os.path.isdir(path) or path == ROOT:
            return _send(h, 405, "POST ?generate needs an .mp3 path")
        name = os.path.basename(path)
        if not is_mp3_name(name):
            return _send(h, 400, "only .mp3 files can be generated from")
        try:
            job = G.enqueue(score_dir(), mp3_disk_path(name))
        except G.Conflict as e:
            return _send(h, 409, str(e))
        except ValueError as e:
            return _send(h, 400, str(e))
        return _json(h, 202, {"job": job})

    if method == "MKCOL":
        if os.path.exists(path):
            return _send(h, 405, "already exists")
        # Do not create browsable folders named like the audio store.
        if os.path.basename(path) == AUDIO and os.path.dirname(path) == ROOT:
            return _send(h, 405, "audio is reserved for playback files")
        os.makedirs(path)
        return _send(h, 201, "created")

    if method == "PUT":
        if os.path.isdir(path) or path == ROOT:
            return _send(h, 405, "that is a folder")
        body = _read_body(h)
        if body is None:
            return _send(h, 411, "Content-Length required, and the body must be complete")
        name = os.path.basename(path)
        # All mp3 uploads land in audio/, regardless of the URL folder.
        if is_mp3_name(name):
            path = mp3_disk_path(name)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            tmp = path + ".uploading"
            with open(tmp, "wb") as f:
                f.write(body)
            os.replace(tmp, path)
            return _send(h, 201, "created")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if versioned and "profile" in query:
            try:
                P.put(path, query["profile"][0], body)
            except ValueError as e:
                return _send(h, 400, str(e))
            return _send(h, 204)
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
        # audio/ is not a browsable folder — only individual mp3 GETs.
        if path == audio_dir() or (os.path.isdir(path) and os.path.basename(path) == AUDIO
                                   and os.path.dirname(path) == ROOT):
            if "json" in query:
                return _send(h, 200, _listing(parsed.path, path), "application/json", head)
            return _send(h, 404, "audio files are not listed", head_only=head)
        if os.path.isdir(path):
            if "json" in query:
                return _send(h, 200, _listing(parsed.path, path), "application/json", head)
            if "jobs" in query:
                return _json(h, 200, G.snapshot(path), head)
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
        if "profiles" in query:                   # answers even before the first version
            return _json(h, 200, {"name": os.path.basename(path), "colours": P.colours(), "profiles": P.all_of(path)}, head)
        if versioned and V.numbers(path):
            return _versioned_get(h, path, query, head)
        # mp3 may be requested under /hub/score/… or /hub/audio/… — always serve from audio/.
        if is_mp3_name(os.path.basename(path)):
            disk = mp3_disk_path(os.path.basename(path))
            if os.path.isfile(disk):
                return _send_file(h, disk, head)
            return _send(h, 404, "no " + parsed.path, head_only=head)
        if os.path.isfile(path):
            if "versions" in query:
                return _json(h, 200, V.history(path), head)      # a .score uploaded before versioning existed
            return _send_file(h, path, head)
        return _send(h, 404, "no " + parsed.path, head_only=head)

    if method == "POST":
        p = urllib.parse.urlparse(h.path).path
        if p == PREFIX + "/score":
            from . import score_api
            body_bytes = _read_body(h)
            if body_bytes is None:
                return _send(h, 411, "Content-Length required")
            try:
                body = json.loads(body_bytes)
            except ValueError:
                return _send(h, 400, "not json")

            def fetch(name):
                fpath = os.path.join(ROOT, name + ".score")
                if not os.path.isfile(fpath):
                    raise FileNotFoundError(f"no score: {name}")
                if V.is_versioned(fpath) and V.numbers(fpath):
                    n = V.resolve_version(fpath, "")
                    return json.loads(V.read(fpath, n))
                return json.loads(open(fpath, "rb").read())

            try:
                result = score_api.handle(body, fetch)
                code = 200 if "error" not in result or "note" in result else 400
                return _json(h, code, result)
            except FileNotFoundError as e:
                return _json(h, 404, {"error": str(e)})
            except ValueError as e:
                return _json(h, 400, {"error": str(e)})
            except Exception as e:
                return _json(h, 500, {"error": str(e)})

    return _send(h, 405, method + " is not something the hub does")
