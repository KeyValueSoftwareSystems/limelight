#!/usr/bin/env python3
"""The smallest server that can host the protocol.

Serves the score, the library, the page, and the audio -- and hands anything
under /hub to hub/hub.py, the shared folder. Nothing else, because every time
this file has grown past "hand back a file" it has become the place decisions
hide.

    python3 serve.py            then open http://<this machine>:8770/

It binds every interface so the hub is reachable across the network; set
HOST=127.0.0.1 to keep it to this machine.
"""
import datetime, glob, http.server, json, os, socket, socketserver, sys, urllib.parse
from hub import hub

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "8770"))
HOST = os.environ.get("HOST", "0.0.0.0")


def lan_ip():
    """The address other machines on this network reach us at. No packet is sent."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()

TYPES = {".html": "text/html; charset=utf-8", ".js": "application/javascript",
         ".json": "application/json", ".wav": "audio/wav", ".css": "text/css",
         ".mp3": "audio/mpeg", ".score": "application/json"}


def read_verdicts():
    at = os.path.join(ROOT, "truth", "ear.jsonl")
    if not os.path.isfile(at):
        return {}
    out = {}
    with open(at) as f:
        for line in f:
            try:
                v = json.loads(line)
            except ValueError:
                continue
            out.setdefault(v.get("slug"), []).append(v)
    return out


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _file(self, rel):
        path = os.path.normpath(os.path.join(ROOT, rel.lstrip("/")))
        if not path.startswith(ROOT) or not os.path.isfile(path):
            self.send_error(404, "no " + rel); return
        ctype = TYPES.get(os.path.splitext(path)[1], "application/octet-stream")
        size = os.path.getsize(path)
        rng = self.headers.get("Range")
        start, end, code = 0, size - 1, 200
        # Without byte ranges a browser cannot seek in audio at all: it asks for
        # a slice, gets the whole file back with a 200, and the scrub bar does
        # nothing. That cost an hour once already.
        if rng and rng.startswith("bytes="):
            a, _, b = rng[6:].partition("-")
            try:
                start = int(a) if a else 0
                end = int(b) if b else size - 1
                code = 206
            except ValueError:
                pass
        end = min(end, size - 1)
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        if code == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        with open(path, "rb") as f:
            f.seek(start)
            self.wfile.write(f.read(end - start + 1))

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _hub(self):
        p = urllib.parse.urlparse(self.path).path
        if p == hub.PREFIX or p.startswith(hub.PREFIX + "/"):
            hub.handle(self, self.command); return True
        return False

    def do_GET(self):
        if self._hub(): return
        p = urllib.parse.urlparse(self.path).path
        if p in ("/", "/index.html"):
            return self._file("page/ear.html")
        if p == "/container":
            return self._file("page/container.html")
        if p == "/library.json":
            out = []
            for f in sorted(glob.glob(os.path.join(ROOT, "scores", "*.score"))):
                slug = os.path.splitext(os.path.basename(f))[0]
                for ext in (".mp3", ".wav"):
                    audio = os.path.join(ROOT, "synth", "incoming", slug + ext)
                    if os.path.isfile(audio):
                        out.append({"slug": slug, "audio": f"/synth/incoming/{slug}{ext}"})
                        break
            return self._json(out)
        if p == "/verdicts.json":
            return self._json(read_verdicts())
        if p.startswith("/taps/"):
            at = os.path.join(ROOT, "truth", p[6:] + ".taps.json")
            if not os.path.isfile(at):
                return self._json({"changes_s": [], "complete_up_to_s": 0.0})
            return self._json(json.loads(open(at).read()))
        self._file(p)

    def do_POST(self):
        if self._hub():
            return
        p = urllib.parse.urlparse(self.path).path
        if p == "/tap":
            n = int(self.headers.get("Content-Length") or 0)
            try:
                v = json.loads(self.rfile.read(n) or b"{}")
            except ValueError:
                return self.send_error(400, "not json")
            slug = v.get("slug", "unknown")
            at = os.path.join(ROOT, "truth", f"{slug}.taps.json")
            os.makedirs(os.path.dirname(at), exist_ok=True)
            doc = {"song": slug, "how": "truth", "who": "tapped at the page",
                   "complete_up_to_s": 0.0, "changes_s": []}
            if os.path.isfile(at):
                try:
                    doc = json.loads(open(at).read())
                except ValueError:
                    pass
            if v.get("clear"):
                doc["changes_s"] = []
                doc["complete_up_to_s"] = 0.0
            elif v.get("done") is not None:
                doc["complete_up_to_s"] = round(float(v["done"]), 2)
            else:
                t = round(float(v.get("at_s", 0)), 2)
                if all(abs(t - x) > 0.4 for x in doc["changes_s"]):
                    doc["changes_s"].append(t)
                    doc["changes_s"].sort()
            with open(at, "w") as f:
                f.write(json.dumps(doc, indent=2) + "\n")
            return self._json(doc)
        if p != "/verdict":
            return self.send_error(404, "no " + p)
        n = int(self.headers.get("Content-Length") or 0)
        try:
            v = json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return self.send_error(400, "not json")
        v["at"] = datetime.datetime.now().isoformat(timespec="seconds")
        os.makedirs(os.path.join(ROOT, "truth"), exist_ok=True)
        with open(os.path.join(ROOT, "truth", "ear.jsonl"), "a") as f:
            f.write(json.dumps(v) + "\n")
        self._json(read_verdicts())

    def _hub_only(self):
        if not self._hub():
            self.send_error(405, self.command + " only under /hub")

    do_HEAD = do_PUT = do_MKCOL = _hub_only


if __name__ == "__main__":
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer((HOST, PORT), H) as srv:
        srv.daemon_threads = True
        shown = lan_ip() if HOST == "0.0.0.0" else HOST
        print(f"  protocol on http://{shown}:{PORT}", flush=True)
        print(f"  hub      on http://{shown}:{PORT}/hub/   (files in {hub.ROOT})", flush=True)
        print(f"  from another machine:  export LIMELIGHT_REMOTE=http://{shown}:{PORT}/hub/score", flush=True)
        srv.serve_forever()
