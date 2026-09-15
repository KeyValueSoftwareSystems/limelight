"""How a stretch of song feels, measured from the 53-stem lanes.

MOSS returns 1 for all six of its dimensions on every segment of every song,
so the three with a physical correlate are measured here instead. It is a
module of its own so the pipeline and a re-run over finished scores compute
them the same way.
"""


import math

BRIGHT = ("hh", "cymbals", "crash", "ride", "shaker", "tambourine", "violin",
          "flute", "piccolo", "synth", "keys", "piano", "digital-piano", "bells")
PERC = ("drums", "kick", "snare", "hh", "toms", "percussion", "clap", "cymbals",
        "shaker", "tambourine", "congas", "bongos")


def _envelope_max(loud, name, lane):
    at = (loud or {}).get(name)
    if not isinstance(at, dict):
        return 1.0
    rms = at.get("rms")
    if rms and lane:
        power = sum(x * x for x in lane) / len(lane)
        if power > 0:
            return rms / (power ** 0.5)
    return at.get("peak") or 1.0


MINORISH = ("min", "dim", "hdim")
MAJORISH = ("maj", "aug", "sus", "7", "9", "11", "13", "6")


def _quality(label):
    if not label or label in ("N", "X"):
        return None
    part = label.split(":")[1].lower() if ":" in label else "maj"
    if part.startswith(MINORISH):
        return -1.0
    if part.startswith(MAJORISH) or part == "":
        return 1.0
    return None


def chord_mode(chords, a, b):
    """How major or minor a stretch is, weighted by how long each chord holds.

    -1 is wholly minor, +1 wholly major. BTC's quality labels are audible in
    the chroma at a chord-root-relative AUC of 0.936 on 28 of 29 songs, so the
    label is trustworthy even where the key estimate is not.

    Deliberately not put on the 1-10 per-song scale the other dimensions use.
    Those are relative to the song; this one is absolute, and stretching a song
    that never leaves minor across the full range would draw it as turning
    major. Measured over 29 songs it varies on every one of them, median sd
    0.438, and it is the least redundant thing in the block: |r| 0.43 with
    energy, 0.30 with brightness, 0.23 with groove, where those three sit at
    0.53 to 0.70 against each other.

    It is not valence and must not be called that. Against two independently
    trained text-audio models it correlates -0.007, and a probe trained on
    1802 human-annotated DEAM excerpts reaches 0.033 within songs against a
    rater ceiling of 0.522 - the raters agree with themselves at alpha 0.13.
    """
    if not chords:
        return None
    num = den = 0.0
    for c in chords:
        q = _quality(c.get("chord"))
        if q is None:
            continue
        start = float(c.get("start") or 0.0)
        end = float(c.get("end") or start)
        held = max(0.0, min(b, end) - max(a, start))
        if held > 0:
            num += q * held
            den += held
    return round(num / den, 3) if den > 0 else None


def measured_feel(heard, a, b):
    """The three dimensions read off the mix instead of off the lanes.

    Each is the thing its name claims: loudness, spectral centroid, and the
    percussive share of the spectrum. Over 29 songs the lane versions tracked
    these at 0.785, -0.083 and 0.345 - brightness was below chance and its
    sign flipped between songs, so it said opposite things about two tracks."""
    import acoustic as A

    if not isinstance(heard, dict):
        return None
    loud = A.span(heard, "loudness", a, b)
    if loud is None:
        return None
    cen = A.span(heard, "centroid_hz", a, b)
    perc = A.span(heard, "percussive", a, b)
    out = {"energy": loud}
    if cen and cen > 0:
        out["brightness"] = math.log2(cen)
    if perc is not None:
        out["groove"] = perc
    return out


def raw_feel(temporal, a, b, loud=None):
    """Unscaled energy, brightness and groove for one span, off the stem lanes.

    MOSS returns 1 for all six dimensions on every segment of every song, so
    the three with a physical correlate are measured here instead.

    The lanes are divided by each instrument's own envelope max, so averaging
    them raw counts how many instruments are near their personal maximum and
    six quiet ones outrank a loud two. Each lane is weighted back up by that
    divisor, recovered exactly as rms / sqrt(mean(lane^2))."""
    if not temporal or not temporal.get("stems"):
        return None
    w = temporal.get("window_s") or 0.5
    lanes = temporal["stems"]
    i, j = int(a / w), max(int(a / w) + 1, int(b / w))
    gain = {k: _envelope_max(loud, k, v) for k, v in lanes.items()
            if isinstance(v, list) and v}
    if not any(gain.values()):
        gain = {k: 1.0 for k in gain}

    def mean_of(names):
        got, total = 0.0, 0.0
        for k, v in lanes.items():
            if names and not any(n in k.lower() for n in names):
                continue
            seg = v[i:j]
            if seg:
                g = gain.get(k, 1.0)
                got += (sum(seg) / len(seg)) * g
                total += g
        return got / total if total else 0.0

    whole = mean_of(())
    if whole <= 0:
        return None
    return {"energy": whole,
            "brightness": mean_of(BRIGHT) / max(whole, 1e-6),
            "groove": mean_of(PERC) / max(whole, 1e-6)}


def scale_feel(raws):
    """Put each dimension on 1-10 against its own song, and say which moved.

    A dimension whose whole-song spread is under 5% of its peak is flat, and
    stretching that onto 1-10 would draw noise as a curve, so it is left out
    of both the output and the `measured` list."""
    out = [{} for _ in raws]
    moved = []
    for dim in ("energy", "brightness", "groove"):
        vals = [r[dim] for r in raws]
        lo, hi = min(vals), max(vals)
        if hi - lo < max(0.01, 0.05 * hi):
            continue
        moved.append(dim)
        for i, v in enumerate(vals):
            out[i][dim] = round(1.0 + 9.0 * (v - lo) / (hi - lo), 1)
    return out, moved


def clean_emotion(emotion, duration=None, temporal=None, sections=None, loud=None, heard=None, chords=None):
    """The feel of each span, measured, whatever named the spans.

    energy, brightness and groove are read off the stem lanes here, so the
    only thing MOSS contributes is where one span ends and the next begins
    and a word for it. When it returns nothing usable - six of twenty songs -
    the sections serve as the spans and the curve is the same measurement,
    without the word."""
    if not emotion and sections:
        emotion = [{"start": x["start"], "end": x["end"],
                    "emotion": x.get("label") or "neutral",
                    "from": "sections"}
                   for x in sections
                   if isinstance(x, dict) and x.get("start") is not None
                   and x.get("end") is not None]
    if not emotion:
        return []
    out = []
    for e in emotion:
        try:
            item = {
                "start": float(str(e.get("start", e.get("start_s", 0))).rstrip("s")),
                "end": float(str(e.get("end", e.get("end_s", 0))).rstrip("s")),
                "energy": float(e.get("energy", 5)),
                "brightness": float(e.get("brightness", 5)),
                "groove": float(e.get("groove", 5)),
                "emotion": str(e.get("emotion", "neutral")),
            }
            if "description" in e:
                item["description"] = str(e["description"])
            if e.get("from"):
                item["spans_from"] = str(e["from"])
            if item["start"] < item["end"]:
                out.append(item)
        except:
            pass
    out.sort(key=lambda x: x["start"])

    filled = []
    for i, seg in enumerate(out):
        if filled and seg["start"] > filled[-1]["end"] + 0.5:
            gap = {**filled[-1], "start": filled[-1]["end"], "end": seg["start"]}
            filled.append(gap)
        filled.append(seg)

    if filled:
        if filled[0]["start"] > 0.5:
            first = {**filled[0], "start": 0.0, "end": filled[0]["start"]}
            filled.insert(0, first)
        if duration and filled[-1]["end"] < duration - 0.5:
            last = {**filled[-1], "start": filled[-1]["end"], "end": round(duration, 3)}
            filled.append(last)
        filled[-1]["end"] = round(duration, 3) if duration else filled[-1]["end"]

    for i in range(len(filled) - 1):
        filled[i]["end"] = filled[i + 1]["start"]

    raws = []
    for seg in filled:
        got = measured_feel(heard, seg["start"], seg["end"])
        if got is None:
            got = raw_feel(temporal, seg["start"], seg["end"], loud)
        raws.append(got)
    modes = [chord_mode(chords, seg["start"], seg["end"]) for seg in filled]
    if filled and all(raws):
        scaled, moved = scale_feel(raws)
        for seg, got in zip(filled, scaled):
            seg.update(got)
            if moved:
                seg["measured"] = moved

    if any(m is not None for m in modes):
        for seg, m in zip(filled, modes):
            if m is None:
                seg.pop("mode", None)
                continue
            seg["mode"] = m
            got = list(seg.get("measured") or ())
            if "mode" not in got:
                got.append("mode")
            seg["measured"] = got

    for seg in filled:
        for k in ("valence", "arousal", "tension"):
            seg.pop(k, None)

    kept = set(filled[0].get("measured") or ()) if filled else set()
    for k in ("energy", "brightness", "groove"):
        if k in kept:
            continue
        if len({seg.get(k) for seg in filled}) < 3:
            for seg in filled:
                seg.pop(k, None)
    return filled
