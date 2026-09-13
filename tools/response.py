#!/usr/bin/env python3
"""The protocol response for a score on this machine, with no server running.

The hub answers POST /hub/score by loading a .score and handing it to
hub/score_api.py. That is the only thing it does to a score, so the same answer
is available from a folder -- which matters when the hub is somebody else's
laptop and that laptop has gone.

    tools/response.py levels                          the whole song
    tools/response.py levels --fields curves,signals  only those
    tools/response.py levels --from 25 --bars 9       a window
    tools/response.py levels --out out.json           write it
    tools/response.py --list                          what this machine holds

Scores are looked for in scores/ first, then the hub's own store, so dropping
files Muzammil sends into scores/ is the whole setup.
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(REPO, "hub"))
import score_api as S  # noqa: E402

FOLDERS = [os.path.join(REPO, "scores"),
           os.path.join(REPO, "hub", "files", "score")]


def folder_of(name):
    for d in FOLDERS:
        at = os.path.join(d, name + ".score")
        if os.path.isfile(at):
            return at
    return None


def known():
    seen, out = set(), []
    for d in FOLDERS:
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if f.endswith(".score") and f[:-6] not in seen:
                seen.add(f[:-6])
                out.append((f[:-6], os.path.join(d, f)))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(add_help=True, description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("score", nargs="?", help="the song, without .score")
    ap.add_argument("--fields", help="comma-separated; omit for everything")
    ap.add_argument("--curves", help="comma-separated curve names")
    ap.add_argument("--stems", help="comma-separated stem names")
    ap.add_argument("--from", dest="from_bar", type=int, help="window start bar")
    ap.add_argument("--bars", type=int, help="window length in bars")
    ap.add_argument("--min-weight", type=float, help="only moments at or above this")
    ap.add_argument("--out", help="write here instead of printing")
    ap.add_argument("--list", action="store_true", help="scores on this machine")
    a = ap.parse_args(argv)

    if a.list or not a.score:
        rows = known()
        if not rows:
            print("no scores on this machine. Put .score files in scores/ and try again.")
            return 2
        print(f"{len(rows)} score(s):")
        for name, at in rows:
            print(f"  {name:38} {os.path.getsize(at) // 1024:>5} KB   {os.path.relpath(at, REPO)}")
        return 0

    at = folder_of(a.score)
    if not at:
        print(f"no score called {a.score!r}. Looked in:", file=sys.stderr)
        for d in FOLDERS:
            print("   " + os.path.relpath(d, REPO), file=sys.stderr)
        return 3

    body = {"score": a.score}
    if a.fields:
        body["fields"] = [f.strip() for f in a.fields.split(",") if f.strip()]
    if a.curves:
        body["curves"] = [c.strip() for c in a.curves.split(",") if c.strip()]
    if a.stems:
        body["stems"] = [c.strip() for c in a.stems.split(",") if c.strip()]
    if a.from_bar is not None:
        body["window"] = {"from_bar": a.from_bar, "bars": a.bars}
    if a.min_weight is not None:
        body["moments"] = {"min_weight": a.min_weight}

    with open(at) as f:
        raw = json.load(f)
    out = S.handle(body, lambda name, personality=None: raw)

    text = json.dumps(out, indent=1)
    if a.out:
        with open(a.out, "w") as f:
            f.write(text)
        print(f"{os.path.relpath(a.out)}  {len(text) // 1024} KB  "
              f"({len(out)} fields from {os.path.relpath(at, REPO)})")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
