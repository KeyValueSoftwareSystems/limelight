#!/usr/bin/env python3
"""What is in each clip, measured -- shots, motion, light, and where the eye goes.

    work/vision/bin/python assets/index.py --stock --generated [--out assets/INDEX.json]
    work/vision/bin/python assets/index.py --check      # grade against the answer sheet

THE JOB. A policy that chooses shots needs to know what it is choosing between.
This turns every clip into a list of shots with numbers attached, so the choice
is made over measurements rather than over filenames -- "cars/1090" is the
source's opinion about a clip and is worth nothing to a compiler.

WHAT IS MEASURED, AND WHAT EACH ONE IS NOT

  cut times        Frame-to-frame distance in a downsampled luma+colour
                   signature, called a boundary when it stands far above the
                   LOCAL median rather than above a fixed threshold. A global
                   threshold reads every frame of a strobing clip as a cut and
                   nothing at all in a soft dissolve.
                   NOT: a claim about dissolves. Only hard cuts are found, and
                   `soft_boundaries` records where a slow change was seen so a
                   reader can tell "no cut" from "not looked for".

  motion           Median absolute frame difference inside a shot, normalised.
                   NOT a physical speed. It is how much the picture changes.

  camera_motion    The global translation between frames: many tracked points,
                   then their MEDIAN, in pixels per second.
                   Phase correlation was tried first and is wrong for this. It
                   finds the dominant translation, so one large high-contrast
                   object outvotes a static background: on a clip authored with
                   a locked-off camera and a disc crossing it at 260 px/s, phase
                   correlation reported 254 px/s of camera motion. Tracking a
                   spread of points and taking the median lets the background
                   outvote the subject, which is what every stabiliser does and
                   for this reason.
                   NOT valid when the subject fills the frame. Below
                   MIN_TRACKED points the field is null, not zero.

  subject_motion   How fast the fastest-moving part of the frame moves relative
                   to the camera: the 95th percentile of each point's deviation
                   from the global median, in pixels per second, alongside
                   `moving_share`, the fraction of points that deviate at all.
                   The MEDIAN deviation was tried and is useless here, for the
                   mirror image of the reason the median is right for the
                   camera: once the background is properly textured it supplies
                   most of the points, they all agree, and the median deviation
                   of a clip with a subject crossing at 260 px/s reads 0. The
                   subject is the minority by construction, so it has to be read
                   off the tail. `moving_share` is what says whether that tail
                   is one object or the whole frame.
                   NOT object tracking, and not a count of moving things. Two
                   objects moving oppositely and one flag in the wind all land
                   in here together.

  brightness       Mean luma, 0-1, gamma left alone. contrast is its stdev.

  saturation       Mean HSV saturation. NOT a colour name; naming colours is a
                   creative act and belongs downstream.

  focus_x, focus_y Centre of mass of edge energy, 0-1 across the frame. This is
                   where the detail is, which is usually but not always the
                   subject. NOT a subject detector.

  look             A 4x3 grid of mean RGB, 36 numbers, from the middle frame.
                   What the shot LOOKS like: how dark, how warm, where the light
                   sits in frame.
                   This exists because continuity was first keyed to the
                   source's category name, and a category name is not an
                   appearance. "street" contained a neon alley at night AND a
                   desert highway at sunset; "city" contained green hills. Cut
                   together they read as random, which is exactly what a person
                   said about the result. A label is somebody's opinion about a
                   clip; this is a measurement of it.
                   NOT semantics. It cannot tell a red car from a red sunset,
                   and two shots with the same look may share nothing else. It
                   is a floor under coherence, not an understanding of it.

  faces            Faces per frame from YuNet, a small DNN detector.
                   NOT a person detector -- a back turned to camera is zero and
                   so is a figure too small or too side-on. Recorded because
                   "is anyone looking at us" changes a cut, but it is a floor on
                   the number of people, never a count of them. OpenCV 5 dropped
                   the Haar cascades this was first written against; YuNet is
                   the replacement and is the better detector, but it is a
                   different one, so any earlier face number is not comparable.

HOW THIS IS GRADED. --check runs the whole thing over assets/generated, whose
clips were rendered FROM their answers by assets/make-clips.py, and prints the
error per field. That is the only reference here that was not produced by this
file. Stock footage has no answer sheet, so nothing about stock is claimed as
accurate; the generated set is a floor and is labelled as one.
"""
import argparse, json, os, subprocess, sys, math

import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
SAMPLE_W, SAMPLE_H = 320, 180    # everything is measured at this size
SAMPLE_FPS = 12.5                # enough for a boundary, cheap enough for 90 clips
CUT_RATIO = 3.5                  # times the local median distance
CUT_FLOOR = 0.055                # below this, nothing counts as a cut
SOFT_RATIO = 2.0
MIN_SHOT_S = 0.4
MIN_TRACKED = 12                 # below this, camera motion is null, not zero
FB_MAX_PX = 1.0                  # forward-backward error a point must return within


def decode(path, w=SAMPLE_W, h=SAMPLE_H, fps=SAMPLE_FPS):
    """Every sampled frame as uint8 RGB, straight from ffmpeg."""
    r = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-vf", f"scale={w}:{h},fps={fps}",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    n = len(r.stdout) // (w * h * 3)
    if n == 0:
        return None
    return np.frombuffer(r.stdout[:n * w * h * 3], np.uint8).reshape(n, h, w, 3)


def luma(f):
    return (0.299 * f[..., 0] + 0.587 * f[..., 1] + 0.114 * f[..., 2]) / 255.0


def boundaries(sig, fps):
    """Cut times, and separately the soft changes that were seen but not called.

    The distance is compared against a rolling median of its neighbours, so a
    clip that is busy everywhere needs a bigger jump to count than a still one.
    A single global threshold was tried first and called 41 cuts in a 15-second
    stock clip of rippling water.
    """
    d = np.abs(np.diff(sig, axis=0)).mean(axis=1)
    if len(d) < 3:
        return [], [], d
    win = max(5, int(fps * 2) | 1)
    pad = win // 2
    padded = np.pad(d, pad, mode="edge")
    local = np.array([np.median(padded[i:i + win]) for i in range(len(d))])
    local = np.maximum(local, 1e-4)
    hard, soft = [], []
    for i, (v, m) in enumerate(zip(d, local)):
        t = (i + 1) / fps
        if v >= CUT_FLOOR and v >= CUT_RATIO * m:
            if not hard or t - hard[-1] >= MIN_SHOT_S:
                hard.append(round(t, 3))
        elif v >= SOFT_RATIO * m and v >= CUT_FLOOR * 0.4:
            soft.append(round(t, 3))
    return hard, soft, d


def global_motion(a, b):
    """(camera dx, dy, subject spread, points tracked) between two grey frames.

    Points are tracked forward and the MEDIAN of their flow is the camera. The
    median is the whole point: it survives a subject that moves differently from
    the background as long as the background supplies more than half the points.
    When it does not -- a face filling the frame, a sky with nothing to hold on
    to -- there is no answer and this returns None rather than a zero.
    """
    ga, gb = np.ascontiguousarray(a), np.ascontiguousarray(b)
    pts = cv2.goodFeaturesToTrack(ga, maxCorners=200, qualityLevel=0.01,
                                  minDistance=7, blockSize=7)
    if pts is None or len(pts) < MIN_TRACKED:
        return None
    nxt, st, _err = cv2.calcOpticalFlowPyrLK(ga, gb, pts, None,
                                             winSize=(21, 21), maxLevel=3)
    if nxt is None:
        return None
    # Forward-backward check: track each point back again and keep only the ones
    # that return to where they started. Without it a fast pan produces a tail
    # of points that simply lost their target, and that tail is indistinguishable
    # from a moving subject -- on a clip authored with nothing moving
    # independently, 9.8% of points "deviated" and subject motion read 365 px/s.
    # Tracking failures are not subject motion.
    back, st2, _e2 = cv2.calcOpticalFlowPyrLK(gb, ga, nxt, None,
                                              winSize=(21, 21), maxLevel=3)
    ok = st.reshape(-1).astype(bool)
    if back is not None:
        fb = np.linalg.norm((back - pts).reshape(-1, 2), axis=1)
        ok &= st2.reshape(-1).astype(bool) & (fb < FB_MAX_PX)
    if ok.sum() < MIN_TRACKED:
        return None
    flow = (nxt - pts).reshape(-1, 2)[ok]
    med = np.median(flow, axis=0)
    dev = np.linalg.norm(flow - med, axis=1)
    return (float(med[0]), float(med[1]), float(np.percentile(dev, 99)),
            float((dev > 1.5).mean()), int(ok.sum()))


_YUNET = None
YUNET_PATH = os.path.join(os.path.dirname(HERE), "work", "vision", "models",
                          "yunet.onnx")


def faces_in(frame_rgb):
    """Faces in one frame, or None if the detector is not installed.

    None and 0 are different answers and are kept different: 0 means the
    detector looked and found nobody, None means nothing looked. Writing 0 for
    both would be a guess wearing a measurement's clothes.
    """
    global _YUNET
    if _YUNET is None:
        if not os.path.exists(YUNET_PATH):
            return None
        _YUNET = cv2.FaceDetectorYN_create(YUNET_PATH, "", (320, 320), 0.8, 0.3, 5000)
    h, w = frame_rgb.shape[:2]
    _YUNET.setInputSize((w, h))
    bgr = cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR)
    _n, faces = _YUNET.detect(bgr)
    return 0 if faces is None else len(faces)


def measure_shot(frames, fps, scale_x):
    """Every number for one shot, from its frames alone."""
    L = luma(frames)
    G = (L * 255).astype(np.uint8)
    n = len(frames)
    if n < 2:
        d = np.array([0.0])
        est = []
    else:
        d = np.abs(np.diff(L, axis=0)).mean(axis=(1, 2))
        # Every pair would be exact and slow; a stride of 2 over at most 40
        # pairs is enough for a median and keeps 90 clips inside a minute.
        idx = np.unique(np.linspace(0, n - 2, min(40, n - 1)).astype(int))
        est = [e for e in (global_motion(G[i], G[i + 1]) for i in idx) if e]
    motion = float(np.median(d))
    if est:
        cam = np.array([[e[0], e[1]] for e in est])
        cam_px_s = float(np.median(np.linalg.norm(cam, axis=1))) * fps * scale_x
        sub_px_s = float(np.median([e[2] for e in est])) * fps * scale_x
        share = float(np.median([e[3] for e in est]))
        tracked = int(np.median([e[4] for e in est]))
    else:
        cam_px_s = sub_px_s = share = None
        tracked = 0
    hsv = cv2.cvtColor(frames[n // 2], cv2.COLOR_RGB2HSV)
    gx = cv2.Sobel(np.float32(L[n // 2]), cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(np.float32(L[n // 2]), cv2.CV_32F, 0, 1, ksize=3)
    e = np.abs(gx) + np.abs(gy)
    tot = e.sum() + 1e-9
    ys, xs = np.mgrid[0:e.shape[0], 0:e.shape[1]]
    idx = np.linspace(0, n - 1, min(5, n)).astype(int)
    seen = [faces_in(frames[i]) for i in idx] if n else []
    seen = [x for x in seen if x is not None]
    nf = max(seen) if seen else None
    mid = frames[n // 2]
    gh, gw = 3, 4
    look = []
    for gy in range(gh):
        for gx in range(gw):
            cell = mid[gy * mid.shape[0] // gh:(gy + 1) * mid.shape[0] // gh,
                       gx * mid.shape[1] // gw:(gx + 1) * mid.shape[1] // gw]
            look += [round(float(cell[..., c].mean()) / 255.0, 4) for c in range(3)]
    return {
        "motion": round(motion, 5),
        "look": look,
        "camera_motion_px_s": None if cam_px_s is None else round(cam_px_s, 2),
        "subject_motion_px_s": None if sub_px_s is None else round(sub_px_s, 2),
        "moving_share": None if share is None else round(share, 4),
        "points_tracked": tracked,
        "brightness": round(float(L.mean()), 4),
        "contrast": round(float(L.std()), 4),
        "saturation": round(float(hsv[..., 1].mean() / 255.0), 4),
        "focus_x": round(float((e * xs).sum() / tot / e.shape[1]), 4),
        "focus_y": round(float((e * ys).sum() / tot / e.shape[0]), 4),
        "faces": None if nf is None else int(nf),
    }


def index_clip(path, clip_id, meta=None):
    frames = decode(path)
    if frames is None:
        return None
    fps = SAMPLE_FPS
    sig = np.concatenate([
        luma(frames).reshape(len(frames), -1),
        frames.reshape(len(frames), -1) / 255.0], axis=1)
    hard, soft, _d = boundaries(sig, fps)
    dur = len(frames) / fps
    edges = [0.0] + hard + [dur]
    shots = []
    for i in range(len(edges) - 1):
        s, e = edges[i], edges[i + 1]
        if e - s < MIN_SHOT_S:
            continue
        a, b = int(s * fps), max(int(s * fps) + 1, int(e * fps))
        scale_x = (meta or {}).get("width", SAMPLE_W) / SAMPLE_W
        m = measure_shot(frames[a:b], fps, scale_x)
        shots.append({"start": round(s, 3), "end": round(e, 3),
                      "duration": round(e - s, 3), **m})
    return {
        "clip_id": clip_id,
        "file": path,
        "duration_s": round(dur, 3),
        "cuts_s": hard,
        "soft_boundaries_s": soft,
        "shots": shots,
        **({k: meta[k] for k in ("width", "height", "fps", "source",
                                 "source_category", "licence")
            if meta and k in meta}),
    }


def load_targets(stock, generated, incoming, setname="default"):
    out = []
    if stock:
        cp = (os.path.join(HERE, "stock", "CATALOGUE.json")
              if setname in (None, "default")
              else os.path.join(HERE, "stock", setname, "CATALOGUE.json"))
        if os.path.exists(cp):
            for c in json.load(open(cp))["clips"]:
                out.append((os.path.join(HERE, c["file"]), c["clip_id"], c))
    if generated:
        tp = os.path.join(HERE, "generated", "TRUTH.json")
        if os.path.exists(tp):
            for c in json.load(open(tp))["clips"]:
                out.append((os.path.join(HERE, c["file"]), c["clip_id"], c))
    if incoming:
        d = os.path.join(HERE, "incoming")
        for n in sorted(os.listdir(d)) if os.path.isdir(d) else []:
            if n.lower().endswith((".mp4", ".mov", ".webm", ".mkv", ".m4v")):
                out.append((os.path.join(d, n), "incoming-" + os.path.splitext(n)[0], None))
    return out


def check():
    """Grade the detector against clips that were rendered from their answers."""
    tp = os.path.join(HERE, "generated", "TRUTH.json")
    truth = {c["clip_id"]: c for c in json.load(open(tp))["clips"]}
    rows, cut_err, missed, spurious = [], [], 0, 0
    for cid, t in sorted(truth.items()):
        got = index_clip(os.path.join(HERE, t["file"]), cid, t)
        want, have = t["cuts_s"], got["cuts_s"]
        used = set()
        for w in want:
            near = [(abs(h - w), j) for j, h in enumerate(have) if j not in used]
            near = [x for x in near if x[0] <= 0.5]
            if near:
                e, j = min(near)
                used.add(j)
                cut_err.append(e)
            else:
                missed += 1
        spurious += len(have) - len(used)
        cams = [s["camera_motion_px_s"] for s in got["shots"]
                if s["camera_motion_px_s"] is not None]
        cam = float(np.median(cams)) if cams else float("nan")
        subs = [s["subject_motion_px_s"] for s in got["shots"]
                if s["subject_motion_px_s"] is not None]
        sub = float(np.median(subs)) if subs else float("nan")
        shr = [s["moving_share"] for s in got["shots"]
               if s.get("moving_share") is not None]
        shr = float(np.median(shr)) if shr else float("nan")
        # Brightness is graded per shot against that shot's own authored
        # background, not against the mean across shots -- comparing a
        # three-shot mean to shot 0 made a correct reading look 0.14 wrong.
        berr = []
        for j, sh in enumerate(got["shots"]):
            if j < len(t["shot_bg_luma"]):
                berr.append(abs(sh["brightness"] - t["shot_bg_luma"][j]))
        rows.append((cid, len(want), len(have), t["camera_px_per_s"], cam,
                     t["subject_px_per_s"], sub, shr,
                     max(berr) if berr else float("nan")))
    print(f"{'clip':20} {'cuts':>8}  {'camera px/s':>16}  "
          f"{'subject px/s':>16} {'moving':>7} {'luma err':>9}")
    for cid, nw, nh, cw, ch, sw, sh, shr, be in rows:
        print(f"{cid:20} {nw:3} -> {nh:<3} {cw:7.0f} -> {ch:<7.0f} "
              f"{sw:7.0f} -> {sh:<7.0f} {shr:6.2f} {be:9.3f}")
    n = len(cut_err)
    print()
    print(f"cuts matched      {n}, missed {missed}, spurious {spurious}")
    if n:
        print(f"cut timing error  median {np.median(cut_err)*1000:.0f} ms, "
              f"max {max(cut_err)*1000:.0f} ms")
    print(f"(sampled at {SAMPLE_FPS} fps, so {1000/SAMPLE_FPS:.0f} ms is one frame "
          f"and is the floor on this error)")

    # A gate, not a printout. These bounds are what the detector achieved once
    # the generated clips stopped asking unanswerable questions; they are here
    # so a later change that breaks one of them fails loudly instead of being
    # noticed by nobody.
    bad = []
    if missed or spurious:
        bad.append(f"cuts: {missed} missed, {spurious} spurious (want 0/0)")
    if cut_err and max(cut_err) > 2.0 / SAMPLE_FPS:
        bad.append(f"cut timing: max {max(cut_err)*1000:.0f} ms > 2 frames")
    for cid, _nw, _nh, cw, ch, sw, sh, _shr, be in rows:
        if not math.isnan(ch) and abs(ch - cw) > max(25.0, 0.15 * cw):
            bad.append(f"{cid}: camera {ch:.0f} vs authored {cw:.0f}")
        if not math.isnan(sh) and abs(sh - sw) > max(45.0, 0.25 * sw):
            bad.append(f"{cid}: subject {sh:.0f} vs authored {sw:.0f}")
        if not math.isnan(be) and be > 0.05:
            bad.append(f"{cid}: luma error {be:.3f} > 0.05")
    print()
    if bad:
        print("FAIL")
        for b in bad:
            print("  " + b)
        return 1
    print("all within bounds")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stock", action="store_true")
    ap.add_argument("--generated", action="store_true")
    ap.add_argument("--incoming", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--set", dest="setname", default="default",
                    help="a named clip set, e.g. night-city")
    ap.add_argument("--out")
    a = ap.parse_args()
    a.out_explicit = a.out is not None
    if not a.out:
        a.out = (os.path.join(HERE, "INDEX.json") if a.setname in (None, "default")
                 else os.path.join(HERE, "stock", a.setname, "INDEX.json"))
    if a.check:
        return check()
    if a.generated and a.stock and not a.out_explicit:
        print("refusing to write a production index containing the generated "
              "fixtures: they are the answer sheet, and CLIP reads a coloured "
              "disc on noise as 'an ocean wave'. Use --check to grade against "
              "them, or --out to name a separate file.", file=sys.stderr)
        return 2
    targets = load_targets(a.stock, a.generated, a.incoming, a.setname)
    if not targets:
        print("nothing to index -- pass --stock, --generated or --incoming",
              file=sys.stderr)
        return 2
    out = []
    for i, (path, cid, meta) in enumerate(targets, 1):
        if not os.path.exists(path):
            continue
        r = index_clip(path, cid, meta)
        if r:
            r["file"] = os.path.relpath(path, HERE)
            out.append(r)
        if i % 10 == 0:
            print(f"  [{i}/{len(targets)}]", file=sys.stderr)
    doc = {
        "note": ("Every clip as measurements rather than filenames. The policy "
                 "chooses over these; `source_category` is the one exception "
                 "and is the source's opinion, used only to tell whether two "
                 "shots belong to the same world."),
        "set": a.setname,
        "made_by": {"how": "model", "who": "assets/index.py"},
        "graded_against": ("assets/generated/TRUTH.json, whose clips were "
                           "rendered from their answers. Stock footage has no "
                           "answer sheet and no accuracy is claimed for it."),
        "sample": {"width": SAMPLE_W, "height": SAMPLE_H, "fps": SAMPLE_FPS},
        "clips": out,
    }
    with open(a.out, "w") as f:
        json.dump(doc, f, indent=1)
        f.write("\n")
    ns = sum(len(c["shots"]) for c in out)
    print(f"{len(out)} clips, {ns} shots -> {a.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
