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
from mood import moods
from steady import all_tells as tells_of
from words import words as lyrics
from grid import grid, bar_edges, show
import motion
import ident
from form import on_phrase
from shape import shape
from call import call
from parts import curves, parts
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
from stems import envelopes, wider, per_bar, per_tick
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
    # Two beat trackers that share no code and no training data. Where they
    # agree the grid is worth trusting; where they disagree by an octave one of
    # them is counting a different pulse and the score cannot say which. This
    # is the only confidence in the file nobody had to label by ear.
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


def alike(spans, chroma, voices):
    import sklearn.cluster
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
    if len(x) < 4:
        return [chr(65 + i) for i in range(len(x))], [0.0] * len(x)
    best, pick, apart = -2.0, list(range(len(x))), None
    for k in range(2, min(7, len(x))):
        got = sklearn.cluster.AgglomerativeClustering(
            n_clusters=k, linkage="average").fit_predict(x)
        if len(set(got)) < 2:
            continue
        s = float(sklearn.metrics.silhouette_score(x, got))
        if s > best:
            best, pick = s, list(got)
            apart = sklearn.metrics.silhouette_samples(x, got)
    order, out = {}, []
    for lab in pick:
        if lab not in order:
            order[lab] = chr(65 + len(order))
        out.append(order[lab])
    sure = ([round(max(0.0, float(v)), 3) for v in apart] if apart is not None
            else [0.0] * len(x))
    return out, sure


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
             steps=None):
    from parts import how_much, word_for

    v = busy[0] if busy.ndim > 1 else busy
    v = np.nan_to_num(np.asarray(v, dtype=float), nan=0.0, posinf=0.0, neginf=0.0)
    peak = float(np.percentile(v, 98)) if v.size else 0.0
    if not np.isfinite(peak) or peak == 0.0:
        peak = 1.0
    # Which sections are the same section coming back. This was written in
    # parts.py and never ran: this function shadows that one, so every score
    # ever made carried repeats_as: null and nothing could say that a chorus
    # was a chorus it had already heard.
    same, apart = (alike(spans, chroma, voices) if chroma is not None
                   else ([None] * len(spans), [None] * len(spans)))
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
            "repeats_as": same[n],
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
    g["sure"] = agreed(times, second_opinion(path, slug))
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
    ticks = per_tick(env, cuts, per=g["beats_per_bar"] * 4)
    swing = groove(env, cuts, per=g["beats_per_bar"] * 4)
    voices = np.vstack([lanes[k] for k in STEM_NAMES])
    busy, bright = curves(path, g)
    pickup = 1 if g["first_beat_s"] > 0.2 else 0
    g["first_bar"] = 0 if pickup else 1
    g["last_bar"] = g["bars"] - pickup
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
        "held": [round(float(x), 3) for x in ringing(env, edges_now)],
        "pump": [round(float(x), 3) for x in duck(env, g, edges_now)],
        "pace": [round(float(x), 3) for x in pace(flux_now, g, edges_now)],
        **{k: [round(x, 3) for x in lanes[k]] for k in STEM_NAMES},
        **{k: [round(x, 3) for x in lanes[k]] for k in STEM_MORE if k in lanes},
        "brightness": [round(float(x), 3) for x in bright.ravel()],
        "chord": chord,
        "chord_sure": chord_sure,
    }
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
    shaped = sections([(s["from"], s["to"], s["role"]) for s in told],
                      voices, busy, pickup, report, chroma,
                      edges=[s.get("edge") for s in told],
                      steps=[s.get("sudden") for s in told])
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
    merged, kept = [], []
    for part, said in zip(shaped, told):
        if (merged and merged[-1]["role"] == part["role"] == "bridge"
                and part["to_bar"] - merged[-1]["from_bar"] + 1 <= 16):
            merged[-1]["to_bar"] = part["to_bar"]
            continue
        merged.append(part)
        kept.append(said)
    shaped, told = merged, kept

    for part, said in zip(shaped, told):
        part["nth"] = said["nth"]
        part["like"] = said["like"]
        part["returns"] = said["returns"]

    mood_sure = {}
    felt = CACHE / f"{slug}.mood.json"
    if felt.exists():
        mood_rows, mood_sure = moods(json.loads(felt.read_text()), shaped, pickup)
        if mood_rows:
            for part, row in zip(shaped, mood_rows):
                part["mood"] = row
        report["mood_axes"] = len(mood_sure)

    curve_tells = tells_of(score_bars, shaped, g["first_bar"])

    peak = [t for t in told if t["role"] in ("drop", "chorus")]
    anchor = peak[0]["mark"] if peak else (told[0]["mark"] if told else 0)
    origin = grid_says.get("origin", 1)
    every = grid_says.get("every", 4)
    phrase_rule = {"every_bars": every, "from_bar": origin,
                   "boundaries_on_grid": grid_says.get("on_grid", True)}

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
    inner = sub_phrases(
        [(t["from"], t["to"], t["role"], t["nth"]) for t in told],
        score_bars, told_now, every, origin, pickup)
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
            "lead_from": "htdemucs" if riff else None,
            "melody_from": "harmonic salience" if riff else None,
        },
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
        "groove": swing,
        "melody": tune_notes,
        "melody_phrases": phrases_of(tune_notes, g, g["beats_per_bar"]),
        "mood_axes": mood_sure or None,
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
