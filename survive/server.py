#!/usr/bin/env python3
"""Survive the Song — standalone server.

Hosts the game and proxies score/audio from the Limelight hub so the browser
never needs CORS from it.

    python3 survive/server.py        then open http://localhost:8795/

    HUB_URL   the hub (default http://192.168.1.38:8770)
    STS_PORT  this server's port (default 8795)
"""
import http.server, json, os, re, socketserver
import urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
HUB  = os.environ.get("HUB_URL", "http://192.168.1.38:8770").rstrip("/")
PORT = int(os.environ.get("STS_PORT", "8795"))
HOST = os.environ.get("STS_HOST", "0.0.0.0")

TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "application/javascript",
    ".css": "text/css", ".json": "application/json",
    ".png": "image/png", ".svg": "image/svg+xml",
    ".ico": "image/x-icon", ".woff2": "font/woff2",
}


def _q(slug):
    return urllib.parse.quote(slug, safe="")


def hub_get(path, timeout=25):
    with urllib.request.urlopen(HUB + path, timeout=timeout) as r:
        return r.status, r.read()


def hub_has_audio(slug, timeout=8):
    req = urllib.request.Request(HUB + "/hub/audio/" + _q(slug) + ".mp3")
    req.add_header("Range", "bytes=0-0")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status in (200, 206)
    except Exception:
        return False


def slugify(name):
    stem = re.sub(r"\.mp3$", "", name or "", flags=re.I)
    return re.sub(r"[^A-Za-z0-9]+", "-", stem).strip("-").lower() or "song"


def fmt_len(sec):
    if not sec:
        return "—"
    return "%d:%02d" % (int(sec // 60), int(round(sec % 60)))


def build_library():
    try:
        _, body = hub_get("/hub/score/?json")
        listing = json.loads(body)
    except Exception as e:
        return {"songs": [], "error": "hub unreachable: %s" % e}
    songs = []
    for p in listing.get("paths", []):
        name = p.get("name", "")
        if not name.endswith(".score"):
            continue
        slug = name[:-6]
        if not hub_has_audio(slug):
            continue
        song = {
            "slug": slug, "name": slug, "artist": "—", "bpm": 0,
            "length": "—",
            "audio": "/api/audio/" + _q(slug) + ".mp3",
        }
        try:
            _, sb = hub_get("/hub/score/" + _q(slug) + ".score")
            sc = json.loads(sb)
            g = sc.get("grid") or {}
            s = sc.get("song") or {}
            song["bpm"] = round(g.get("bpm") or 0)
            song["name"] = s.get("title") or s.get("name") or slug
            song["artist"] = s.get("artist") or "—"
            song["length"] = fmt_len(s.get("length_s"))
        except Exception:
            pass
        songs.append(song)
    songs.sort(key=lambda x: x["name"].lower())
    return {"songs": songs, "hub": HUB}


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body=b"", ctype="text/plain; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj), "application/json")

    def _file(self, rel):
        path = os.path.normpath(os.path.join(HERE, rel.lstrip("/")))
        if not path.startswith(HERE) or not os.path.isfile(path):
            return self._send(404, "no " + rel)
        ctype = TYPES.get(os.path.splitext(path)[1], "application/octet-stream")
        with open(path, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        p = u.path
        if p in ("/", "/index.html"):
            return self._file("index.html")
        if p == "/api/library":
            return self._json(build_library())
        if p.startswith("/api/score/"):
            slug = urllib.parse.unquote(p[len("/api/score/"):])
            try:
                _, b = hub_get("/hub/score/" + _q(slug) + ".score")
                return self._send(200, b, "application/json")
            except urllib.error.HTTPError as e:
                return self._send(e.code, "no score for %s" % slug)
            except Exception as e:
                return self._send(502, "hub error: %s" % e)
        if p.startswith("/api/audio/"):
            slug = urllib.parse.unquote(p[len("/api/audio/"):])
            try:
                req = urllib.request.Request(HUB + "/hub/audio/" + _q(slug))
                with urllib.request.urlopen(req, timeout=30) as r:
                    data = r.read()
                self.send_response(200)
                self.send_header("Content-Type", "audio/mpeg")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(data)
                return
            except urllib.error.HTTPError as e:
                return self._send(e.code, "no audio for %s" % slug)
            except Exception as e:
                return self._send(502, "hub audio error: %s" % e)
        return self._file(p)

    do_HEAD = do_GET


if __name__ == "__main__":
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer((HOST, PORT), H) as srv:
        srv.daemon_threads = True
        print("  survive-the-song on http://localhost:%d/   (hub: %s)" % (PORT, HUB), flush=True)
        srv.serve_forever()
