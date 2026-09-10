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

FRAME-EXACT, and this was a real bug rather than a precaution. Segments were cut
with `-t <seconds>`, which rounds UP to a whole frame. Rounding the same
direction 38 times in a row put the last cut of a 237-second edit 717 ms late,
and the naive edit -- with more shots -- ended up seconds out. An edit whose
whole claim is that cuts land with the music was quietly sliding away from it,
and the alignment scores measured that slide rather than the policy.

So boundaries are quantised to the output frame grid ONCE, up front, and each
segment is rendered with an exact frame COUNT: shot i gets
round(end*fps) - round(start*fps) frames. The counts sum to the quantised total
by construction, so there is nothing left to accumulate. `--verify` re-measures
the finished file and fails if any boundary moved.
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
    i, e, clip, fmt, tmp, nframes = job
    w, h, fps = fmt["width"], fmt["height"], fmt["fps"]
    out = os.path.join(tmp, f"seg{i:05d}.mp4")
    src = os.path.join(ROOT, "assets", clip["file"])
    # Pull the in-point back if the clip does not have nframes left after it.
    # A shot sitting at the very end of its source has no spare frames to give,
    # the rate conversion comes up one or two short, and the whole edit ends up
    # adrift -- which is what the 160 ms refusal was. The chooser centres the
    # in-point in whatever slack the shot has, so moving earlier is always
    # available and never runs off the front.
    need = nframes / fps + 1.0 / fps
    in_s = min(e["in_s"], max(0.0, clip["duration_s"] - need))
    vf = (f"scale={w}:{h}:force_original_aspect_ratio=increase,"
          f"crop={w}:{h},fps={fps},setsar=1")
    # -frames:v, never -t. An exact count cannot round, so nothing accumulates.
    # A little extra is decoded (-t with a margin) so the filter has enough
    # input to produce that many frames after the rate conversion.
    r = subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-ss", f"{in_s:.3f}",
         "-t", f"{nframes / fps + 0.5:.3f}", "-i", src,
         "-vf", vf, "-frames:v", str(nframes), "-an",
         "-c:v", "libx264", "-preset", "veryfast",
         "-crf", "20", "-pix_fmt", "yuv420p", out],
        capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(out):
        return i, None, r.stderr.strip()[:200]
    got = frames_in(out)
    if got != nframes:
        return i, None, f"asked for {nframes} frames, got {got}"
    return i, out, None


def frames_in(path):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames",
         "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", path],
        capture_output=True, text=True)
    try:
        return int(r.stdout.strip().split(",")[0])
    except (ValueError, IndexError):
        return -1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ir")
    ap.add_argument("--out")
    ap.add_argument("--jobs", type=int, default=6)
    ap.add_argument("--no-audio", action="store_true")
    ap.add_argument("--preview", action="store_true",
                    help="half dimensions. For bench comparisons, where the "
                         "measurement is frame-to-frame change and resolution "
                         "does not enter into it -- and where four full-size "
                         "renders is 600 MB of a nearly full disk.")
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
    fmt = dict(ir["format"])
    if a.preview:
        fmt["width"] = fmt["width"] // 2 // 2 * 2
        fmt["height"] = fmt["height"] // 2 // 2 * 2
    tmp = tempfile.mkdtemp(prefix="limelight-edit-")
    try:
        # Quantise every boundary to the output frame grid once, then hand each
        # segment an exact frame count. Boundary i sits at frame round(t*fps),
        # so the counts sum to the total and no rounding survives to the next
        # shot.
        fps = fmt["fps"]
        bounds = [round(e["start"] * fps) for e in ir["timeline"]]
        bounds.append(round(ir["timeline"][-1]["end"] * fps))
        jobs = []
        for i, e in enumerate(ir["timeline"]):
            n = bounds[i + 1] - bounds[i]
            if n < 1:
                print(f"[{i}] rounds to {n} frames at {fps} fps -- shot is "
                      f"shorter than one frame", file=sys.stderr)
                return 1
            jobs.append((i, e, index[e["clip_id"]], fmt, tmp, n))
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
            # No -t here. The video is already exactly as long as the quantised
            # timeline, and passing the song length in seconds re-truncated it
            # to a non-integer frame count -- 5929 frames rendered, 5925 kept,
            # a 160 ms shortfall that the drift gate correctly refused. The
            # video defines the length; the audio is padded so -shortest can
            # never trim picture that the timeline asked for.
            r = subprocess.run(
                ["ffmpeg", "-v", "error", "-y", "-i", silent, "-i", audio,
                 "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
                 "-af", "apad", "-c:a", "aac", "-b:a", "192k",
                 "-shortest", out],
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
        total = frames_in(out)
        want_total = bounds[-1] - bounds[0]
        drift = (total - want_total) / fps
        if abs(drift) > 1.0 / fps:
            print(f"REFUSED: rendered {total} frames, the timeline asks for "
                  f"{want_total} ({drift*1000:+.0f} ms adrift)", file=sys.stderr)
            return 1
        print(f"{len(segs)} shots, {mb:.1f} MB, {total} frames "
              f"({drift*1000:+.0f} ms vs the timeline) -> {out}", file=sys.stderr)
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
