#!/usr/bin/env python3
"""What is actually in each shot, described by a model that can see it.

    python3 assets/describe.py --set apple5c --sheet      # frames to look at
    python3 assets/describe.py --set apple5c --write c.json

WHY. Everything this lane knows about picture content comes from CLIP scored
against 37 fixed phrases, and the winning phrase beats the runner-up by about
one percent -- a median top cosine of 0.23-0.27, which is what CLIP returns for
any caption against any image. A night-city pool comes back labelled "a road in
daylight" four times in sixteen shots. Every downstream thing that reasons about
meaning is built on that, which is why the cuts land and the clips still read as
random.

WHAT CHANGES. A model looks at the frames and writes what it sees, in its own
words, with no vocabulary to choose from. The result is committed beside the
index like any other measurement.

WHY THIS DOES NOT BREAK ANYTHING. `frame = f(map, layout, recipe, t)` protects
the FRAME FUNCTION: ask for t=47 twice, get identical bytes. It says nothing
about authoring. The model runs here, at index time, and what it writes is a
file in git that a person can read and argue with -- the same standing as a
measured beat grid, and the same standing readers/video/policy_llm.js already
gives a committed intent.json. Nothing calls a model while an edit is running.

PROVENANCE. `how: model` and the model's name, because AGENTS.md is explicit
that a guess and a measurement must never look alike. A caption is neither a
measurement nor a guess -- it is a reading, and it says so.
"""
import argparse, json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.join(ROOT, "assets")


def shots_of(setname):
    ix = json.load(open(os.path.join(HERE, "stock", setname, "INDEX.json")))
    out = []
    for c in ix.get("clips", []):
        for i, sh in enumerate(c.get("shots", [])):
            out.append({"clip_id": c["clip_id"], "file": c["file"], "shot": i,
                        "start": sh["start"], "end": sh["end"],
                        "duration": round(sh["end"] - sh["start"], 3)})
    return out


def sheet(setname, out_dir, per=12, width=320):
    """Contact sheets: one frame per shot, numbered, so a reader can say which
    shot it is describing. The middle of the shot, because the first frame of a
    cut is often a transition."""
    os.makedirs(out_dir, exist_ok=True)
    sh = shots_of(setname)
    made = []
    for base in range(0, len(sh), per):
        group = sh[base:base + per]
        tiles = []
        for s in group:
            src = os.path.join(HERE, s["file"])
            tile = os.path.join(out_dir, f"_t{s['shot']:03d}.png")
            mid = s["start"] + (s["end"] - s["start"]) / 2
            subprocess.run(["ffmpeg", "-nostdin", "-y", "-v", "error",
                            "-ss", f"{mid:.3f}", "-i", src, "-frames:v", "1",
                            "-vf", f"scale={width}:-2,drawtext=text='{s['shot']}':"
                                   "x=6:y=6:fontsize=28:fontcolor=yellow:"
                                   "box=1:boxcolor=black@0.7:boxborderw=5",
                            tile], check=False)
            if os.path.exists(tile):
                tiles.append(tile)
        if not tiles:
            continue
        # Renumber to a contiguous sequence and let `tile` read it as one input.
        # Passing each frame as its own -i and asking for tile= silently kept
        # only the first: tile works on a SEQUENCE, not on many inputs.
        seq = os.path.join(out_dir, "_seq")
        os.makedirs(seq, exist_ok=True)
        for j, t in enumerate(tiles):
            os.replace(t, os.path.join(seq, f"f{j:03d}.png"))
        page = os.path.join(out_dir, f"{setname}-{base // per:02d}.png")
        cols = 4
        rows_n = (len(tiles) + cols - 1) // cols
        subprocess.run(["ffmpeg", "-nostdin", "-y", "-v", "error",
                        "-i", os.path.join(seq, "f%03d.png"),
                        "-vf", f"tile={cols}x{rows_n}:padding=6:color=0x202020",
                        "-frames:v", "1", page], check=False)
        for f in os.listdir(seq):
            os.remove(os.path.join(seq, f))
        os.rmdir(seq)
        if os.path.exists(page):
            made.append(page)
    return made, sh


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", dest="setname", required=True)
    ap.add_argument("--sheet", action="store_true")
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--write", help="JSON of {shot: caption} to commit")
    ap.add_argument("--by", default="claude-opus-5 (Claude Code, at index time)")
    a = ap.parse_args()

    if a.sheet:
        d = a.out_dir or os.path.join(ROOT, "renders", "_sheets", a.setname)
        pages, sh = sheet(a.setname, d)
        print(f"{len(sh)} shots -> {len(pages)} sheet(s)")
        for p in pages:
            print("  " + p)
        return 0

    if a.write:
        caps = json.load(open(a.write))
        sh = {s["shot"]: s for s in shots_of(a.setname)}
        rows = []
        for k, v in sorted(caps.items(), key=lambda kv: int(kv[0])):
            i = int(k)
            if i not in sh:
                print(f"no shot {i} in {a.setname}", file=sys.stderr); return 1
            d = {"says": v} if isinstance(v, str) else v
            rows.append({"clip_id": sh[i]["clip_id"], "shot": i,
                         "duration": sh[i]["duration"], "says": d.get("says"),
                         "role": d.get("role"), "subject": d.get("subject")})
        doc = {"note": ("What a model saw in each shot, in its own words. Not a "
                        "score against a fixed vocabulary -- there was no "
                        "vocabulary. Written at index time and committed, so the "
                        "edit path never calls a model."),
               "set": a.setname,
               "subject": ("How much of the film's SUBJECT is in each shot, 0 to 1, "
                           "authored by the model that looked at them. This "
                           "replaces a CLIP cosine against 37 fixed phrases whose "
                           "winner beat the runner-up by about one percent."),
               "roles": ("What a shot is FOR, which is not the same as what is in "
                         "it. `hold` marks the ones a film is built toward -- a "
                         "reveal, an end card -- and a reader must not spend them "
                         "in a flurry however loud the music is there. `skip` is "
                         "leader and tail. Absent means ordinary."),
               "made_by": {"how": "model", "who": a.by,
                           "saw": "one frame from the middle of each shot",
                           "note": ("A reading, not a measurement and not a "
                                    "guess. It can be wrong in ways a person "
                                    "can see, which is the point of committing "
                                    "it.")},
               "shots": rows}
        p = os.path.join(HERE, "stock", a.setname, "DESCRIBED.json")
        json.dump(doc, open(p, "w"), indent=1); open(p, "a").write("\n")
        print(f"{len(rows)} captions -> {p}")
        return 0

    print("give --sheet or --write", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
