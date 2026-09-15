#!/usr/bin/env python3
"""The panel's presets API: the recipes on disk and the arranger's reasoning for
one of them, fetched through the same node path the page uses
(readers/lights/explain.js). Checked twice: State's methods directly with a
stand-in transport, and the HTTP routes on a private server with no output and
no audio. Needs node and the venv python (numpy)."""
import json
import os
import socket
import sys
import tempfile
import threading
import time
import urllib.request
from urllib.error import HTTPError

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
import server  # noqa: E402

PASS = FAIL = 0


def ok(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok  {label}")
    else:
        FAIL += 1
        print(f"FAIL  {label}" + (f" -- {detail}" if detail else ""))


class _Transport:
    """As much transport as State needs when nothing plays."""
    playing = False

    def status(self):
        return {"position": 0.0, "duration": 0.0, "loaded": False, "values": []}


with tempfile.TemporaryDirectory() as shows, tempfile.TemporaryDirectory() as recipes:
    # recipes that only need the committed fixture (protocol/levels.score), so the
    # test runs on a fresh clone
    with open(os.path.join(recipes, "whole-levels.json"), "w") as f:
        json.dump({"name": "whole-levels", "song": "levels", "tests": "does the show escalate?",
                   "find": "whole-song", "effects": ["escalates", "speed-rises"]}, f)
    with open(os.path.join(recipes, "nowhere.json"), "w") as f:
        json.dump({"name": "nowhere", "song": "no-such-song-xyz", "find": "whole-song", "effect": "glides"}, f)
    # a baked show for levels in the scan dir, so the recipe can say which show to play
    with open(os.path.join(shows, "levels.lights.json"), "w") as f:
        json.dump({"rig": "arc4-head", "fps": 40, "duration": 1.0, "frames": [[0] * 41]}, f)
    server.PRESETS_DIR = recipes

    # ---- State ---------------------------------------------------------------
    st = server.State([shows], _Transport())
    rows = st.presets()
    by = {r["name"]: r for r in rows}
    ok("every recipe in the presets folder is listed", set(by) == {"whole-levels", "nowhere"}, str(sorted(by)))
    ok("a recipe says where its score is, or that it is not here",
       by["whole-levels"]["score_path"] and by["nowhere"]["score_path"] is None)
    ok("a recipe names the baked show for its song when one is in the scan dirs",
       by["whole-levels"]["show"] == "levels.lights.json" and by["nowhere"]["show"] is None, str(by["whole-levels"].get("show")))
    ok("the effects under test come with their measurement",
       by["whole-levels"]["effects"][0] == {"name": "escalates", "measure": "each return bigger than the last", "check": "escalates"},
       json.dumps(by["whole-levels"]["effects"]))

    t0 = time.monotonic()
    doc = st.explain_preset("whole-levels", 7)
    first = time.monotonic() - t0
    ok("the explanation is the arranger's: draws with pools and odds, per-bar facts, a likely list",
       doc.get("seed") == 7 and doc["draws"] and all(d["pool"] for d in doc["draws"]) and doc["bars"] and doc["likely"],
       doc.get("error", ""))
    ok("the window is what the recipe's finder found", doc["window"]["why"] == "the whole song" and doc["window"]["from_bar"] == 1)
    ok("the doc carries the recipe (tests, effects) and where the score came from",
       doc["recipe"]["tests"] == "does the show escalate?" and len(doc["recipe"]["effects"]) == 2 and doc["score_path"])
    t0 = time.monotonic()
    again = st.explain_preset("whole-levels", "7")
    ok("the same preset and seed is served from the cache", again is doc and time.monotonic() - t0 < first / 2)
    other = st.explain_preset("whole-levels", 8)
    ok("another seed is another explanation", other is not doc and other["seed"] == 8)
    os.utime(os.path.join(recipes, "whole-levels.json"), None)
    time.sleep(0.02)
    fresh = st.explain_preset("whole-levels", 7)
    ok("touching the recipe drops the cached explanation", fresh is not doc and fresh["seed"] == 7)
    miss = st.explain_preset("nowhere", 3)
    ok("a song with no score here is an error the page can show, not an exception",
       "error" in miss and "no score" in miss["error"] and miss["recipe"]["name"] == "nowhere", miss.get("error"))
    try:
        st.explain_preset("../server", 3)
        ok("an unknown preset raises", False)
    except FileNotFoundError as e:
        ok("an unknown preset raises (and the name is a basename, never a path)", "no preset called server" in str(e), str(e))

    # ---- HTTP ----------------------------------------------------------------
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    httpd, transport, stop = server.make_server("127.0.0.1", port, [shows], server.NullSender(),
                                                audio_factory=lambda wav: None)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"

    def get(path):
        try:
            with urllib.request.urlopen(base + path, timeout=120) as r:
                return r.status, json.loads(r.read())
        except HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    try:
        code, body = get("/api/presets")
        ok("GET /api/presets lists the recipes", code == 200 and {r["name"] for r in body["presets"]} == {"whole-levels", "nowhere"}, f"{code} {body}"[:200])
        code, body = get("/api/preset?name=whole-levels&seed=7")
        ok("GET /api/preset explains one recipe at a seed", code == 200 and body["seed"] == 7 and body["draws"] and body["likely"], f"{code}")
        code, body = get("/api/preset?name=nowhere")
        ok("a recipe whose score is missing answers 422 with the reason", code == 422 and "no score" in body["error"], f"{code} {body.get('error')}")
        code, body = get("/api/preset?name=nope")
        ok("an unknown recipe answers 404", code == 404 and "no preset" in body["error"], f"{code} {body}")
        code, body = get("/api/preset")
        ok("no name answers 404", code == 404, f"{code}")
    finally:
        stop.set()
        httpd.shutdown()
        httpd.server_close()

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
