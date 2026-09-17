import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "work")
CUES = os.path.join(HERE, "cue", "shows")
SHOWFILES = os.path.join(HERE, "showfiles")
SCHEMA = "limelight.show/1"
CARRY = ("plan", "palette", "states", "bindings", "gestures", "effects", "cues", "rig", "accents", "effects")


def source_for(song):
    cues = os.path.join(CUES, "%s.cues.json" % song)
    if os.path.isfile(cues):
        return cues
    return os.path.join(WORK, "%s.plan.json" % song)


def publish(song, plan_path=None, out_dir=None):
    plan_path = plan_path or source_for(song)
    out_dir = out_dir or SHOWFILES
    if not os.path.isfile(plan_path):
        raise SystemExit("no plan at %s" % plan_path)
    with open(plan_path) as fh:
        plan = json.load(fh)

    show = {"schema": SCHEMA, "song": song}
    for key in CARRY:
        if key in plan and plan[key] not in (None, [], {}):
            show[key] = plan[key]
    for key in ("states", "bindings", "gestures"):
        show.setdefault(key, [])

    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "%s.show.json" % song)
    tmp = out + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(show, fh, indent=1)
    os.replace(tmp, out)
    return out, show


def main():
    ap = argparse.ArgumentParser(
        description="Publish a composed plan as the song's show file, which is what the editor reads."
    )
    ap.add_argument("song")
    ap.add_argument("--plan", default=None)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    src = args.plan or source_for(args.song)
    out, show = publish(args.song, src, args.out)
    counts = " ".join(
        "%s %d" % (k, len(show[k]))
        for k in ("states", "bindings", "gestures")
        if k in show
    )
    extra = [k for k in ("palette", "effects") if k in show]
    print(
        "published %s from %s -> %s (%s%s)"
        % (
            args.song,
            os.path.relpath(src, HERE),
            out,
            counts,
            "".join(", %s %d" % (k, len(show[k])) for k in extra),
        ),
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
