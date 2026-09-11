"""The hub: one folder everybody on the network can read and write.

Mounted by serve.py at /hub. It speaks the same small HTTP dialect the dufs
file server did, so cli/remote.js works against it unchanged and anybody with
curl can use it:

    GET   /hub/<dir>/?json        list           -> { paths: [{ name, path_type, size, mtime }] }
    GET   /hub/<dir>/             the page
    MKCOL /hub/<dir>              new folder     -> 201, or 405 when it already exists
    PUT   /hub/<dir>/<name>       upload, raw body, parents created  -> 201 (overwrites)
    GET   /hub/<dir>/<name>       download
    HEAD  /hub/<dir>/<name>       content-length, so a push can check it landed whole

No delete and no auth, on purpose: a shared folder on a LAN where the only way
to correct a mistake is to overwrite it is a folder nobody can empty by accident.

Files live in hub/files/ (gitignored) or wherever HUB_ROOT points.
"""
import json, os, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.environ.get("HUB_ROOT", os.path.join(HERE, "files")))
PAGE = os.path.join(HERE, "hub.html")
PREFIX = "/hub"


def resolve(urlpath):
    """URL path -> absolute path under ROOT, or None when it tries to leave."""
    rel = urllib.parse.unquote(urlpath[len(PREFIX):]).lstrip("/")
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


def _listing(urlpath, path):
    entries = []
    for name in sorted(os.listdir(path), key=lambda n: (not os.path.isdir(os.path.join(path, n)), n.lower())):
        full = os.path.join(path, name)
        st = os.stat(full)
        entries.append({
            "path_type": "Dir" if os.path.isdir(full) else "File",
            "name": name,
            "mtime": int(st.st_mtime * 1000),
            "size": 0 if os.path.isdir(full) else st.st_size,
        })
    return json.dumps({"href": urlpath, "kind": "Index", "allow_upload": True,
                       "allow_delete": False, "paths": entries})


def handle(h, method):
    parsed = urllib.parse.urlparse(h.path)
    path = resolve(parsed.path)
    if path is None:
        return _send(h, 403, "that path leaves the hub")
    query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)

    if method == "MKCOL":
        if os.path.exists(path):
            return _send(h, 405, "already exists")
        os.makedirs(path)
        return _send(h, 201, "created")

    if method == "PUT":
        if os.path.isdir(path) or path == ROOT:
            return _send(h, 405, "that is a folder")
        length = h.headers.get("Content-Length")
        if length is None:
            return _send(h, 411, "Content-Length required")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        # Write beside, then rename: a reader never sees half a file.
        tmp = path + ".uploading"
        remaining = int(length)
        with open(tmp, "wb") as f:
            while remaining > 0:
                chunk = h.rfile.read(min(remaining, 1 << 20))
                if not chunk:
                    break
                f.write(chunk)
                remaining -= len(chunk)
        if remaining:
            os.remove(tmp)
            return _send(h, 400, f"body ended {remaining} bytes early")
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
        if os.path.isfile(path):
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
            return
        return _send(h, 404, "no " + parsed.path, head_only=head)

    return _send(h, 405, method + " is not something the hub does")
