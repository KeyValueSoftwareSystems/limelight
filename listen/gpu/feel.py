"""How a stretch of song feels, measured from the 53-stem lanes.

MOSS returns 1 for all six of its dimensions on every segment of every song,
so the three with a physical correlate are measured here instead. It is a
module of its own so the pipeline and a re-run over finished scores compute
them the same way.
"""


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


def clean_emotion(emotion, duration=None, temporal=None, sections=None, loud=None):
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
                "valence": float(e.get("valence", 5)),
                "arousal": float(e.get("arousal", 5)),
                "tension": float(e.get("tension", 5)),
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

    raws = [raw_feel(temporal, seg["start"], seg["end"], loud) for seg in filled]
    if filled and all(raws):
        scaled, moved = scale_feel(raws)
        for seg, got in zip(filled, scaled):
            seg.update(got)
            if moved:
                seg["measured"] = moved

    kept = set(filled[0].get("measured") or ()) if filled else set()
    for k in ("valence", "arousal", "tension", "energy", "brightness", "groove"):
        if k in kept:
            continue
        if len({seg.get(k) for seg in filled}) < 3:
            for seg in filled:
                seg.pop(k, None)
    return filled
