import json
import sys
import warnings
from pathlib import Path

import numpy as np

warnings.filterwarnings("ignore")
sys.path.insert(0, str(Path(__file__).resolve().parent))

from cycle import cycle
from groove import groove
from heard import agrees, edges as model_edges
from steady import all_tells as tells_of
from words import WORDS_MODEL, words as lyrics
from grid import grid, bar_edges, show, at_beat
import motion
import ident
from form import on_phrase
from shape import shape
from call import call
from parts import curves
from pulse import pulse
from facts import SCALES, presence, seated, turns
from lead import hear as lead_line
from melody import chants, echoes, fix as octaves, line as tune_line
from melody import score as melody_of, sung as sung_in, voice as voice_of
from melody import phrases_of
from moments import carries, moments, pick, weigh
from phrase import phrases as sub_phrases
from harmony import changes as chord_changes
from harmony import chords as find_chords
from harmony import per_bar as chords_per_bar
from stems import NAMES as STEM_NAMES
from stems import MORE as STEM_MORE
from stems import envelopes, wider, per_bar, per_beat, per_tick
from voice import clean as clean_voice, made_by as voice_made_by
from texture import air, bands, duck, pace, sides
from grain import held as ringing, noisy


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


def second_opinion(path, slug):
    at = CACHE / f"{slug}.beatthis.npy"
    if at.exists():
        return np.load(at)[:, 0]
    try:
        from beat_this.inference import File2Beats
    except Exception:
        return None
    beats, _ = File2Beats(device="cpu", dbn=False)(path)
    beats = np.asarray(beats, dtype=float)
    at.parent.mkdir(parents=True, exist_ok=True)
    np.save(at, np.stack([beats, np.zeros(len(beats))], axis=1))
    return beats


def agreed(mine, theirs, tol=0.070):
    if theirs is None or len(mine) < 4 or len(theirs) < 4:
        return None
    hit = sum(1 for t in mine if np.min(np.abs(theirs - t)) <= tol) / len(mine)
    a, b = float(np.median(np.diff(mine))), float(np.median(np.diff(theirs)))
    if not b:
        return None
    off = abs(a / b - 1.0)
    same = max(0.0, min(1.0, 1.0 - off / 0.10))
    return round(hit * (0.4 + 0.6 * same), 3)


WANT = ["rhythm.bpm", "tonal.key_edma.key", "tonal.key_edma.scale", "tonal.key_edma.strength",
        "tonal.tuning_frequency", "tonal.tuning_equal_tempered_deviation",
        "tonal.chords_key", "tonal.chords_scale",
        "tonal.chords_strength.mean", "tonal.chords_changes_rate",
        "lowlevel.loudness_ebu128.integrated", "lowlevel.loudness_ebu128.loudness_range",
        "lowlevel.dynamic_complexity", "rhythm.danceability", "rhythm.onset_rate"]

KEYS = ["key.root", "key.scale", "key.strength"]
PROFILE = "edma"
TEMPERED = 0.10
SAME = 0.95


def in_tune(f):
    drift = f.get("tonal.tuning_equal_tempered_deviation")
    if drift is None or drift >= TEMPERED:
        return None
    return round(f["tonal.tuning_frequency"], 1)


def listen(path, slug, times):
    at = CACHE / f"{slug}.heard.json"
    loud_at = CACHE / f"{slug}.loud.npy"
    if at.exists() and loud_at.exists() and (CACHE / f"{slug}.flux.npy").exists():
        d = json.loads(at.read_text())
        if all(k in d["f"] for k in WANT + KEYS):
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
    root, scale, strength = es.KeyExtractor(profileType=PROFILE)(audio)
    f["key.root"], f["key.scale"], f["key.strength"] = str(root), str(scale), float(strength)
    length_s = len(audio) / 44100.0
    loud = np.asarray(loud, dtype=float)
    at.parent.mkdir(parents=True, exist_ok=True)
    at.write_text(json.dumps({"length_s": length_s, "f": f}))
    np.save(loud_at, loud)
    np.save(CACHE / f"{slug}.flux.npy", flux)
    return length_s, loud, f


def per_bar_loud(loud, times, g):
    cuts = bar_edges(g)
    at = np.searchsorted(np.asarray(cuts, dtype=float), np.asarray(times, dtype=float),
                         side="right") - 1
    out = []
    for b in range(len(cuts) - 1):
        v = loud[(at == b) & (loud > 0)]
        out.append(float(v.mean()) if len(v) else 0.0)
    peak = max(out, default=0.0)
    if not peak:
        return [0.0] * len(out)
    return [round(x / peak, 3) for x in out]


def alike(spans, chroma, voices, labels):
    import sklearn.metrics

    rows = []
    for a, b, *_ in spans:
        hi = max(b, a + 1)
        h = chroma[:, a:hi].mean(axis=1)
        h = h / (np.linalg.norm(h) + 1e-9)
        if voices is not None and voices.shape[1] >= hi:
            v = voices[:, a:hi].mean(axis=1)
            v = v / (np.linalg.norm(v) + 1e-9)
            rows.append(np.concatenate([h, v * 0.5]))
        else:
            rows.append(h)
    x = np.vstack(rows)
    out = list(labels[:len(x)]) + [None] * max(0, len(x) - len(labels))
    if len(x) < 4 or len(set(out)) < 2:
        return [0.0] * len(x)
    apart = sklearn.metrics.silhouette_samples(x, np.asarray(out))
    return [round(max(0.0, float(v)), 3) for v in apart]


def turning(voices, a, b, busy):
    if voices is None or b - a < 8:
        return None
    lanes = {}
    for i, name in enumerate(STEM_NAMES):
        if i < voices.shape[0]:
            lanes[name] = voices[i][a:b].tolist()
    v = busy[0] if busy.ndim > 1 else busy
    lanes["busy"] = v[a:b].tolist()
    return cycle(lanes)


def held_bars(v, a, b):
    top = len(v)
    if not top:
        return np.zeros(1)
    lo = min(max(0, a), top - 1)
    hi = min(max(b, lo + 1), top)
    part = v[lo:hi]
    return part if part.size else v[-1:]


def sections(spans, voices, busy, pickup, report=None, chroma=None, edges=None,
             steps=None, labels=()):
    from parts import how_much, word_for

    v = busy[0] if busy.ndim > 1 else busy
    v = np.nan_to_num(np.asarray(v, dtype=float), nan=0.0, posinf=0.0, neginf=0.0)
    peak = float(np.percentile(v, 98)) if v.size else 0.0
    if not np.isfinite(peak) or peak == 0.0:
        peak = 1.0
    apart = (alike(spans, chroma, voices, labels) if chroma is not None
             else [None] * len(spans))
    out, had = [], {}
    for n, (a, b, role) in enumerate(spans):
        part = held_bars(v, a, b)
        rel = float(part.mean() / peak)
        third = max(1, len(part) // 3)
        rise = float((part[-third:].mean() - part[:third].mean()) / peak)
        has = how_much(voices, a, b)
        out.append({
            "from_bar": a + 1 - pickup,
            "to_bar": b - pickup,
            "role": role,
            "edge": (edges[n] if edges is not None and n < len(edges) else None),
            "sudden": (steps[n] if steps is not None and n < len(steps) else None),
            "sure": apart[n],
            "trades": turning(voices, a, b, busy),
            "feels": word_for(rel, rise, has, had),
            "fullness": round(rel, 3),
            "rise": round(rise, 3),
            "playing": [n for n, (st, _) in has.items() if st != "none"],
            "stems": {
                n: {"is": st, "sits": lv,
                    "level": round(float(held_bars(voices[i], a, b).mean()), 3)
                    if i < voices.shape[0] else 0.0}
                for i, (n, (st, lv)) in enumerate(has.items())},
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
            step = shift * 60.0 / g["bpm"]
            g["first_beat_s"] = round(g["first_beat_s"] + step, 4)
            # The tempo map is anchored in seconds too, so a correction by ear
            # has to move it as well or the map and first_beat_s disagree by
            # exactly the shift -- which is every cue one beat out.
            for seg in g.get("tempo") or []:
                seg["at_s"] = round(seg["at_s"] + step, 4)
            g["bars"] = int((length_s - g["first_beat_s"]) //
                            (60.0 / g["bpm"] * g["beats_per_bar"])) + 1
            report["moved_by_ear"] = shift
    on_grid = np.asarray([at_beat(g, i)
                          for i in range(int(g["bars"] * g["beats_per_bar"]))])
    g["sure"] = agreed(on_grid, second_opinion(path, slug))
    report["grid_sure"] = g["sure"]
    bar_s = (60.0 / g["bpm"]) * g["beats_per_bar"]
    # Bars are cut where the tempo map says they fall, not every bar_s seconds.
    # Raga of Revenge runs at 89 for its first eighteen seconds: slicing it at
    # one tempo put every bar from 8 onward 4.1s adrift, and the sections found
    # on those bars inherited the error. Amal heard it before any test did.
    cuts = bar_edges(g)
    env = envelopes(path, slug)
    sung, tune = clean_voice(path, slug)
    if sung is not None:
        keep = min(len(sung), len(env["vocals"]))
        lane = np.zeros_like(env["vocals"])
        lane[:keep] = sung[:keep]
        env["vocals"] = lane
        report["voice_from"] = "roformer"
    lanes = per_bar(env, g["first_beat_s"], bar_s, g["bars"], edges=cuts)
    lanes.update(per_bar(wider(path, slug), g["first_beat_s"], bar_s, g["bars"],
                         edges=cuts))
    heard_env = dict(env)
    heard_env.update(wider(path, slug))
    ticks = per_tick(heard_env, cuts, per=g["beats_per_bar"] * 4)
    beat_lanes = per_beat(heard_env, times)
    swing = groove(env, cuts, per=g["beats_per_bar"] * 4)
    voices = np.vstack([lanes[k] for k in STEM_NAMES])
    busy, bright = curves(path, g, edges=cuts)
    pickup = 1 if g["first_beat_s"] > 0.2 else 0
    g["first_bar"] = 0 if pickup else 1
    g["last_bar"] = g["bars"]
    found, held = find_chords(path, slug)
    chord, chord_sure = chords_per_bar(found, held, g["first_beat_s"], bar_s, g["bars"], pickup)
    stereo = Path("synth/incoming") / f"{slug}.mp3"
    stereo = str(stereo) if stereo.exists() else path
    edges_now = cuts
    flux_now = np.load(CACHE / f"{slug}.flux.npy")
    score_bars = {
        "intensity": per_bar_loud(loud, times, g),
        "width": [round(float(x), 3) for x in sides(stereo, edges_now)],
        **{k: [round(float(x), 3) for x in v]
           for k, v in bands(stereo, edges_now).items()},
        "air": [round(float(x), 3) for x in air(path, edges_now)],
        "noisy": [round(float(x), 3) for x in noisy(path, edges_now)],
        "sustained": [round(float(x), 3) for x in ringing(env, edges_now)],
        "pump": [round(float(x), 3) for x in duck(env, g, edges_now, times)],
        "pace": [round(float(x), 3) for x in pace(flux_now, g, edges_now)],
        **{k: [round(x, 3) for x in lanes[k]] for k in STEM_NAMES},
        **{k: [round(x, 3) for x in lanes[k]] for k in STEM_MORE if k in lanes},
        "brightness": [round(float(x), 3) for x in bright.ravel()],
        "chord": chord,
        "chord_sure": chord_sure,
    }
    for name, lane in list(score_bars.items()):
        if name in ("chord", "chord_sure") or not lane:
            continue
        seen = [x for x in lane if x is not None]
        if not seen:
            continue
        top = max(seen.count(v) for v in set(seen))
        if top / len(seen) >= SAME:
            score_bars[name] = [None] * len(lane)
    beats, pull, gone = pulse(path, g, times, positions, np.load(CACHE / f"{slug}.flux.npy"),
                              env, report)
    flux = np.load(CACHE / f"{slug}.flux.npy")
    edges = list(cuts)
    heard_stems = list(STEM_NAMES) + [k for k in STEM_MORE if k in score_bars]
    rows = np.asarray([score_bars[k] for k in heard_stems] +
                      [[x if x is not None else 0.0 for x in score_bars["intensity"]],
                       [x if x is not None else 0.0 for x in score_bars["pace"]]],
                     dtype=float)
    shifts = []
    for seg in (g.get("tempo") or [])[1:]:
        at = seg["at_s"]
        near = min(range(len(edges)), key=lambda i: abs(edges[i] - at))
        if abs(edges[near] - at) <= (edges[1] - edges[0] if len(edges) > 1 else 2.0):
            shifts.append(near)
    found_spans, how, chroma = shape(path, edges, rows, shifts=shifts,
                                     stems=len(heard_stems))
    report["tempo_shifts"] = len(shifts)
    report["sections_from"] = how
    grid_says = {}
    snapped = on_phrase([list(s) for s in found_spans], pickup,
                        firm=how.get("firm"), tell=grid_says)
    told = call([(a, b, m) for a, b, m in snapped], score_bars)
    kept = []
    for said in told:
        if (kept and kept[-1]["role"] == said["role"] == "bridge"
                and said["to"] - kept[-1]["from"] <= 16):
            kept[-1]["to"] = said["to"]
            continue
        kept.append(said)
    told = kept
    shaped = sections([(s["from"], s["to"], s["role"]) for s in told],
                      voices, busy, pickup, report, chroma,
                      edges=[s.get("edge") for s in told],
                      steps=[s.get("sudden") for s in told],
                      labels=[s["like"] for s in told])
    # A second opinion on the boundaries from a model that shares no code and
    # no training data with the detectors above. Recorded per section rather
    # than merged into them: where both heard a boundary that is worth knowing,
    # and where only one did that is worth knowing too.
    seen = CACHE / f"{slug}.muq.npy"
    if seen.exists():
        found = model_edges(np.load(seen), g, g["bars"])
        told_bars = [x["from_bar"] + pickup for x in shaped]
        near = agrees(told_bars, found)
        for part in shaped:
            lift = near.get(part["from_bar"] + pickup)
            part["also_heard"] = round(float(lift), 3) if lift else None
        report["model_edges"] = len(found)
        report["model_agreed"] = len(near)
    for part, said in zip(shaped, told):
        part["nth"] = said["nth"]
        part["like"] = said["like"]
        part["returns"] = said["returns"]

    curve_tells = tells_of(score_bars, shaped, g["first_bar"])

    peak = [t for t in told if t["role"] in ("drop", "chorus")]
    anchor = peak[0]["mark"] if peak else (told[0]["mark"] if told else 0)
    origin = grid_says.get("origin", 1)
    every = grid_says.get("every", 4)
    phrase_rule = {"every_bars": every, "from_bar": origin}

    lyrics_out = None
    heard_words = CACHE / f"{slug}.words.json"
    if heard_words.exists():
        twice = CACHE / f"{slug}.words2.json"
        lyrics_out = lyrics(json.loads(heard_words.read_text()), g, g["bars"], origin, 2,
                            again=(json.loads(twice.read_text()).get("said")
                                   if twice.exists() else None))
        if lyrics_out:
            report["words"] = len(lyrics_out["words"])
    show(slug, g, report, {"essentia hears": f["rhythm.bpm"]})

    told_now = moments(g, lanes, busy.ravel() if busy.ndim > 1 else busy,
                       bright.ravel(), score_bars["intensity"],
                       score_bars["chord"], score_bars["chord_sure"],
                       [(a, b, m) for a, b, m in snapped], anchor,
                       chroma, env, gone, pickup,
                       air=score_bars["air"], pace=score_bars["pace"],
                       width=score_bars["width"], tune=tune, report=report)
    edges_at = {t["from"] - pickup + 1 for t in told}
    heard = tune_line(tune, sung)
    heard, slipped = octaves(heard)
    told_now += chants(heard, g, pickup)
    told_now += echoes(heard, g, pickup)
    riff_f0, riff_env = lead_line(path, slug)
    riff = tune_line(riff_f0, riff_env) if riff_f0 is not None else []
    riff, strayed = octaves(riff)
    told_now += chants(riff, g, pickup, least=10, played="played")
    told_now += echoes(riff, g, pickup, played="riff")
    carries(told_now, [(a, b, m) for a, b, m in snapped], pickup,
            g["beats_per_bar"])
    told_now.sort(key=lambda m: (m["bar"], m["beat"], m["is"]))
    inner = sub_phrases(
        [(t["from"], t["to"], t["role"], t["nth"]) for t in told],
        score_bars, told_now, every, origin, pickup)
    weigh(told_now, score_bars, edges_at,
          {q["from_bar"] for q in inner}, pickup)
    seats = [(p["from_bar"], p["to_bar"]) for p in shaped]
    for part, tune_of in zip(shaped, sung_in(heard, seats, g, pickup)):
        if tune_of is not None:
            part["sung"] = tune_of
    for part, riff_of in zip(shaped, sung_in(riff, seats, g, pickup)):
        if riff_of is not None:
            part["played"] = riff_of
    staged = pick(told_now, edges_at, g["bars"])
    if report is not None:
        report["phrases"] = len(inner)
        report["staged"] = len(staged)

    tune_notes = sorted(melody_of(heard, g, pickup)
                        + melody_of(riff, g, pickup, "lead"),
                        key=lambda n: (n["bar"], n["beat"]))
    return {
        "score": slug,
        "version": 0,
        "song": {"length_s": round(length_s, 3), "bars": g["bars"]},
        "scales": SCALES,
        "recording": ident.named(path),
        "made_by": {
            "voice_from": voice_made_by(slug),
            "voice_pitch_from": "librosa.yin 65-1200 Hz" if heard else None,
            "lead_from": "htdemucs" if riff else None,
            "melody_from": "librosa.salience argmax, 80-1200 Hz" if riff else None,
            "words_from": WORDS_MODEL if lyrics_out else None,
        },
        "grid": g,
        "key": {
            "root": f["key.root"],
            "scale": f["key.scale"],
            "confidence": round(f["key.strength"], 3),
            "tuned_to_hz": in_tune(f),
        },
        "chords": {
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
        "lift": pull,
        "releases": seated(gone, g, pickup),
        "phrase_grid": phrase_rule,
        "chord_changes": turns(score_bars["chord"], score_bars["chord_sure"],
                              g["first_bar"]),
        "presence": presence(score_bars, g["first_bar"]),
        "motion": motion.reading(score_bars, g["first_bar"]),
        "phrases": inner,
        "moments": staged,
        "signals": told_now,
        "voice": voice_of(heard, slipped),
        "lead": voice_of(riff, strayed) if riff else None,
        "ticks": {"per_bar": g["beats_per_bar"] * 4, "of": "the loudest moment in each sixteenth",
                  **{k: v for k, v in ticks.items()}},
        "per_beat": {"from_beat": 0, "of": "each stem's mean level over one beat, "
                                           "scaled to that stem's own loudest beat",
                     **{k: v for k, v in beat_lanes.items()}},
        "groove": swing,
        "melody": tune_notes,
        "melody_phrases": phrases_of(tune_notes, g, g["beats_per_bar"]),
        "curve_tells": curve_tells or None,
        "lyrics": lyrics_out,
    }


if __name__ == "__main__":
    out = Path("scores")
    out.mkdir(exist_ok=True)
    for arg in sys.argv[1:]:
        src = Path(arg)
        score = read(str(src), src.stem)
        (out / f"{src.stem}.score").write_text(
            json.dumps(score, indent=2, allow_nan=False) + "\n")
        print(f"    -> scores/{src.stem}.score", file=sys.stderr)
