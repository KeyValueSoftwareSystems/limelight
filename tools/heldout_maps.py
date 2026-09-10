#!/usr/bin/env python3
"""Build a map for each held-out recording, into synth/maps/heldout.

    python3 tools/heldout_maps.py

Only listen/ear.py runs here -- grid, beats, downbeats, chapters, moments, spans,
energy and sections, all stdlib. The heavier steps (stems, MERT, MuQ, chords) are
tools/pipeline.sh and need the environments; a map without them still drives the
video reader, with salience falling back to the evidence that is present.

These maps exist so the video lane can be run over music nobody here has tuned
against. Do not change a constant anywhere in the repo because of what they say.
"""
import json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAT = os.path.join(ROOT, "songs", "heldout", "HELDOUT.json")
OUT = os.path.join(ROOT, "synth", "maps", "heldout")


def main():
    if not os.path.exists(CAT):
        print("no held-out catalogue -- run tools/mkheldout.py first", file=sys.stderr)
        return 2
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(os.path.join(ROOT, "synth", "out"), exist_ok=True)
    tracks = json.load(open(CAT))["tracks"]
    ok = missing = failed = 0
    for t in tracks:
        src = os.path.join(ROOT, t["file"])
        if not os.path.exists(src):
            print(f"  {t['slug'][:44]:46} audio missing (gitignored; "
                  f"re-run tools/mkheldout.py)", file=sys.stderr)
            missing += 1
            continue
        wav = os.path.join(ROOT, "synth", "out", t["slug"] + ".wav")
        if not os.path.exists(wav):
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src,
                            "-ac", "1", "-ar", "32000", wav], check=False)
        mp = os.path.join(OUT, t["slug"] + ".map.json")
        if os.path.exists(mp) and os.path.getsize(mp) > 0:
            ok += 1
            continue
        with open(mp, "w") as f:
            r = subprocess.run(["python3", os.path.join(ROOT, "listen", "ear.py"), wav],
                               stdout=f, stderr=subprocess.DEVNULL)
        if r.returncode != 0 or os.path.getsize(mp) == 0:
            os.remove(mp)
            failed += 1
            print(f"  {t['slug'][:44]:46} ear.py failed", file=sys.stderr)
        else:
            ok += 1
    print(f"{ok} maps in synth/maps/heldout, {failed} failed, {missing} without audio",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
