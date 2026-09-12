import json
import sys
import warnings
from pathlib import Path

import numpy as np

warnings.filterwarnings("ignore")
sys.path.insert(0, str(Path(__file__).resolve().parent))

from grid import grid, show
from form import on_phrase
from shape import shape
from call import call
from parts import curves, parts
from pulse import pulse
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


def sections(spans, voices, busy, pickup, report=None):
    from parts import how_much, word_for

    v = busy[0] if busy.ndim > 1 else busy
    peak = float(np.percentile(v, 98)) or 1.0
    out, had = [], {}
    for a, b, role in spans:
        part = v[a:b] if b > a else v[a:a + 1]
        rel = float(part.mean() / peak)
        third = max(1, len(part) // 3)
        rise = float((part[-third:].mean() - part[:third].mean()) / peak)
        has = how_much(voices, a, b)
        out.append({
            "from_bar": a + 1 - pickup,
            "to_bar": b - pickup,
            "role": role,
            "feels": word_for(rel, rise, has, had),
            "fullness": round(rel, 3),
            "rise": round(rise, 3),
            "playing": [n for n, (st, _) in has.items() if st != "none"],
            "stems": {n: {"is": st, "level": lv} for n, (st, lv) in has.items()},
        })
        had = has
    if report is not None:
        report["parts"] = len(out)
        report["kinds"] = sorted({str(p["role"]) for p in out})
    return out


def read(path, slug):
    times, positions, downs = track(path, slug)
    length_s, loud, f = listen(path, slug, times)

    report = {"first_beat_heard": float(times[0]), "first_position": int(positions[0])}
    g = grid(times, downs, length_s, report)

    said = Path("truth") / f"{slug}.grid.json"
    if said.exists():
        fix = json.loads(said.read_text())
        shift = int(fix.get("downbeat_shift_beats", 0))
        if shift:
            g["first_beat_s"] = round(g["first_beat_s"] + shift * 60.0 / g["bpm"], 4)
            g["bars"] = int((length_s - g["first_beat_s"]) //
                            (60.0 / g["bpm"] * g["beats_per_bar"])) + 1
            report["moved_by_ear"] = shift
    bar_s = (60.0 / g["bpm"]) * g["beats_per_bar"]
    env = envelopes(path, slug)
    lanes = per_bar(env, g["first_beat_s"], bar_s, g["bars"])
    voices = np.vstack([lanes[k] for k in STEM_NAMES])
    busy, bright = curves(path, g)
    pickup = 1 if g["first_beat_s"] > 0.2 else 0
    g["first_bar"] = 0 if pickup else 1
    g["last_bar"] = g["bars"] - pickup
    found, held = find_chords(path, slug)
    chord, chord_sure = chords_per_bar(found, held, g["first_beat_s"], bar_s, g["bars"], pickup)
    score_bars = {
        "intensity": per_bar_loud(loud, times, g),
        **{k: [round(x, 3) for x in lanes[k]] for k in STEM_NAMES},
        "brightness": [round(float(x), 3) for x in bright.ravel()],
        "chord": chord,
        "chord_sure": chord_sure,
    }
    beats, pull, gone = pulse(path, g, times, positions, np.load(CACHE / f"{slug}.flux.npy"),
                              env, report)
    flux = np.load(CACHE / f"{slug}.flux.npy")
    edges = ([0.0] if pickup else []) + [
        g["first_beat_s"] + i * bar_s for i in range(g["bars"] + 1)]
    rows = np.asarray([score_bars[k] for k in STEM_NAMES] +
                      [[x if x is not None else 0.0 for x in score_bars["intensity"]]],
                     dtype=float)
    found_spans, how = shape(path, edges, rows)
    report["sections_from"] = how
    snapped = on_phrase([list(s) for s in found_spans], pickup)
    told = call([(a, b, m) for a, b, m in snapped], score_bars)
    shaped = sections([(s["from"], s["to"], s["role"]) for s in told],
                      voices, busy, pickup, report)
    for part, said in zip(shaped, told):
        part["nth"] = said["nth"]
        part["like"] = said["like"]
        part["returns"] = said["returns"]
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
        "bars": score_bars,
        "parts": shaped,
        "beats": beats,
        "tension": pull,
        "releases": gone,
        "events": events(g, lanes, busy, bright,
                         np.load(CACHE / f"{slug}.flux.npy"),
                         pickup, report, env),
    }


if __name__ == "__main__":
    out = Path("scores")
    out.mkdir(exist_ok=True)
    for arg in sys.argv[1:]:
        src = Path(arg)
        score = read(str(src), src.stem)
        (out / f"{src.stem}.score").write_text(json.dumps(score, indent=2) + "\n")
        print(f"    -> scores/{src.stem}.score", file=sys.stderr)
