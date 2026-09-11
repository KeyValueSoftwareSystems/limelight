#!/usr/bin/env python3
"""IR + map -> a composed video. Every frame is a function of the map and t.

    work/vision/bin/python readers/video/render.py renders/x.ir.json \
        [--copy copy/levels.json] [--out renders/x.mp4]

WHY THIS EXISTS AND compile.py IS NOT ENOUGH. compile.py turns the IR into an
mp4 by cutting clips and joining them. That is an edit decision list, and a list
of cuts is not a piece of content: between one cut and the next, nothing
happens. Three edits built that way were shown to a person who rejected all
three, and the summary was exact -- "clips pieced together".

So this composes instead of concatenating. The picture moves continuously,
driven by readers/video/motion.py, which is f(map, t) and nothing else:

    zoom = 1 + breath*pump(t)*energy(t) + punch*accent(t) + drop_punch*drop(t)

The bet, stated plainly so it can be judged: a machine will not out-taste an
editor, but it can put a 90 ms impulse on all 472 accents that clear a
threshold, and ride the record's own 24-bin sidechain envelope on every beat of
the song. Those are not better decisions. They are decisions at a density and a
precision nobody would pay a person to make by hand.

PURITY. The transform for frame i depends on (map, params, t) and on nothing
that happened in frame i-1. Render any range and get identical pixels. That is
the same rule the lighting reader keeps, and it is what makes a wrong frame
findable instead of merely visible.
"""
import argparse, json, math, os, subprocess, sys

import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "listen"))
from motion import Motion, DEFAULTS
from mapio import release_path, map_path

OVER = 1.30          # decode this much larger than output, so zoom has room
FONTS = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
         "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]


def font_path():
    for f in FONTS:
        if os.path.exists(f):
            return f
    return None


def load_index(ir):
    rel = ((ir.get("made_by") or {}).get("index")) or "assets/INDEX.json"
    p = os.path.join(ROOT, rel)
    if not os.path.exists(p):
        p = os.path.join(ROOT, "assets", "INDEX.json")
    return {c["clip_id"]: c for c in json.load(open(p))["clips"]}


def decode_shot(src, in_s, nframes, fps, w, h):
    """Exactly nframes of one shot, decoded oversized so zoom has somewhere to
    go. Frame-exact for the same reason compile.py is: -frames:v never rounds."""
    dw, dh = int(w * OVER) // 2 * 2, int(h * OVER) // 2 * 2
    vf = (f"scale={dw}:{dh}:force_original_aspect_ratio=increase,"
          f"crop={dw}:{dh},fps={fps},setsar=1")
    r = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", f"{in_s:.3f}",
         "-t", f"{nframes / fps + 0.5:.3f}", "-i", src,
         "-vf", vf, "-frames:v", str(nframes), "-an",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    got = len(r.stdout) // (dw * dh * 3)
    if got < 1:
        return None, dw, dh
    a = np.frombuffer(r.stdout[:got * dw * dh * 3], np.uint8).reshape(got, dh, dw, 3)
    if got < nframes:                       # hold the last frame rather than fail
        a = np.concatenate([a, np.repeat(a[-1:], nframes - got, axis=0)])
    return a, dw, dh


def transform(frame, dw, dh, w, h, zoom, gain, dx=0.0, dy=0.0):
    """Crop scaled by `zoom` and offset by (dx, dy), then gain.

    Pure in its arguments: same inputs, same pixels, every time.
    """
    z = max(0.80, min(zoom, OVER * 0.99))
    rw, rh = int(round(w / z)), int(round(h / z))
    rw, rh = min(rw, dw), min(rh, dh)
    x0 = (dw - rw) // 2 + int(round(dx * dw))
    y0 = (dh - rh) // 2 + int(round(dy * dh))
    x0 = max(0, min(x0, dw - rw))
    y0 = max(0, min(y0, dh - rh))
    crop = frame[y0:y0 + rh, x0:x0 + rw]
    out = cv2.resize(crop, (w, h), interpolation=cv2.INTER_LINEAR)
    if abs(gain - 1.0) > 1e-3:
        out = np.clip(out.astype(np.float32) * gain, 0, 255).astype(np.uint8)
    return out


class Copy:
    """Text, anchored to the music rather than to a stopwatch."""

    def __init__(self, spec, mo, t0):
        self.lines = []
        self.font = font_path()
        if not spec or not self.font:
            return
        from PIL import ImageFont
        downs = mo.downs
        for L in spec.get("lines", []):
            at = L.get("at")
            if isinstance(at, str) and at.startswith("downbeat:"):
                i = int(at.split(":")[1])
                at = downs[i] if 0 <= i < len(downs) else None
            elif isinstance(at, str) and at.startswith("moment:"):
                want = at.split(":")[1]
                cands = [x["at"] for x in mo.moments if x["kind"] == want]
                at = cands[0] if cands else None
            if at is None:
                continue
            # Land on a downbeat: text that arrives half a bar late reads as a
            # mistake even when nobody can say why.
            if downs:
                at = min(downs, key=lambda d: abs(d - at))
            self.lines.append({
                "text": str(L.get("text", "")),
                "at": at - t0,
                "hold": float(L.get("hold", 1.6)),
                "size": float(L.get("size", 0.085)),
                "y": float(L.get("y", 0.5)),
                "font": ImageFont.truetype(self.font, 10),
            })

    def draw(self, img, t, w, h):
        if not self.lines:
            return img
        from PIL import Image, ImageDraw, ImageFont
        active = [L for L in self.lines if L["at"] <= t < L["at"] + L["hold"]]
        if not active:
            return img
        pil = Image.fromarray(img)
        d = ImageDraw.Draw(pil)
        for L in active:
            age = t - L["at"]
            # In fast, out slow, and a scale overshoot on entry so the line
            # ARRIVES with the beat rather than fading onto it. A fade-in reads
            # as a subtitle; a snap reads as a cut.
            k = min(1.0, age / 0.07)
            fade = 1.0 if age < L["hold"] - 0.30 else max(0.0, (L["hold"] - age) / 0.30)
            scale = 1.0 + 0.16 * (1 - k) ** 2
            size = max(8, int(h * L["size"] * scale))
            txt = L["text"]
            # Shrink until it FITS. "3,520 ACCENTS" at the requested size was
            # wider than a 1080 px frame and rendered as "520 ACCENT" -- text
            # running off the edge is not a style, it is a broken frame, and no
            # amount of motion design rescues it.
            margin = int(w * 0.08)
            f = ImageFont.truetype(self.font, size)
            bb = d.textbbox((0, 0), txt, font=f)
            while bb[2] - bb[0] > w - 2 * margin and size > 10:
                size = int(size * 0.94)
                f = ImageFont.truetype(self.font, size)
                bb = d.textbbox((0, 0), txt, font=f)
            tw, th = bb[2] - bb[0], bb[3] - bb[1]
            x, y = (w - tw) // 2, int(h * L["y"] - th / 2)
            a = int(255 * min(1.0, k) * fade)
            pad = int(size * 0.34)
            # A band behind the line. White text over moving footage is
            # unreadable about a third of the time, and unreadable text is not
            # content either -- the band is what makes it legible on any frame
            # instead of on the frames that happen to be dark.
            band = Image.new("RGBA", pil.size, (0, 0, 0, 0))
            bd = ImageDraw.Draw(band)
            bd.rectangle([x - pad, y - int(pad * 0.55),
                          x + tw + pad, y + th + int(pad * 0.75)],
                         fill=(0, 0, 0, int(150 * fade * min(1.0, k))))
            pil = Image.alpha_composite(pil.convert("RGBA"), band).convert("RGB")
            d = ImageDraw.Draw(pil)
            # A rule that wipes in under the line, on the same envelope.
            rw = int(tw * min(1.0, age / 0.22))
            if rw > 2:
                d.rectangle([x, y + th + int(pad * 0.35), x + rw,
                             y + th + int(pad * 0.35) + max(2, size // 22)],
                            fill=(255, 255, 255, a))
            d.text((x + max(2, size // 26), y + max(2, size // 26)), txt,
                   font=f, fill=(0, 0, 0, a // 2))
            d.text((x, y), txt, font=f, fill=(255, 255, 255, a))
        return np.asarray(pil)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ir")
    ap.add_argument("--out")
    ap.add_argument("--copy")
    ap.add_argument("--no-audio", action="store_true")
    ap.add_argument("--motion", help="JSON overriding motion params")
    a = ap.parse_args()

    ir = json.load(open(a.ir))
    index = load_index(ir)
    mp = os.path.join(ROOT, ir["made_by"]["map"])
    m = json.load(open(mp))

    fmt = ir["format"]
    w, h, fps = fmt["width"], fmt["height"], fmt["fps"]
    win = (ir.get("song") or {}).get("window") or {}
    t0 = float(win.get("from") or 0.0)

    params = dict(DEFAULTS)
    brief_p = (ir.get("made_by") or {}).get("motion")
    if isinstance(brief_p, dict):
        params.update(brief_p)
    if a.motion:
        params.update(json.loads(a.motion))
    mo = Motion(m, params)

    copy = Copy(json.load(open(a.copy)) if a.copy else None, mo, t0)

    out = a.out or os.path.splitext(os.path.splitext(a.ir)[0])[0] + ".mp4"
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    tmp = out + ".silent.mp4"

    bounds = [round(e["start"] * fps) for e in ir["timeline"]]
    bounds.append(round(ir["timeline"][-1]["end"] * fps))
    total = bounds[-1] - bounds[0]

    enc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
         "-s", f"{w}x{h}", "-r", str(fps), "-i", "-",
         "-c:v", "libx264", "-preset", "medium", "-crf", "19",
         "-pix_fmt", "yuv420p", tmp], stdin=subprocess.PIPE)

    stats = {"zoom_min": 9, "zoom_max": 0, "frames": 0}
    for i, e in enumerate(ir["timeline"]):
        n = bounds[i + 1] - bounds[i]
        clip = index.get(e["clip_id"])
        if not clip:
            print(f"[{i}] unknown clip {e['clip_id']}", file=sys.stderr)
            return 1
        src = os.path.join(ROOT, "assets", clip["file"])
        frames, dw, dh = decode_shot(src, e["in_s"], n, fps, w, h)
        if frames is None:
            print(f"[{i}] no frames from {src}", file=sys.stderr)
            return 1
        for k in range(n):
            t_local = (bounds[i] + k) / fps
            v = mo.at(t0 + t_local,
                      {"i": i, "start": bounds[i] / fps, "end": bounds[i + 1] / fps})
            img = transform(frames[k], dw, dh, w, h, v["zoom"], v["gain"],
                            v.get("dx", 0.0), v.get("dy", 0.0))
            img = copy.draw(img, t_local, w, h)
            enc.stdin.write(img.tobytes())
            stats["zoom_min"] = min(stats["zoom_min"], v["zoom"])
            stats["zoom_max"] = max(stats["zoom_max"], v["zoom"])
            stats["frames"] += 1
    enc.stdin.close()
    if enc.wait() != 0:
        print("encode failed", file=sys.stderr)
        return 1

    audio = None if a.no_audio else release_path(ir["song"]["slug"])
    if audio:
        seek = ["-ss", f"{t0:.3f}"] if t0 else []
        r = subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", tmp] + seek +
            ["-i", audio, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
             "-af", "apad", "-c:a", "aac", "-b:a", "192k", "-shortest", out],
            capture_output=True, text=True)
        os.remove(tmp)
        if r.returncode != 0:
            print("mux failed: " + r.stderr[:300], file=sys.stderr)
            return 1
    else:
        os.replace(tmp, out)

    print(f"{stats['frames']} frames ({stats['frames']/fps:.1f}s), "
          f"zoom {stats['zoom_min']:.3f}-{stats['zoom_max']:.3f}, "
          f"{os.path.getsize(out)/1e6:.1f} MB -> {out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
