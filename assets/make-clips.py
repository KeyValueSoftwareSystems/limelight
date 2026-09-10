#!/usr/bin/env python3
"""Clips whose answers we already know, so the asset index can be graded.

    python3 assets/make-clips.py [--dest assets/generated]

WHY THIS EXISTS. assets/index.py claims to measure a shot boundary, a motion
magnitude, a camera move and a brightness. Every one of those claims needs a
reference that was not produced by the thing being graded -- and the repo has
already paid, twice, for the alternative: a beat grid checked against the
tracker that made it agreed to 9 ms and measured nothing.

Stock footage cannot supply that reference. Nobody knows where the true shot
boundary in a Mixkit clip is, to the frame, without a person marking it. So
these clips are rendered FROM the answer sheet, exactly the way synth/compose.py
renders songs from a map: the cut is at 2.000 s because this file put it there.

WHAT THEY CAN AND CANNOT PROVE. They can prove the detector finds a boundary it
was given, measures more motion when there is more motion, and separates a pan
from a subject crossing a still frame. They cannot prove anything about real
footage -- no compression artefacts, no grain, no rolling shutter, no handheld
drift, no depth of field. A detector that scores well here and badly on stock is
telling the truth about itself; treat this as a floor, never as a pass mark.

Deterministic: same bytes on every machine, so nothing here belongs in git.
"""
import argparse, json, math, os, subprocess, sys

import numpy as np

W, H, FPS = 640, 360, 25


def frames(spec):
    """Yield one raw RGB frame at a time. Pure function of (spec, frame index)."""
    n = int(round(spec["duration"] * FPS))
    for i in range(n):
        yield paint(spec, i / FPS)


YY, XX = np.mgrid[0:H, 0:W]

# A world-fixed background texture, in blocks so that it has CORNERS.
#
# Two earlier versions of this background were untrackable, and each one made
# the camera-motion test unanswerable in a different way. Flat colour gave a
# frame whose only structure was the subject. Vertical stripes looked textured
# but have gradient in one direction only, so goodFeaturesToTrack -- which wants
# the smaller eigenvalue of the structure tensor to be large, i.e. a corner --
# selected none of them, and every tracked point still landed on the subject.
# Both times the detector reported the subject's speed as the camera's, and both
# times the honest reading was that the question could not be answered rather
# than that the answer was wrong.
#
# Blocks of random luma have corners at every junction, which is what a real
# scene has and what a tracker needs. Seeded, so the clips stay byte-identical.
WORLD_W = W * 3
_rng = np.random.default_rng(20260910)
_blocks = _rng.integers(0, 70, size=(H // 16 + 1, WORLD_W // 16 + 1))
WORLD = np.repeat(np.repeat(_blocks, 16, axis=0), 16, axis=1)[:H, :WORLD_W]
WORLD = WORLD.astype(np.float32)

# The subject carries its own texture, which travels with it.
#
# It was a flat-coloured disc for three rounds and that made subject motion
# untestable for the third time in a row: a uniform circle has no interior
# corners, so a tracker can only hold on to its rim, rim points on a moving
# circle suffer the aperture problem, and the forward-backward check then
# throws them away as failures. The measured speed of a subject authored at
# 260 px/s came out as 16. Nothing was wrong with the tracker. A real subject
# -- a face, a car, a hand -- has texture inside its outline, and this one now
# does too.
_dt = _rng.integers(0, 90, size=(24, 24))
DISC_TEX = np.repeat(np.repeat(_dt, 8, axis=0), 8, axis=1).astype(np.float32)


def paint(spec, t):
    """One frame, as raw rgb24 bytes.

    Vectorised, because a 640x360 frame is 691k values and the interesting
    property of this file is that it is exactly reproducible, not that it avoids
    a dependency.
    """
    # Which shot are we in? The boundaries are the authored truth.
    shot = sum(1 for b in spec["cuts"] if t >= b)
    bg = spec["shot_bg"][shot % len(spec["shot_bg"])]
    img = np.empty((H, W, 3), np.float32)
    img[:] = bg

    # The world texture, offset by however far the camera has travelled. Drawn
    # always, including for a locked-off camera: a still camera over textured
    # ground is what makes "the camera did not move" a checkable claim.
    cam = spec["camera_px_per_s"] * t
    off = int(round(cam)) % (WORLD_W - W)
    img += WORLD[:, off:off + W][:, :, None]

    # The disc. Its speed is the authored subject motion; it is carried along by
    # the camera so that a pan moves everything together.
    since = t - ([0.0] + spec["cuts"])[shot]
    # Screen position = world position MINUS the camera's travel, matching the
    # background, which is sampled at WORLD[:, cam:cam+W] and therefore scrolls
    # left as the camera pans right. The sign was + here, which moved the disc
    # right while the background moved left: a subject the answer sheet called
    # world-stationary was in fact crossing the background at twice the pan
    # speed. The detector reported 389 px/s and was right; the answer sheet was
    # wrong. Worth stating plainly, because a check that disagrees with the
    # truth file is exactly as likely to have caught a bug in the truth file.
    cx = (spec["disc_px_per_s"] * since - cam) % (W + 200) - 100
    cy = H * 0.5 + 40 * math.sin(2 * math.pi * 0.25 * t)
    r = spec["disc_r"]
    inside = ((XX - cx) ** 2 + (YY - cy) ** 2) <= r * r
    img[inside] = spec["disc_rgb"]
    # Texture indexed in the disc's OWN frame, so it translates with the disc
    # rather than sliding underneath it.
    ty = (YY[inside] - int(cy)) % DISC_TEX.shape[0]
    tx = (XX[inside] - int(cx)) % DISC_TEX.shape[1]
    img[inside] += DISC_TEX[ty, tx][:, None]

    return np.clip(img, 0, 255).astype(np.uint8).tobytes()


SPECS = [
    # name, duration, authored cut times, motions, brightness
    dict(name="still-dark", duration=6.0, cuts=[], disc_px_per_s=0.0,
         camera_px_per_s=0.0, disc_r=40, disc_rgb=(90, 90, 90),
         shot_bg=[(20, 20, 24)]),
    dict(name="still-bright", duration=6.0, cuts=[], disc_px_per_s=0.0,
         camera_px_per_s=0.0, disc_r=40, disc_rgb=(240, 240, 240),
         shot_bg=[(215, 215, 220)]),
    dict(name="subject-slow", duration=6.0, cuts=[], disc_px_per_s=30.0,
         camera_px_per_s=0.0, disc_r=45, disc_rgb=(230, 80, 60),
         shot_bg=[(40, 44, 52)]),
    dict(name="subject-fast", duration=6.0, cuts=[], disc_px_per_s=260.0,
         camera_px_per_s=0.0, disc_r=45, disc_rgb=(230, 80, 60),
         shot_bg=[(40, 44, 52)]),
    dict(name="camera-pan", duration=6.0, cuts=[], disc_px_per_s=0.0,
         camera_px_per_s=180.0, disc_r=45, disc_rgb=(80, 180, 230),
         shot_bg=[(48, 40, 40)]),
    dict(name="two-cuts", duration=9.0, cuts=[3.0, 6.0], disc_px_per_s=60.0,
         camera_px_per_s=0.0, disc_r=45, disc_rgb=(120, 220, 140),
         shot_bg=[(30, 30, 36), (150, 60, 60), (40, 90, 140)]),
    dict(name="four-cuts-fast", duration=8.0, cuts=[1.6, 3.2, 4.8, 6.4],
         disc_px_per_s=120.0, camera_px_per_s=0.0, disc_r=35,
         disc_rgb=(240, 200, 60),
         shot_bg=[(24, 24, 28), (90, 30, 90), (30, 90, 60), (140, 120, 30),
                  (60, 60, 140)]),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dest", default=os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "generated"))
    a = ap.parse_args()
    os.makedirs(a.dest, exist_ok=True)

    truth = []
    for spec in SPECS:
        out = os.path.join(a.dest, spec["name"] + ".mp4")
        p = subprocess.Popen(
            ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
             "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
             "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
             "-pix_fmt", "yuv420p", out], stdin=subprocess.PIPE)
        for f in frames(spec):
            p.stdin.write(f)
        p.stdin.close()
        if p.wait() != 0:
            print(f"  {spec['name']}: ffmpeg failed", file=sys.stderr)
            continue
        truth.append({
            "clip_id": "gen-" + spec["name"],
            "file": os.path.relpath(out, os.path.dirname(os.path.abspath(__file__))),
            "duration_s": spec["duration"],
            "width": W, "height": H, "fps": FPS,
            "cuts_s": spec["cuts"],
            "shots": len(spec["cuts"]) + 1,
            "subject_px_per_s": spec["disc_px_per_s"],
            "camera_px_per_s": spec["camera_px_per_s"],
            # The world texture sits on top of the background colour, so the
            # authored luma has to include it or every clip reads 0.135 bright.
            "shot_bg_luma": [
                round(((0.299 * b[0] + 0.587 * b[1] + 0.114 * b[2])
                       + float(WORLD.mean())) / 255.0, 4)
                for b in (spec["shot_bg"] * (len(spec["cuts"]) + 1))[:len(spec["cuts"]) + 1]],
        })
        print(f"  {spec['name']}: {spec['duration']}s, "
              f"{len(spec['cuts'])} cuts", file=sys.stderr)

    tp = os.path.join(a.dest, "TRUTH.json")
    with open(tp, "w") as f:
        json.dump({
            "note": ("The answer sheet. These clips were RENDERED FROM these "
                     "numbers, so the numbers are causes, not measurements -- "
                     "the same standing as made_by.how = synthetic in a map."),
            "made_by": {"how": "synthetic", "who": "assets/make-clips.py"},
            "cannot_prove": ("Nothing here has compression noise, grain, "
                             "handheld drift, rolling shutter or depth of "
                             "field. A detector that passes here and fails on "
                             "stock footage is not contradicting itself."),
            "clips": truth,
        }, f, indent=1)
        f.write("\n")
    print(f"{len(truth)} clips -> {tp}", file=sys.stderr)


if __name__ == "__main__":
    main()
