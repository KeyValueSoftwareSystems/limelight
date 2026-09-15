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
    """Put each dimension on 1-10 against a fixed reference, not its own song.

    This used to stretch every dimension across each song's own min and max,
    so every song came out with a range of exactly 9.0 whatever it actually
    did. entharo-mahanu moves 47% in loudness and nod-krai 99.7%, and both
    were drawn edge to edge - the shape was right and the amplitude was
    fiction, and two songs could not be compared at all.

    The bounds below are absolute and cover the corpus with headroom: over 530
    spans, loudness runs -51 dB at the 1st percentile to -5.6 at the 99th,
    log2 centroid 9.3 to 12.3, percussive share 0.11 to 0.65. Values outside
    are clamped rather than rescaled, so a genuinely quiet song reads quiet and
    a flat one reads flat."""
    bounds = {
        "energy": (-55.0, -3.0),
        "brightness": (8.45, 12.77),
        "groove": (0.0, 0.75),
    }
    out = [{} for _ in raws]
    moved = []
    for dim, (lo, hi) in bounds.items():
        vals = [r.get(dim) if isinstance(r, dict) else None for r in raws]
        if not any(v is not None for v in vals):
            continue
        held = next(v for v in vals if v is not None)
        for i, v in enumerate(vals):
            if v is None:
                vals[i] = held
            else:
                held = v
        for seg, v in zip(out, vals):
            x = 20.0 * math.log10(max(v, 1e-6)) if dim == "energy" else v
            t = (x - lo) / (hi - lo) if hi > lo else 0.0
            seg[dim] = round(1.0 + 9.0 * min(1.0, max(0.0, t)), 1)
        moved.append(dim)
    return out, moved

def bar_spans(beats, sections, duration):
    """One span per bar, taking its label from the section it sits in.

    A section span is 15 seconds of song averaged into one number, and that
    throws away most of what happens: measured over the library, the loudness
    inside a single span swings across 42% of the song's whole range, and 68%
    on killers-from-the-northside. The graph drew straight lines between
    sixteen points where the music had a hundred.

    Bars come from the downbeats the tracker actually found rather than from
    bpm arithmetic, so a song whose tempo drifts still gets bars where its bars
    are. The section label rides along on each bar, so nothing that MOSS named
    is lost - the word is just attached to more, smaller pieces."""
    downs = [b["t"] for b in (beats or []) if b.get("downbeat")]
    if len(downs) < 8:
        return None
    edges = sorted(set(round(float(t), 3) for t in downs))
    if duration and edges[-1] < duration - 0.5:
        edges.append(round(float(duration), 3))
    named = []
    for a, b in zip(edges, edges[1:]):
        if b - a < 0.4:
            continue
        mid = (a + b) / 2.0
        word, note = "neutral", None
        for sec in sections or []:
            try:
                if float(sec["start"]) <= mid < float(sec["end"]):
                    word = sec.get("emotion") or sec.get("label") or "neutral"
                    note = sec.get("description")
                    break
            except (KeyError, TypeError, ValueError):
                continue
        row = {"start": a, "end": b, "emotion": str(word)}
        if note and (not named or named[-1].get("emotion") != word):
            row["description"] = str(note)
        named.append(row)
    return named or None


def _over_a_phrase(modes, span=2):
    """Read mode across a phrase rather than one bar.

    Per bar it is not a continuous measure at all, it is a chord label: a bar
    holds a median of two chords and they are usually the same quality, so 59%
    of bars land on exactly +1 or -1 and 86% do on the worst song. Drawn beside
    three continuous curves that reads as tonality lurching every two seconds,
    when the song is alternating Am and C inside one key.

    A single Am in a major song does not make that bar sad. Averaged over two
    bars either side the number answers the question the field is actually
    asking - how major is the harmony through here - which is what a mood
    dimension means and what a reader firing colour off it wants.

    Still `mode`, because it still measures major against minor. Only the
    window changed."""
    if not modes:
        return modes
    out = []
    for i in range(len(modes)):
        near = [m for m in modes[max(0, i - span):i + span + 1] if m is not None]
        out.append(round(sum(near) / len(near), 3) if near else None)
    return out


def clean_emotion(emotion, duration=None, temporal=None, sections=None, loud=None, heard=None, chords=None, beats=None):
    """The feel of each span, measured, whatever named the spans.

    energy, brightness and groove are read off the stem lanes here, so the
    only thing MOSS contributes is where one span ends and the next begins
    and a word for it. When it returns nothing usable - six of twenty songs -
    the sections serve as the spans and the curve is the same measurement,
    without the word."""
    by_bar = bar_spans(beats, emotion or sections, duration)
    if by_bar:
        emotion = by_bar
    elif not emotion and sections:
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
        modes = _over_a_phrase(modes)
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
