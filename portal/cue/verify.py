import json
import os
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
BASE = os.environ.get("LIMELIGHT_PORTAL", "http://localhost:3000")


def bake_local(song, out):
    r = subprocess.run(
        ["node", os.path.join(HERE, "bake.js"), song, "--out", out],
        cwd=REPO, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit("local bake failed: " + (r.stderr or r.stdout).strip()[-300:])
    return json.load(open(out))


def bake_server(song, rig=None):
    body = {"song": song, "seed": 1}
    if rig:
        body["layout"] = rig
    req = urllib.request.Request(BASE + "/api/show", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    job = json.load(urllib.request.urlopen(req, timeout=30))["job"]
    for _ in range(120):
        st = json.load(urllib.request.urlopen(BASE + "/api/show?job=%s" % job, timeout=30))
        if st.get("state") in ("ready", "failed"):
            break
        time.sleep(0.5)
    if st.get("state") != "ready":
        raise SystemExit("server bake failed: %s" % st.get("error"))
    return urllib.request.urlopen(BASE + st["frames_url"], timeout=120).read()


def main():
    song = sys.argv[1] if len(sys.argv) > 1 else "raga-of-revenge"
    out = os.path.join("/tmp", "%s.verify.json" % song)
    mine = bake_local(song, out)
    blob = bake_server(song)
    frames = mine["frames"]
    width = len(frames[0])
    lamps = set()
    for f in mine["fixtures"]:
        if f["type"].startswith("par"):
            lamps.update(range(f["address"] - 1, f["address"] - 1 + 7))
    if len(blob) != len(frames) * width:
        raise SystemExit("shape mismatch: server %d bytes, local %d x %d"
                         % (len(blob), len(frames), width))
    par_bad = 0
    par_worst = 0
    head_ratios = []
    head_blank = 0
    for i, f in enumerate(frames):
        row = blob[i * width:(i + 1) * width]
        for c in range(width):
            d = abs(row[c] - f[c])
            if not d:
                continue
            if c in lamps:
                par_bad += 1
                par_worst = max(par_worst, d)
            elif f[c] > 0:
                if row[c] == 0:
                    head_blank += 1
                else:
                    head_ratios.append(row[c] / f[c])
    head_ratios.sort()
    med = head_ratios[len(head_ratios) // 2] if head_ratios else 1.0
    print("  %s: %d frames x %d channels" % (song, len(frames), width))
    print("  par channels differing from the emulator : %d (worst %d)" % (par_bad, par_worst))
    print("  head/mover samples scaled by the venue   : %d (median ratio %.3f)"
          % (len(head_ratios), med))
    print("  head frames the venue blanks             : %d (%.2fs)"
          % (head_blank, head_blank / float(mine.get("fps", 40))))
    if par_bad:
        print("\n  FAIL: what the emulator shows is not what was designed")
        return 1
    print("\n  the pars on screen are the pars that were designed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
