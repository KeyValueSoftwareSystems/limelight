#!/usr/bin/env python3
"""Standalone Beat Saber server.

The game folder is self-contained: this server hosts the game and everything it
loads (vendored Three.js + the protocol's session/clock). The only outside
dependency is the Limelight hub, which owns the songs. This server talks to the
hub on the browser's behalf so the page never needs CORS from it.

    python3 beat-saber/server.py        then open http://localhost:8790/

    HUB_URL   the hub (default http://192.168.1.38:8770)
    BS_PORT   this server's port (default 8790)

Endpoints (all same-origin):
    GET  /                     the game
    GET  /api/library          playable songs on the hub (score AND audio), enriched
    GET  /api/score/<slug>     the .score JSON, proxied from the hub
    GET  /api/jobs             MP3->score generation progress, proxied
    POST /api/add?name=<file>  upload an mp3 -> hub audio, then start scoring
Audio plays straight from the hub URL each library entry carries.
"""
import http.server
import json
import os
import re
import socketserver
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
HUB = os.environ.get("HUB_URL", "http://192.168.1.38:8770").rstrip("/")
PORT = int(os.environ.get("BS_PORT", "8790"))
HOST = os.environ.get("BS_HOST", "0.0.0.0")

TYPES = {".html": "text/html; charset=utf-8", ".js": "application/javascript",
         ".css": "text/css", ".json": "application/json", ".map": "application/json",
         ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2",
         ".ico": "image/x-icon"}


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
    s = re.sub(r"[^A-Za-z0-9]+", "-", stem).strip("-").lower()
    return s or "song"


def fmt_len(sec):
    if not sec:
        return "—"
    m = int(sec // 60)
    s = int(round(sec % 60))
    return "%d:%02d" % (m, s)


def build_library():
    """Every hub score that also has audio, enriched from its grid/song block."""
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
            continue                       # no audio -> not playable, skip
        song = {"slug": slug, "name": slug, "artist": "—", "bpm": 0,
                "length": "—", "audio": HUB + "/hub/audio/" + _q(slug) + ".mp3"}
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
        if p == "/api/jobs":
            try:
                _, b = hub_get("/hub/score/?jobs")
                return self._send(200, b, "application/json")
            except Exception:
                return self._json({"jobs": []})
        return self._file(p)

    do_HEAD = do_GET

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        if u.path != "/api/add":
            return self._send(404, "no " + u.path)
        q = urllib.parse.parse_qs(u.query)
        fname = q.get("name", ["song.mp3"])[0]
        slug = slugify(fname)
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return self._send(411, "empty upload")
        body = self.rfile.read(n)
        # 1) upload the mp3 (the hub files it under audio/ by basename)
        put = urllib.request.Request(HUB + "/hub/score/" + _q(slug) + ".mp3",
                                     data=body, method="PUT")
        put.add_header("Content-Type", "audio/mpeg")
        try:
            with urllib.request.urlopen(put, timeout=300) as r:
                r.read()
        except Exception as e:
            return self._json({"error": "upload failed: %s" % e}, 502)
        # 2) start scoring
        gen = urllib.request.Request(HUB + "/hub/score/" + _q(slug) + ".mp3?generate",
                                     data=b"", method="POST")
        job = None
        try:
            with urllib.request.urlopen(gen, timeout=30) as r:
                job = json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            return self._json({"error": "scoring rejected: %s" % (e.read() or b"").decode("utf-8", "replace")}, 502)
        except Exception as e:
            return self._json({"error": "scoring failed: %s" % e}, 502)
        return self._json({"slug": slug, "score_name": slug + ".score", "job": job}, 202)


if __name__ == "__main__":
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer((HOST, PORT), H) as srv:
        srv.daemon_threads = True
        print("  beat-saber on http://localhost:%d/   (hub: %s)" % (PORT, HUB), flush=True)
        srv.serve_forever()
