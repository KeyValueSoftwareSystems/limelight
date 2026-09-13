import numpy as np

STEMS = ("drums", "bass", "vocals", "other", "guitar", "piano")
HOLD = 4

SCALES = {
    "weight": {
        "kind": "per_song",
        "means": "share of the sound below 120 Hz -- how heavy it is",
    },
    "floor": {
        "kind": "per_song",
        "means": "share below 60 Hz -- the part you feel rather than hear",
    },
    "width": {
        "kind": "absolute",
        "runs": [0.0, 2.0],
        "means": "stereo sides against the middle",
    },
    "pump": {
        "kind": "absolute",
        "runs": [0.0, 1.0],
        "means": "how deeply the track ducks on the beat",
    },
    "brightness": {
        "kind": "per_song",
        "against": "the song's loudest frame",
        "means": "share of high-frequency bins above -38 dB",
    },
    "sustained": {
        "kind": "absolute",
        "runs": [0.0, 1.0],
        "means": "share of the bar spent at or above half its own peak",
    },
    "noisy": {
        "kind": "absolute",
        "runs": [0.0, 1.0],
        "means": "spectral flatness -- how noise-like rather than tonal",
    },
    "intensity": {
        "kind": "per_song",
        "against": "the song's loudest bar",
        "means": "how loud this bar is",
    },
    "air": {
        "kind": "per_song",
        "against": "the song's 98th percentile",
        "means": "share of the sound above 6 kHz",
    },
    "pace": {
        "kind": "per_song",
        "against": "the song's median bar",
        "means": "events per beat, 1.0 being ordinary",
    },
    "chord_sure": {
        "kind": "absolute",
        "runs": [0.0, 1.0],
        "means": "confidence in this bar's chord",
    },
    "ticks": {
        "kind": "per_song",
        "against": "that stem's own loudest sixteenth",
        "means": "the loudest moment in each sixteenth of the bar",
    },
    "per_beat": {
        "kind": "per_song",
        "against": "that stem's own loudest beat",
        "means": "that stem's mean level over one beat",
    },
    "groove": {
        "kind": "per_song",
        "against": "that stem's own strongest slot",
        "means": "how hard that stem hits at each sixteenth of a bar",
    },
}
for name in STEMS:
    SCALES[name] = {
        "kind": "per_song",
        "against": f"that stem's own loudest bar",
        "means": f"how loud {name} is in this bar",
    }


def turns(chord, sure, first_bar):
    out = []
    for i, name in enumerate(chord):
        if not name:
            continue
        if i and chord[i - 1] == name:
            continue
        out.append(
            {
                "bar": i + first_bar,
                "chord": name,
                "sure": round(float(sure[i] or 0.0), 3),
            }
        )
    return out


def presence(bars, first_bar, on=0.40, off=0.15):
    out = {}
    for name in STEMS:
        lane = np.asarray(
            [x if x is not None else 0.0 for x in bars[name]], dtype=float
        )
        if not len(lane):
            continue
        state, spans, at, grey = "out", [], 0, 0
        for i, v in enumerate(lane):
            now = state
            grey = grey + 1 if v < on else 0
            if state == "out" and v >= on:
                now = "in"
            elif state == "in" and v < off:
                now = "out"
            elif state == "in" and grey >= HOLD:
                now = "part"
            elif state == "out" and v >= off:
                now = "part"
            elif state == "part" and v >= on:
                now = "in"
            elif state == "part" and v < off:
                now = "out"
            if now != state:
                spans.append(
                    {
                        "from_bar": at + first_bar,
                        "to_bar": i + first_bar - 1,
                        "is": state,
                    }
                )
                state, at = now, i
        spans.append(
            {
                "from_bar": at + first_bar,
                "to_bar": len(lane) + first_bar - 1,
                "is": state,
            }
        )
        out[name] = [s for s in spans if s["to_bar"] >= s["from_bar"]]
    return out


def seated(gone, g, pickup):
    from grid import beat_at
    per = g["beats_per_bar"]
    first = g.get("first_bar", 1 - pickup)
    out = []
    for r in gone or []:
        was = dict(r)
        at = r.get("at_s")
        if at is None:
            i = int(r.get("beat_index", 0))
            was["bar"] = i // per + 1 - pickup
            was["beat"] = i % per + 1
        else:
            k = int(round(beat_at(g, float(at))))
            was["bar"] = max(first, k // per + first)
            was["beat"] = k % per + 1
        out.append(was)
    return out
