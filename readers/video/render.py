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


def apply_effect(frames, k, fx, w, h, params):
    """One of the named effects, as a function of the shot's own frames and k.

    PURE in (frames, k, fx). `trails` and `freeze` need neighbouring frames, and
    they take them from the decoded shot rather than from whatever the renderer
    emitted last -- so any frame can still be rendered on its own, and asking
    for frame 400 twice gives identical pixels. That is the same constraint the
    lighting reader lives under and it is worth the small extra cost.

    Returns the frame to draw. Geometry (zoom, offset, gain) is applied after.
    """
    if not fx:
        return frames[k]
    name, thr, st = fx["effect"], fx["through"], fx["strength"]
    n = len(frames)

    if name == "freeze":
        # The picture stops. On a `stop` moment the music does the same thing,
        # and holding a frame is the only effect that says so.
        hold = int(fx.get("_k0", k))
        return frames[min(max(0, hold), n - 1)]

    if name == "trails":
        # An echo that tightens: the further through the build, the shorter the
        # tail, so the picture gathers rather than smears evenly.
        amt = params.get("fx_trails", 1.0) * st * (1.0 - 0.6 * thr)
        if amt <= 0.01:
            return frames[k]
        lag1 = max(0, k - int(4 + 6 * (1 - thr)))
        lag2 = max(0, k - int(9 + 12 * (1 - thr)))
        a = frames[k].astype(np.float32)
        a = (a * (1 - 0.45 * amt)
             + frames[lag1].astype(np.float32) * (0.30 * amt)
             + frames[lag2].astype(np.float32) * (0.15 * amt))
        return np.clip(a, 0, 255).astype(np.uint8)

    if name == "bloom":
        # Light spreads and nothing moves. For a spotlight, where the music
        # opens up rather than hits.
        amt = params.get("fx_bloom", 1.0) * st * math.sin(math.pi * min(1.0, thr)) ** 0.6
        if amt <= 0.01:
            return frames[k]
        f = frames[k]
        small = cv2.resize(f, (f.shape[1] // 6, f.shape[0] // 6))
        blur = cv2.GaussianBlur(small, (0, 0), 6)
        blur = cv2.resize(blur, (f.shape[1], f.shape[0]))
        hi = np.clip(blur.astype(np.float32) - 120, 0, None) * (1.6 * amt)
        return np.clip(f.astype(np.float32) + hi, 0, 255).astype(np.uint8)

    if name == "whip":
        # A fast directional throw, for a return: the picture is thrown back to
        # where it came from.
        amt = params.get("fx_whip", 1.0) * st * (1.0 - thr) ** 1.5
        if amt <= 0.02:
            return frames[k]
        ln = max(3, int(38 * amt) | 1)
        kern = np.zeros((ln, ln), np.float32)
        kern[ln // 2, :] = 1.0 / ln
        return cv2.filter2D(frames[k], -1, kern)

    if name == "blink":
        # A few frames of black, then back. The oldest punctuation in product
        # film: it separates two ideas without moving anything, and it costs no
        # attention because there is nothing to look at.
        amt = params.get("fx_blink", 1.0) * st
        # Down fast, up slower, so it reads as a beat rather than a dropout.
        env = (1.0 - thr / 0.35) if thr < 0.35 else max(0.0, 1.0 - (thr - 0.35) / 0.65)
        k2 = max(0.0, min(1.0, env)) * amt
        if k2 <= 0.02:
            return frames[k]
        return (frames[k].astype(np.float32) * (1.0 - 0.94 * k2)).astype(np.uint8)

    if name == "punch":
        # Chromatic split on the hardest instant only, decaying fast. Any
        # longer and it reads as a broken display rather than an impact.
        amt = params.get("fx_rgb", 0.55) * st * max(0.0, 1.0 - thr * 3.0)
        if amt <= 0.02:
            return frames[k]
        f = frames[k]
        off = max(1, int(9 * amt))
        out = f.copy()
        out[:, off:, 0] = f[:, :-off, 0]
        out[:, :-off, 2] = f[:, off:, 2]
        return out

    return frames[k]


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


class Card:
    """The end card: who made this and what it is called.

    The thing that turns a montage into a piece of content. Everything this lane
    produced before had nothing to say -- a person watched one and said "not an
    ad, not content, nothing", and they were right: the IR could express a cut
    and could not express a claim.

    A card is not a caption. It dims the picture, holds, and states the subject.
    It is the only element here allowed to take the screen away from the
    footage, which is why there is exactly one and it is at the end.
    """

    def __init__(self, spec, dur):
        self.spec = spec or None
        self.dur = dur
        if self.spec:
            self.start = max(0.0, dur - float(spec.get("hold", 3.2)))

    def draw(self, img, t, w, h, font):
        if not self.spec or t < self.start or not font:
            return img
        from PIL import Image, ImageDraw, ImageFont
        age = t - self.start
        span = self.dur - self.start
        # Dim in over the first third, hold, and never fade back out: the card
        # is where the video ends, not a thing that passes through.
        k = min(1.0, age / max(0.2, span * 0.33))
        pil = Image.fromarray(img).convert("RGBA")
        veil = Image.new("RGBA", pil.size, (0, 0, 0, int(215 * k)))
        pil = Image.alpha_composite(pil, veil).convert("RGB")
        d = ImageDraw.Draw(pil)
        lines = self.spec.get("lines", [])
        sizes = [self.spec.get("size_main", 0.062), self.spec.get("size_sub", 0.036)]
        total = 0
        drawn = []
        for i, ln in enumerate(lines):
            f = ImageFont.truetype(font, max(10, int(h * sizes[min(i, 1)])))
            margin = int(w * 0.10)
            bb = d.textbbox((0, 0), ln, font=f)
            size = max(10, int(h * sizes[min(i, 1)]))
            while bb[2] - bb[0] > w - 2 * margin and size > 10:
                size = int(size * 0.94)
                f = ImageFont.truetype(font, size)
                bb = d.textbbox((0, 0), ln, font=f)
            drawn.append((ln, f, bb[2] - bb[0], bb[3] - bb[1]))
            total += (bb[3] - bb[1]) + int(h * 0.022)
        y = int(h * 0.5 - total / 2)
        a = int(255 * k)
        for ln, f, tw, th in drawn:
            d.text(((w - tw) // 2, y), ln, font=f, fill=(255, 255, 255, a))
            y += th + int(h * 0.022)
        return np.asarray(pil)


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
    ap.add_argument("--generic-motion", action="store_true",
                    help="A Ken Burns push on every shot, at constant amplitude, "
                         "with no reference to the music. What a competent editor "
                         "or a basic auto-editor does without a map -- and the "
                         "fair thing to give the control, which previously got no "
                         "motion at all.")
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
    # What this footage can actually carry. The effect vocabulary is keyed to
    # the moment kind and never looked at the picture: on macro product shots
    # against white, `punch` changes the frame by 0.0 out of 255 and `blink` by
    # 137, so a drop got either nothing or a near-blackout and neither was a
    # decision. When something has measured this set and chosen, that wins.
    fx_rule = None
    try:
        _rel = ((ir.get("made_by") or {}).get("index")) or ""
        _d = os.path.join(ROOT, os.path.dirname(_rel), "DESCRIBED.json")
        fx_rule = (json.load(open(_d)) or {}).get("effects")
    except Exception:
        pass
    mo = Motion(m, params, fx_rule)

    copy_spec = json.load(open(a.copy)) if a.copy else None
    copy = Copy(copy_spec, mo, t0)
    card = Card((copy_spec or {}).get("end_card"),
                ir["timeline"][-1]["end"] if ir["timeline"] else 0.0)

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

    # `fx` counts OCCURRENCES, not frames. Counting frames once reported
    # "blink: 6" for a single quarter-second blink, which reads as six slams.
    stats = {"zoom_min": 9, "zoom_max": 0, "frames": 0, "fx": {}, "fx_frames": 0,
             "fx_seen": set()}
    for i, e in enumerate(ir["timeline"]):
        n = bounds[i + 1] - bounds[i]
        clip = index.get(e["clip_id"])
        if not clip:
            print(f"[{i}] unknown clip {e['clip_id']}", file=sys.stderr)
            return 1
        src = os.path.join(ROOT, "assets", clip["file"])
        # decode_shot takes a duration from a FILE; it has no idea where the
        # shot it is named after ends. Running past that end splices the source
        # editor's own cuts into the middle of our held shot, at instants the
        # music never chose, and the result reads as an edit that is out of
        # sync. Nothing announced it -- the frames decode fine. Surface it.
        shots = clip.get("shots") or []
        if 0 <= e.get("shot", -1) < len(shots):
            sh = shots[e["shot"]]
            over = (e["in_s"] + n / fps) - sh["end"]
            if over > 1.0 / fps:
                print(f"[{i}] shot {e['shot']} of {e['clip_id']} is "
                      f"{sh['end'] - sh['start']:.2f}s and the slot wants "
                      f"{n / fps:.2f}s from {e['in_s']:.2f}s -- that runs "
                      f"{over:.2f}s past the end of the shot and would splice "
                      f"in {sum(1 for q in shots if sh['end'] <= q['start'] < e['in_s'] + n / fps)} "
                      f"source cut(s) the music did not choose", file=sys.stderr)
                return 1
        frames, dw, dh = decode_shot(src, e["in_s"], n, fps, w, h)
        if frames is None:
            print(f"[{i}] no frames from {src}", file=sys.stderr)
            return 1
        for k in range(n):
            t_local = (bounds[i] + k) / fps
            tabs = t0 + t_local
            if a.generic_motion:
                # No map is consulted. A slow push across each shot, alternating
                # direction, plus a gentle constant breath -- the same moves,
                # applied evenly, because evenly is all you can do without
                # knowing where you are.
                kk = (bounds[i + 1] - bounds[i])
                prog = k / max(1, kk - 1)
                sgn = 1.0 if i % 2 == 0 else -1.0
                v = {"zoom": 1.0 + 0.06 * sgn * (prog - 0.5) * 2.0
                              + 0.012 * math.sin(2 * math.pi * t_local * 0.9),
                     "gain": 1.0, "dx": 0.004 * math.sin(2 * math.pi * prog),
                     "dy": 0.0}
                fx = None
                src = frames[k]
                img = transform(src, dw, dh, w, h, v["zoom"], v["gain"],
                                v["dx"], v["dy"])
                img = copy.draw(img, t_local, w, h)
                img = card.draw(img, t_local, w, h, copy.font)
                enc.stdin.write(img.tobytes())
                stats["zoom_min"] = min(stats["zoom_min"], v["zoom"])
                stats["zoom_max"] = max(stats["zoom_max"], v["zoom"])
                stats["frames"] += 1
                continue
            v = mo.at(tabs,
                      {"i": i, "start": bounds[i] / fps, "end": bounds[i + 1] / fps})
            fx = mo.effect_at(tabs)
            if fx and fx["effect"] == "freeze":
                # The frame the freeze started on, in this shot's own indexing.
                fx["_k0"] = int(round((fx["at"] - t0 - bounds[i] / fps) * fps))
            src = apply_effect(frames, k, fx, w, h, params)
            img = transform(src, dw, dh, w, h, v["zoom"], v["gain"],
                            v.get("dx", 0.0), v.get("dy", 0.0))
            img = copy.draw(img, t_local, w, h)
            img = card.draw(img, t_local, w, h, copy.font)
            enc.stdin.write(img.tobytes())
            stats["zoom_min"] = min(stats["zoom_min"], v["zoom"])
            stats["zoom_max"] = max(stats["zoom_max"], v["zoom"])
            stats["frames"] += 1
            if fx:
                stats["fx_frames"] += 1
                key = (fx["effect"], round(fx.get("at", 0.0), 2))
                if key not in stats["fx_seen"]:
                    stats["fx_seen"].add(key)
                    stats["fx"][fx["effect"]] = stats["fx"].get(fx["effect"], 0) + 1
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

    quiet = stats["frames"] - stats["fx_frames"]
    print(f"{stats['frames']} frames ({stats['frames']/fps:.1f}s), "
          f"zoom {stats['zoom_min']:.3f}-{stats['zoom_max']:.3f}, "
          f"{os.path.getsize(out)/1e6:.1f} MB -> {out}", file=sys.stderr)
    print(f"  effects: {stats['fx'] or 'none'}; "
          f"{100*quiet/max(1,stats['frames']):.0f}% of frames carry no effect "
          f"at all, which is the point", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
