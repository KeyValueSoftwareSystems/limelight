#!/usr/bin/env python3
"""The folder and the hub must give the same answer, byte for byte.

The whole point of reading scores from a folder is that it is not a different
system -- it is the same responder with a different way of finding the file. If
the two ever diverge, a show baked from a folder and a show baked from the hub
are different shows, and nothing would say so.

Needs a hub running (tools/local-stack.sh). Skips, loudly, if there is none.
"""
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
HUB = os.environ.get("LIMELIGHT_HUB", "http://127.0.0.1:8770")

CASES = [
    {},
    {"fields": ["grid", "sections"]},
    {"fields": ["curves", "signals"], "curves": ["pace", "energy"]},
    {"fields": ["signals", "melody"], "window": {"from_bar": 25, "bars": 9}},
    {"fields": ["moments"], "moments": {"min_weight": 0.6}},
    {"fields": ["stems"], "stems": ["drums", "vocals"]},
]

out = []
def ok(name, cond, detail=""):
    out.append((bool(cond), name, detail))

def from_hub(body):
    req = urllib.request.Request(HUB + "/hub/score", method="POST",
                                 data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

def from_folder(body):
    sys.path.insert(0, os.path.join(REPO, "hub"))
    import score_api as S
    at = None
    for d in ("scores", os.path.join("hub", "files", "score")):
        p = os.path.join(REPO, d, body["score"] + ".score")
        if os.path.isfile(p):
            at = p
            break
    with open(at) as f:
        raw = json.load(f)
    return S.handle(dict(body), lambda name, personality=None: raw)

try:
    listing = json.load(urllib.request.urlopen(HUB + "/hub/score/?json", timeout=5))
except (urllib.error.URLError, OSError) as e:
    print(f"NO HUB at {HUB} -- nothing was compared.\n  start one: tools/local-stack.sh\n  ({e})")
    sys.exit(2)

songs = [p["name"][:-len(".score")] for p in listing.get("paths", [])
         if p.get("name", "").endswith(".score")]
ok("the hub has scores to compare against", bool(songs), f"{len(songs)}: {', '.join(songs)}")

for song in songs:
    for case in CASES:
        body = {"score": song, **case}
        label = f"{song} {json.dumps(case) if case else '(whole song)'}"
        try:
            h, f = from_hub(body), from_folder(body)
        except Exception as e:          # noqa: BLE001
            ok(label, False, f"raised: {e}")
            continue
        same = json.dumps(h, sort_keys=True) == json.dumps(f, sort_keys=True)
        detail = ""
        if not same:
            hk, fk = set(h), set(f)
            if hk != fk:
                detail = f"fields differ: hub-only {sorted(hk-fk)}, folder-only {sorted(fk-hk)}"
            else:
                for k in sorted(hk):
                    if json.dumps(h[k], sort_keys=True) != json.dumps(f[k], sort_keys=True):
                        detail = f"first difference in {k!r}"
                        break
        ok(label, same, detail)

bad = [r for r in out if not r[0]]
for passed, name, detail in out:
    if not passed:
        print(f"  FAIL  {name}\n        {detail}")
print(f"\n{len(bad)} of {len(out)} FAILED" if bad
      else f"\nall {len(out)} checks pass — the folder and the hub agree")
sys.exit(1 if bad else 0)
