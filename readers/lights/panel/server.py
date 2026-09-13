#!/usr/bin/env python3
"""Web control panel for the PAR show.

  server.py [--port 8765] [--host 127.0.0.1] [--gain 1.0] [--offset-ms 0] [--no-net] [--gateway IP] [--universe N] [dir ...]

Serves ui.html plus a small JSON API. The page is a remote control: play,
pause and seek commands go to the transport, which is the master clock for
both the PipeWire audio player and the 40 fps frames sent to the PAR.
Directories are scanned for *.lights.json (default: this folder and its parent).
"""
import argparse
import json
import mimetypes
import os
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

import numpy as np

import rig
from rig import park_frame   # park_frame lives in rig.py now (no numpy-heavy concert needed)
from transport import Transport

import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
UI_PATH = os.path.join(HERE, "ui.html")
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))          # panel -> lights -> readers -> limelight
EXPER = os.path.join(os.path.dirname(REPO), "experimentation")          # for local audio caches
HUB = os.environ.get("HUB_URL", "http://192.168.1.38:8770")
HUB_SCORES = HUB + "/hub/score"   # scores live under /hub/score/ (same as LIMELIGHT_REMOTE and the CLI)


class NullSender:
    def send(self, v):
        pass

    def blackout(self, repeats=5, pause=0.02, frame=None):
        pass


class State:
    def __init__(self, dirs, transport, audio_factory=None):
        self.dirs = [os.path.abspath(d) for d in dirs]
        self.transport = transport
        self.audio_factory = audio_factory
        self.track = None
        self.meta = None
        self.analyzing = None
        self.analyze_log = ""
        self.version = 0
        self.lock = threading.Lock()
        self.last_poll = time.monotonic()
        self.import_log = ""
        self.importing = None

    def watchdog(self, stop, timeout_s):
        """The page is the only operator: if it stops polling (tab closed, laptop asleep)
        while we are playing, pause so audio and lights don't run on unattended."""
        while not stop.wait(0.25):
            if self.transport.playing and time.monotonic() - self.last_poll > timeout_s:
                self.transport.pause()
                self.analyze_log = self.analyze_log or ""
                self.paused_by_watchdog = True

    # ----- discovery ------------------------------------------------------
    def tracks(self):
        out, seen = [], set()
        for d in self.dirs:
            if not os.path.isdir(d):
                continue
            for fn in sorted(os.listdir(d)):
                if not fn.endswith(".lights.json") or fn in seen:
                    continue
                seen.add(fn)
                try:
                    with open(os.path.join(d, fn)) as fh:
                        doc = json.load(fh)
                except (OSError, ValueError):
                    continue
                if not doc.get("rig"):
                    continue                     # pre-rig streams (3-channel single PAR) would drive the wrong channels now
                out.append({"name": fn, "dir": d, "title": fn[:-len(".lights.json")],
                            "source": doc.get("source"), "style": doc.get("style"),
                            "duration": doc.get("duration"), "tempo": doc.get("tempo"),
                            "mtime": os.path.getmtime(os.path.join(d, fn))})
        return out

    def find(self, name):
        name = os.path.basename(name)
        for d in self.dirs:
            p = os.path.join(d, name)
            if os.path.isfile(p):
                return p
        return None

    @staticmethod
    def _audio_beside(lights_path, doc):
        """The audio file beside a show. The score records a .wav, but any same-named
        sibling works -- libsndfile decodes mp3/flac/ogg here -- so dropping a
        <name>.mp3 next to the show plays with no conversion step."""
        stem = os.path.splitext(os.path.basename(doc.get("wav") or doc.get("source") or ""))[0]
        if not stem:
            return None
        d = os.path.dirname(lights_path)
        for ext in (".wav", ".mp3", ".flac", ".ogg"):
            cand = os.path.join(d, stem + ext)
            if os.path.isfile(cand):
                return cand
        return None

    def audio_path(self, name):
        p = self.find(name)
        if not p:
            return None
        with open(p) as fh:
            doc = json.load(fh)
        return self._audio_beside(p, doc)

    # ----- loading --------------------------------------------------------
    def load(self, name, force=False):
        p = self.find(name)
        if not p:
            return None
        if not force and self.meta is not None and os.path.basename(p) == self.track:
            return self.meta                 # already loaded: leave the transport alone (pages re-request on every version bump)
        with open(p) as fh:
            doc = json.load(fh)
        frames = np.asarray(doc["frames"], dtype=np.uint8)
        if frames.ndim == 2 and frames.shape[1] < 41:
            # narrow (old single-PAR) stream: embed it in the park frame so the head is never sent zeros
            full = np.tile(np.asarray(park_frame(), dtype=np.uint8), (len(frames), 1))
            full[:, : frames.shape[1]] = frames
            frames = full
        is_rig = frames.ndim == 2 and frames.shape[1] >= 41
        wav = self._audio_beside(p, doc)
        audio, audio_error = None, None
        if self.audio_factory and wav:
            try:
                audio = self.audio_factory(wav)
            except Exception as e:  # noqa: BLE001
                audio_error = str(e)
        elif doc.get("wav") or doc.get("source"):
            audio_error = f"audio missing: {os.path.splitext(os.path.basename(doc.get('wav') or doc.get('source')))[0]}.[wav|mp3|flac|ogg] not beside the show"
        with self.lock:
            self.transport.load(frames, int(doc["fps"]), audio=audio,
                                gain_mask=rig.intensity_mask(frames.shape[1]) if is_rig else None,
                                park=park_frame() if is_rig else [0] * frames.shape[1])
            self.audio_error = audio_error
            self.track = os.path.basename(p)
            self.version += 1
            self.meta = {
                "name": self.track, "title": self.track[:-len(".lights.json")],
                "source": doc.get("source"), "style": doc.get("style"),
                "fps": int(doc["fps"]), "duration": doc.get("duration", len(frames) / doc["fps"]),
                "tempo": doc.get("tempo"), "beats": doc.get("beats", []),
                "downbeats": doc.get("downbeats", []), "sections": doc.get("sections", []),
                "frames": len(frames), "width": int(frames.shape[1]), "rig": doc.get("rig"),
                "phases": doc.get("phases", []),
                "audio_url": f"/audio/{self.track}" if (doc.get("wav") or doc.get("source", "")).lower().endswith((".wav", ".mp3", ".flac", ".ogg")) or audio else None,
                "version": self.version,
            }
        return self.meta

    # ----- re-analysis ----------------------------------------------------
    def analyze(self, name, style):
        p = self.find(name)
        if not p:
            return False
        with open(p) as fh:
            doc = json.load(fh)
        src = os.path.join(os.path.dirname(p), os.path.basename(doc.get("source") or ""))
        if not os.path.isfile(src):
            self.analyze_log = f"source audio not found: {src}"
            return False
        if self.analyzing:
            return False
        self.analyzing = os.path.basename(p)

        def run():
            try:
                res = subprocess.run([sys.executable, os.path.join(HERE, "analyze.py"), src, "--style", style],
                                     capture_output=True, text=True, timeout=600)
                self.analyze_log = (res.stdout + res.stderr).strip()[-2000:]
                if res.returncode == 0 and self.track == os.path.basename(p):
                    self.load(self.track, force=True)
            except Exception as e:  # noqa: BLE001
                self.analyze_log = f"analyze failed: {e}"
            finally:
                self.analyzing = None

        threading.Thread(target=run, daemon=True).start()
        return True

    # ----- hub import -----------------------------------------------------
    # ----- the effect library (readers/lights/play.js is the one render path) ----
    PLAY_JS = os.path.join(REPO, "readers", "lights", "play.js")

    def effects(self):
        """The computed library, numbered as play.js numbers it (cached)."""
        if getattr(self, "_effects", None) is None:
            res = subprocess.run(["node", self.PLAY_JS, "--list", "--json"], capture_output=True, text=True, timeout=60)
            if res.returncode != 0:
                raise RuntimeError((res.stderr or res.stdout)[-300:])
            self._effects = json.loads(res.stdout)
        return self._effects

    def play_effect(self, ident, bpm=128, bars=8):
        """Render one effect for a few bars into the first scan folder, load it into
        the transport and play from the top. Returns the effect row played."""
        ident = str(ident).strip()
        if not ident:
            raise ValueError("no effect")
        os.makedirs(self.dirs[0], exist_ok=True)
        cmd = ["node", self.PLAY_JS, ident, "--no-play", "--out", self.dirs[0],
               "--bpm", str(int(bpm)), "--bars", str(int(bars))]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if res.returncode != 0 or "rendered" not in res.stdout:
            raise RuntimeError((res.stderr or res.stdout)[-300:] or "render failed")
        meta = self.load("preview.lights.json", force=True)
        if meta is None:
            raise RuntimeError("rendered but preview.lights.json was not found in " + self.dirs[0])
        self.transport.play(0.0)
        row = next((e for e in self.effects() if e["id"] == ident or str(e["n"]) == ident), None)
        return {"effect": row or {"id": ident}, "log": res.stdout.strip().splitlines()[-1]}

    def hub_list(self):
        """Raw hub listing for .score files: name (no extension), store version, mtime.
        The store `version` counts edits, so it tells you which revision you'd pull."""
        with urllib.request.urlopen(HUB_SCORES + "/?json", timeout=8) as r:
            doc = json.load(r)
        out = []
        for p in doc.get("paths", []):
            n = str(p.get("name", ""))
            if not n.endswith(".score"):
                continue
            out.append({"name": n[:-len(".score")],
                        "version": p.get("version"),
                        "mtime": p.get("mtime")})
        return sorted(out, key=lambda d: d["name"])

    def hub_tracks(self):
        """Score entries on the hub (name + version + mtime) for the import dropdown."""
        try:
            return self.hub_list()
        except Exception as e:  # noqa: BLE001
            self.import_log = f"hub unreachable: {e}"
            return []

    def hub_version(self, name):
        """The store version the hub currently holds for `name`, or None if unknown."""
        try:
            for e in self.hub_list():
                if e["name"] == name:
                    return e["version"]
        except Exception:  # noqa: BLE001
            pass
        return None

    def _fetch_score_view(self, name):
        """The score as the protocol format_v1 view: POST /hub/score with no
        `fields` and no `window`, so nothing is filtered -- the whole song comes
        back. Falls back to the raw .score when the hub is too old to answer the
        protocol route (older deploys 405 it); bake reads either shape the same.
        Returns (view_dict, how_string)."""
        from urllib.error import HTTPError, URLError
        req = urllib.request.Request(
            HUB_SCORES, data=json.dumps({"score": name}).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                view = json.loads(r.read())
            if isinstance(view, dict) and view.get("error"):
                raise ValueError(view["error"])
            return view, "protocol POST /hub/score (unfiltered)"
        except (HTTPError, URLError, ValueError) as e:
            with urllib.request.urlopen(HUB_SCORES + "/" + name + ".score", timeout=20) as r:
                view = json.loads(r.read())
            return view, f"raw .score fallback (protocol POST unavailable: {getattr(e, 'code', None) or e})"

    def import_score(self, name, seed=3):
        """Fetch a score through the protocol path (POST /hub/score, no filters)
        and bake a .lights.json from it. Falls back to the raw .score if the hub
        has no protocol endpoint yet; bake reads either shape identically. Then
        symlink local audio if we have it, and load it."""
        name = os.path.basename(str(name)).replace(".score.json", "").replace(".score", "")
        if not name:
            self.import_log = "no score name"; return None
        self.importing = name
        try:
            ver = self.hub_version(name)   # which revision the hub holds right now
            scores = os.path.join(HERE, "scores"); os.makedirs(scores, exist_ok=True)
            raw = os.path.join(scores, name + ".score")
            view, via = self._fetch_score_view(name)
            with open(raw, "w") as fh:
                json.dump(view, fh)
            lights = os.path.join(self.dirs[0], name + ".lights.json")
            cmd = ["node", os.path.join(REPO, "readers/lights/bake.js"),
                   raw, str(seed), "--lights", lights]
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
            if res.returncode != 0:
                self.import_log = f"bake.js failed: {(res.stderr or res.stdout)[-400:]}"
                return None
            for cand in (os.path.join(REPO, "synth", "out", name + ".wav"),
                         os.path.join(EXPER, name + ".cache.wav"), os.path.join(EXPER, name + ".mp3")):
                if not os.path.isfile(cand):
                    continue
                link = os.path.join(self.dirs[0], name + ".wav")
                if os.path.abspath(cand) == os.path.abspath(link):
                    break                      # audio already in place -- never touch a real file
                try:
                    if os.path.islink(link):
                        os.remove(link)        # replace a prior symlink only
                    elif os.path.exists(link):
                        break                  # a real file is already there; leave it
                    os.symlink(cand, link)
                except OSError:
                    pass
                break
            vtag = f"v{ver}" if ver is not None else "v?"
            self.import_log = f"imported {name} {vtag} (seed {seed}) — {via}"
            meta = self.load(name + ".lights.json", force=True)
            if meta is not None:
                meta["hub_version"] = ver
            return meta
        except Exception as e:  # noqa: BLE001
            self.import_log = f"import failed: {e}"; return None
        finally:
            self.importing = None

    def phase_at(self, position):
        for ph in (self.meta or {}).get("phases", []):
            if ph["start"] <= position < ph["end"]:
                return ph["phase"]
        return None

    def status(self):
        st = self.transport.status()
        vals = st.pop("values", [])
        st.update({"track": self.track, "version": self.version, "analyzing": self.analyzing,
                   "importing": self.importing, "import_log": self.import_log,
                   "paused_by_watchdog": getattr(self, "paused_by_watchdog", False),
                   "analyze_log": self.analyze_log, "audio_error": getattr(self, "audio_error", None),
                   "server_time": time.time(), "phase": self.phase_at(st["position"]),
                   "dirs": self.dirs,   # where shows are scanned from, so a tool can write one here
                   "fixtures": rig.readout(vals) if len(vals) >= 41 else None})
        return st


def make_handler(state: State):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):
            if args and not str(args[0]).startswith(("GET /api/status", "POST /api/clock")):
                sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

        # ----- helpers -----
        def _json(self, obj, code=200):
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _body(self):
            n = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(n) or b"{}") if n else {}

        def _file(self, path, ctype):
            size = os.path.getsize(path)
            rng = self.headers.get("Range")
            start, end = 0, size - 1
            code = 200
            if rng and rng.startswith("bytes="):
                a, _, b = rng[6:].partition("-")
                start = int(a) if a else max(0, size - int(b))
                end = int(b) if (b and a) else size - 1
                end = min(end, size - 1)
                if start > end or start >= size:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                code = 206
            length = end - start + 1
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(length))
            if code == 206:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            with open(path, "rb") as fh:
                fh.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = fh.read(min(65536, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)

        # ----- routes -----
        def do_GET(self):
            path = unquote(urlparse(self.path).path)
            if path == "/":
                return self._file(UI_PATH, "text/html; charset=utf-8")
            if path == "/api/tracks":
                return self._json({"tracks": state.tracks()})
            if path == "/api/hub":
                return self._json({"scores": state.hub_tracks(), "log": state.import_log})
            if path == "/api/status":
                state.last_poll = time.monotonic()
                return self._json(state.status())
            if path == "/api/effects":
                try:
                    return self._json({"effects": state.effects()})
                except Exception as e:  # noqa: BLE001
                    return self._json({"error": str(e)}, 500)
            if path == "/api/meta":
                return self._json(state.meta or {}, 200 if state.meta else 404)
            if path.startswith("/audio/"):
                audio = state.audio_path(path[len("/audio/"):])
                if not audio:
                    return self._json({"error": "no audio for track"}, 404)
                ctype = "audio/mpeg" if audio.lower().endswith(".mp3") else \
                        "audio/wav" if audio.lower().endswith(".wav") else \
                        (mimetypes.guess_type(audio)[0] or "application/octet-stream")
                return self._file(audio, ctype)
            self._json({"error": "not found"}, 404)

        def do_POST(self):
            path = unquote(urlparse(self.path).path)
            body = self._body()
            tr = state.transport
            if path == "/api/load":
                try:
                    req = urllib.request.Request(
                        HUB_SCORES,
                        data=json.dumps(body).encode(),
                        headers={"Content-Type": "application/json"},
                        method="POST",
                    )
                    with urllib.request.urlopen(req, timeout=20) as r:
                        result = json.loads(r.read())
                    code = 200 if "error" not in result or "note" in result else 400
                    return self._json(result, code)
                except Exception as e:
                    return self._json({"error": str(e)}, 500)
            if path == "/api/show":
                # Load a baked show's frames into the transport for playback.
                # (/api/load returns the hub's protocol view; this is the play path.
                # Bakes are produced by /api/import from a hub score.)
                meta = state.load(body.get("name", ""), force=bool(body.get("force")))
                return self._json(meta, 200) if meta else \
                    self._json({"error": "show not baked yet — import it from the hub first"}, 404)
            if path == "/api/effect":
                try:
                    out = state.play_effect(body.get("id", ""), body.get("bpm", 128), body.get("bars", 8))
                    state.paused_by_watchdog = False
                    state.last_poll = time.monotonic()
                    out["status"] = state.status()
                    return self._json(out)
                except Exception as e:  # noqa: BLE001
                    return self._json({"error": str(e)}, 500)
            if path == "/api/import":
                meta = state.import_score(body.get("name", ""), int(body.get("seed", 3)))
                return self._json(meta, 200) if meta else self._json({"error": state.import_log}, 500)
            if path == "/api/play":
                state.paused_by_watchdog = False
                state.last_poll = time.monotonic()
                tr.play(None if body.get("position") is None else float(body["position"]))
                return self._json(state.status())
            if path == "/api/pause":
                tr.pause()
                return self._json(state.status())
            if path == "/api/seek":
                tr.seek(float(body.get("position", 0.0)))
                return self._json(state.status())
            if path == "/api/stop":
                tr.pause()
                tr.seek(0.0)
                tr.blackout()
                return self._json(state.status())
            if path == "/api/nudge":
                tr.nudge(float(body.get("delta", 0.0)))
                return self._json(state.status())
            if path == "/api/settings":
                if "offset_ms" in body:
                    tr.set_offset_ms(float(body["offset_ms"]))
                if "gain" in body:
                    tr.set_gain(float(body["gain"]))
                if "net" in body:
                    tr.set_net(bool(body["net"]))
                return self._json(state.status())
            if path == "/api/blackout":
                tr.blackout()
                return self._json(state.status())
            if path == "/api/analyze":
                ok = state.analyze(body.get("name") or state.track or "", body.get("style", "pulse"))
                return self._json(state.status(), 200 if ok else 409)
            self._json({"error": "not found"}, 404)

    return Handler


def make_server(host, port, dirs, sender, fps=40, audio_factory=None, watchdog_s=3.0, offset_ms=0.0):
    if audio_factory is None:
        from audio_out import make_audio   # SoundDeviceOutput if available, else pw-play
        audio_factory = make_audio
    transport = Transport(sender, fps=fps, park=park_frame())
    transport.set_offset_ms(offset_ms)
    state = State(dirs, transport, audio_factory)
    httpd = ThreadingHTTPServer((host, port), make_handler(state))
    httpd.daemon_threads = True
    stop = threading.Event()
    threading.Thread(target=transport.run_forever, args=(stop,), daemon=True).start()
    threading.Thread(target=state.watchdog, args=(stop, watchdog_s), daemon=True).start()
    httpd.state = state
    return httpd, transport, stop


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dirs", nargs="*", default=[HERE, os.path.dirname(HERE)])
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-net", action="store_true", help="start with output to the PAR disabled")
    ap.add_argument("--gain", type=float, default=1.0, help="initial brightness for PAR colours / head dimmer (0-1)")
    ap.add_argument("--offset-ms", type=float, default=0.0,
                    help="light-vs-sound offset applied at start (default 0; e.g. -240 measured on this laptop+rig makes lights 240 ms earlier)")
    ap.add_argument("--gateway", default="2.0.0.100")
    ap.add_argument("--universe", type=int, default=rig.UNIVERSE)
    args = ap.parse_args(argv)

    if args.no_net:
        # preview/audio only: never bind the Art-Net socket, so we can't touch
        # universe 0 while another sender (success-limelight's panel) holds it
        sender, wire = NullSender(), "NO OUTPUT (--no-net)"
    else:
        try:
            from artnet import Sender
            sender = Sender(gateway=args.gateway, universe=args.universe, pad_to=512)
            wire = f"{args.gateway} universe {args.universe} (512-ch frames)"
        except OSError as e:
            print(f"warning: Art-Net socket unavailable ({e}); running without output", file=sys.stderr)
            sender, wire = NullSender(), "NO OUTPUT"

    httpd, transport, stop = make_server(args.host, args.port, args.dirs, sender, offset_ms=args.offset_ms)
    if args.no_net:
        transport.set_net(False)
    transport.set_gain(args.gain)
    print(f"PAR show control: http://{args.host}:{httpd.server_address[1]}/  ->  {wire}", flush=True)
    print("tracks: " + ", ".join(t["name"] for t in httpd.state.tracks()), flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        transport.blackout()
        print("\nblacked out, server stopped.")


if __name__ == "__main__":
    main()
