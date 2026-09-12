import numpy as np

STEMS = ("drums", "bass", "vocals", "other")

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
        "kind": "absolute",
        "runs": [0.0, 1.0],
        "means": "share of high-frequency bins above -38 dB",
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
        state, spans, at = "out", [], 0
        for i, v in enumerate(lane):
            now = state
            if state == "out" and v >= on:
                now = "in"
            elif state == "in" and v < off:
                now = "out"
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
    beat_s = 60.0 / g["bpm"]
    per = g["beats_per_bar"]
    out = []
    for r in gone or []:
        i = int(r.get("beat_index", 0))
        was = dict(r)
        was["bar"] = i // per + 1 - pickup
        was["beat"] = i % per + 1
        out.append(was)
    return out
