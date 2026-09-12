import json
import sys
import warnings
from pathlib import Path

import numpy as np

warnings.filterwarnings("ignore")
sys.path.insert(0, str(Path(__file__).resolve().parent))

from grid import grid, show
from parts import curves, parts
from events import events
from harmony import changes as chord_changes
from harmony import chords as find_chords
from harmony import per_bar as chords_per_bar
from stems import NAMES as STEM_NAMES
from stems import envelopes, per_bar


CACHE = Path("work/heard")


def track(path, slug):
    at = CACHE / f"{slug}.beats.npy"
    if at.exists():
        out = np.load(at)
    else:
        from madmom.features.downbeats import DBNDownBeatTrackingProcessor, RNNDownBeatProcessor

        act = RNNDownBeatProcessor()(path)
        out = DBNDownBeatTrackingProcessor(beats_per_bar=[3, 4], fps=100)(act)
        at.parent.mkdir(parents=True, exist_ok=True)
        np.save(at, out)
    return out[:, 0], out[:, 1], out[:, 0][out[:, 1] == 1]


WANT = ["rhythm.bpm", "tonal.key_edma.key", "tonal.key_edma.scale", "tonal.key_edma.strength",
        "tonal.tuning_frequency", "tonal.chords_key", "tonal.chords_scale",
        "tonal.chords_strength.mean", "tonal.chords_changes_rate",
        "lowlevel.loudness_ebu128.integrated", "lowlevel.loudness_ebu128.loudness_range",
        "lowlevel.dynamic_complexity", "rhythm.danceability", "rhythm.onset_rate"]


def listen(path, slug, times):
    at = CACHE / f"{slug}.heard.json"
    loud_at = CACHE / f"{slug}.loud.npy"
    if at.exists() and loud_at.exists() and (CACHE / f"{slug}.flux.npy").exists():
        d = json.loads(at.read_text())
        return d["length_s"], np.load(loud_at), d["f"]

    import essentia.standard as es

    audio = es.MonoLoader(filename=path)()
    loud, _ = es.BeatsLoudness(beats=times.tolist())(audio)
    flux = np.asarray(es.SuperFluxExtractor()(audio), dtype=float)
    feats, _ = es.MusicExtractor(
        lowlevelStats=["mean", "stdev"],
        rhythmStats=["mean", "stdev"],
        tonalStats=["mean", "stdev"],
    )(path)
    f = {k: (str(feats[k]) if isinstance(feats[k], str) else float(feats[k])) for k in WANT}
    length_s = len(audio) / 44100.0
    loud = np.asarray(loud, dtype=float)
    at.parent.mkdir(parents=True, exist_ok=True)
    at.write_text(json.dumps({"length_s": length_s, "f": f}))
    np.save(loud_at, loud)
    np.save(CACHE / f"{slug}.flux.npy", flux)
    return length_s, loud, f


def per_bar_loud(loud, times, g):
    period = 60.0 / g["bpm"]
    span = period * g["beats_per_bar"]
    at = np.floor((times - g["first_beat_s"]) / span).astype(int) + 1
    out = []
    first = 0 if g["first_beat_s"] > 0.2 else 1
    for b in range(first, g["bars"] + 1):
        v = loud[(at == b) & (loud > 0)]
        out.append(float(v.mean()) if len(v) else None)
    peak = max((x for x in out if x is not None), default=None)
    if not peak:
        return [None] * len(out)
    return [round(x / peak, 3) if x is not None else None for x in out]


def read(path, slug):
    times, positions, downs = track(path, slug)
    length_s, loud, f = listen(path, slug, times)

    report = {"first_beat_heard": float(times[0]), "first_position": int(positions[0])}
    g = grid(times, downs, length_s, report)
    bar_s = (60.0 / g["bpm"]) * g["beats_per_bar"]
    env = envelopes(path, slug)
    lanes = per_bar(env, g["first_beat_s"], bar_s, g["bars"])
    voices = np.vstack([lanes[k] for k in STEM_NAMES])
    busy, bright = curves(path, g)
    pickup = 1 if g["first_beat_s"] > 0.2 else 0
    found, held = find_chords(path, slug)
    chord, chord_sure = chords_per_bar(found, held, g["first_beat_s"], bar_s, g["bars"], pickup)
    show(slug, g, report, {"essentia hears": f["rhythm.bpm"]})

    return {
        "score": slug,
        "version": 0,
        "song": {"length_s": round(length_s, 3)},
        "grid": g,
        "key": {
            "root": f["tonal.key_edma.key"],
            "scale": f["tonal.key_edma.scale"],
            "confidence": round(f["tonal.key_edma.strength"], 3),
            "tuned_to_hz": round(f["tonal.tuning_frequency"], 1),
        },
        "chords": {
            "root": f["tonal.chords_key"],
            "scale": f["tonal.chords_scale"],
            "confidence": round(f["tonal.chords_strength.mean"], 3),
            "changes_per_beat": round(f["tonal.chords_changes_rate"], 4),
        },
        "loudness": {
            "integrated_lufs": round(f["lowlevel.loudness_ebu128.integrated"], 2),
            "range_lu": round(f["lowlevel.loudness_ebu128.loudness_range"], 2),
            "dynamic_complexity": round(f["lowlevel.dynamic_complexity"], 2),
        },
        "feel": {
            "danceability": round(f["rhythm.danceability"], 3),
            "onsets_per_second": round(f["rhythm.onset_rate"], 3),
        },
        "bars": {
            "intensity": per_bar_loud(loud, times, g),
            **{k: [round(x, 3) for x in lanes[k]] for k in STEM_NAMES},
            "brightness": [round(float(x), 3) for x in bright.ravel()],
            "chord": chord,
            "chord_sure": chord_sure,
        },
        "parts": parts(path, g, report, voices),
        "events": events(g, lanes, busy, bright,
                         np.load(CACHE / f"{slug}.flux.npy"),
                         pickup, report, env) + chord_changes(chord, pickup),
    }


if __name__ == "__main__":
    out = Path("scores")
    out.mkdir(exist_ok=True)
    for arg in sys.argv[1:]:
        src = Path(arg)
        score = read(str(src), src.stem)
        (out / f"{src.stem}.score").write_text(json.dumps(score, indent=2) + "\n")
        print(f"    -> scores/{src.stem}.score", file=sys.stderr)
