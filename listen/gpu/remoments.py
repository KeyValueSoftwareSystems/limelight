"""Re-derive moments over finished .score files.

Everything the detector needs is already in the score, so a change to the
rules does not cost a GPU run. Same module the pipeline calls.

    python3 remoments.py score-out/*.score
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import moments as M


def main(paths):
    for path in paths:
        try:
            with open(path) as fh:
                score = json.load(fh)
        except Exception as e:
            print(f"{os.path.basename(path)}: unreadable ({e})")
            continue
        was = len(score.get("moments") or [])
        got = M.find(score.get("stems_temporal"),
                     [b["t"] for b in score.get("beats") or [] if "t" in b],
                     score.get("grid"), score.get("btc_chords_raw"))
        if not got:
            print(f"{os.path.basename(path)}: no stem lanes to read, left alone")
            continue
        score["moments"] = got
        with open(path, "w") as fh:
            json.dump(score, fh)
        kinds = {}
        for m in got:
            kinds[m["type"]] = kinds.get(m["type"], 0) + 1
        shape = " ".join(f"{k}:{v}" for k, v in sorted(kinds.items()))
        print(f"{os.path.basename(path)}: {was} -> {len(got)}  {shape}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(2)
    main(sys.argv[1:])
