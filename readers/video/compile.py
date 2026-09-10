#!/usr/bin/env python3
"""Video IR -> an actual mp4. The only thing in this lane that knows ffmpeg exists.

    python3 readers/video/compile.py renders/levels.premium.rules.ir.json

DETERMINISTIC, and that word is doing work. Given the same IR, the same clips and
the same audio, this writes the same edit every time. It makes no creative
decision whatsoever: every in-point, duration and clip choice was settled by the
policy and is read out of the file. If something looks wrong in the output, the
policy is where it went wrong, and that separation is the only reason the A/B
between policies means anything.

WHAT IT REFUSES. A gap in the timeline, an overlap, a clip that is not in the
index, an in-point past the end of its source. All of these could be papered
over -- hold the last frame, cut to black, clamp the seek -- and all of them
would turn a policy bug into a video that plays. The repo has already paid for
silent failures twice; they cost an hour each. It fails with the offending times.

CONFORMING. The clips are 23.976, 24, 25 and 30 fps and both orientations. Every
segment is scaled to COVER the output frame and centre-cropped, then forced to
the brief's frame rate. Cover-and-crop rather than letterbox because a brief that
asks for 9:16 wants a full frame, and because black bars would be a creative
decision this file is not allowed to make.
"""
import argparse, json, os, subprocess, sys, tempfile, shutil
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "listen"))
from mapio import release_path


def load_index():
    p = os.path.join(ROOT, "assets", "INDEX.json")
    d = json.load(open(p))
    return {c["clip_id"]: c for c in d["clips"]}


def check(ir, index):
    """Every reason to refuse, collected before anything is rendered."""
    bad = []
    tl = ir["timeline"]
    if not tl:
        return ["timeline is empty"]
    dur = ir["song"]["length_s"]
    if abs(tl[0]["start"]) > 0.02:
        bad.append(f"timeline starts at {tl[0]['start']}, not 0")
    for i, e in enumerate(tl):
        if e["end"] <= e["start"]:
            bad.append(f"[{i}] end {e['end']} <= start {e['start']}")
        if i and abs(e["start"] - tl[i - 1]["end"]) > 0.002:
            bad.append(f"[{i}] starts {e['start']} but [{i-1}] ended "
                       f"{tl[i-1]['end']} -- gap or overlap")
        c = index.get(e["clip_id"])
        if not c:
            bad.append(f"[{i}] clip {e['clip_id']} is not in the index")
            continue
        need = e["in_s"] + (e["end"] - e["start"])
        if need > c["duration_s"] + 0.05:
            bad.append(f"[{i}] {e['clip_id']} needs {need:.2f}s but is "
                       f"{c['duration_s']:.2f}s long")
        if "because" not in e:
            bad.append(f"[{i}] has no `because` -- IR.md requires one")
    if abs(tl[-1]["end"] - dur) > 0.05:
        bad.append(f"timeline ends at {tl[-1]['end']}, song is {dur}")
    return bad


def segment(job):
    i, e, clip, fmt, tmp = job
    w, h, fps = fmt["width"], fmt["height"], fmt["fps"]
    out = os.path.join(tmp, f"seg{i:05d}.mp4")
    src = os.path.join(ROOT, "assets", clip["file"])
    vf = (f"scale={w}:{h}:force_original_aspect_ratio=increase,"
          f"crop={w}:{h},fps={fps},setsar=1")
    r = subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-ss", f"{e['in_s']:.3f}",
         "-t", f"{e['end'] - e['start']:.3f}", "-i", src,
         "-vf", vf, "-an", "-c:v", "libx264", "-preset", "veryfast",
         "-crf", "20", "-pix_fmt", "yuv420p", out],
        capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(out):
        return i, None, r.stderr.strip()[:200]
    return i, out, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ir")
    ap.add_argument("--out")
    ap.add_argument("--jobs", type=int, default=6)
    ap.add_argument("--no-audio", action="store_true")
    a = ap.parse_args()

    ir = json.load(open(a.ir))
    index = load_index()
    bad = check(ir, index)
    if bad:
        print(f"REFUSED: {a.ir}", file=sys.stderr)
        for b in bad[:20]:
            print("  " + b, file=sys.stderr)
        if len(bad) > 20:
            print(f"  ... and {len(bad)-20} more", file=sys.stderr)
        return 1

    out = a.out or os.path.splitext(os.path.splitext(a.ir)[0])[0] + ".mp4"
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    fmt = ir["format"]
    tmp = tempfile.mkdtemp(prefix="limelight-edit-")
    try:
        jobs = [(i, e, index[e["clip_id"]], fmt, tmp)
                for i, e in enumerate(ir["timeline"])]
        segs = [None] * len(jobs)
        with ThreadPoolExecutor(max_workers=a.jobs) as ex:
            for i, p, err in ex.map(segment, jobs):
                if p is None:
                    print(f"segment {i} failed: {err}", file=sys.stderr)
                    return 1
                segs[i] = p
        listing = os.path.join(tmp, "list.txt")
        with open(listing, "w") as f:
            for p in segs:
                f.write(f"file '{p}'\n")
        silent = os.path.join(tmp, "silent.mp4")
        r = subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0",
             "-i", listing, "-c", "copy", silent], capture_output=True, text=True)
        if r.returncode != 0:
            print("concat failed: " + r.stderr[:300], file=sys.stderr)
            return 1

        audio = None if a.no_audio else release_path(ir["song"]["slug"])
        if audio:
            r = subprocess.run(
                ["ffmpeg", "-v", "error", "-y", "-i", silent, "-i", audio,
                 "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
                 "-c:a", "aac", "-b:a", "192k",
                 "-t", f"{ir['song']['length_s']:.3f}", "-shortest", out],
                capture_output=True, text=True)
            if r.returncode != 0:
                print("mux failed: " + r.stderr[:300], file=sys.stderr)
                return 1
        else:
            shutil.move(silent, out)
            if not a.no_audio:
                print(f"note: no release audio found for "
                      f"{ir['song']['slug']} -- video is silent", file=sys.stderr)
        mb = os.path.getsize(out) / 1e6
        print(f"{len(segs)} shots, {mb:.1f} MB -> {out}", file=sys.stderr)
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
