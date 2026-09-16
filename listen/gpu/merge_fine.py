#!/usr/bin/env python3
import json
import os
import sys

USAGE = "\n".join(
    [
        "listen/gpu/merge_fine.py <score> <fine.json>",
        "  or  listen/gpu/merge_fine.py --all <score_dir> <fine_dir>",
        "",
        "Puts a fine instrument envelope into a score as `stems_fine`, which the",
        "baker's stream sampler prefers over `stems_temporal`. The coarse curve is",
        "left alone: the moment detectors index it by window and would have to be",
        "re-tuned to read anything else.",
    ]
)


def merge(score_path, fine_path):
    with open(score_path) as fh:
        score = json.load(fh)
    with open(fine_path) as fh:
        fine = json.load(fh)
    stems = fine.get("stems") or {}
    window = fine.get("window_s")
    if not stems or not window:
        return None
    score["stems_fine"] = {"window_s": window, "stems": stems}
    with open(score_path, "w") as fh:
        json.dump(score, fh)
    coarse = (score.get("stems_temporal") or {}).get("window_s")
    lanes = len(stems)
    n = len(next(iter(stems.values())))
    return (
        f"{os.path.basename(score_path)}: {lanes} lanes at {window}s "
        f"({n} windows), coarse stays {coarse}s"
    )


def find_score(score_dir, slug):
    hit = None
    for root, _dirs, files in os.walk(score_dir):
        if slug not in root:
            continue
        for f in files:
            if f.endswith(".score"):
                hit = os.path.join(root, f)
    return hit


def main(argv):
    if len(argv) >= 4 and argv[1] == "--all":
        score_dir, fine_dir = argv[2], argv[3]
        done = 0
        for name in sorted(os.listdir(fine_dir)):
            if not name.endswith(".json"):
                continue
            slug = name[:-5]
            hit = find_score(score_dir, slug)
            if not hit:
                print(f"{slug}: no score found")
                continue
            line = merge(hit, os.path.join(fine_dir, name))
            if line:
                print(line)
                done += 1
        print(f"{done} scores carry a fine envelope")
        return 0
    if len(argv) < 3:
        print(USAGE)
        return 2
    line = merge(argv[1], argv[2])
    if not line:
        print("nothing to merge")
        return 1
    print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
