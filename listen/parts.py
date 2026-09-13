import warnings

import numpy as np

warnings.filterwarnings("ignore")


def features(path, first_s, bar_s, bars, sr=22050, edges=None):
    if edges is None:
        edges = first_s + np.arange(bars + 1) * bar_s
        if first_s > 0.2:
            edges = np.concatenate([[0.0], edges])
    return features_at(path, np.asarray(edges, dtype=float), sr)


def features_at(path, edges, sr=22050):
    import librosa

    y, _ = librosa.load(path, sr=sr, mono=True)
    edges = np.asarray(edges, dtype=float)
    frames = librosa.time_to_frames(edges, sr=sr, hop_length=512)

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=512, bins_per_octave=36)
    mfcc = librosa.feature.mfcc(y=y, sr=sr, hop_length=512, n_mfcc=13)
    mel = librosa.feature.melspectrogram(y=y, sr=sr, hop_length=512, n_mels=64)
    db = librosa.power_to_db(mel, ref=np.max)
    busy = (db > -38).mean(axis=0, keepdims=True)
    top = librosa.power_to_db(mel[40:], ref=np.max)
    bright = (top > -38).mean(axis=0, keepdims=True)

    n = chroma.shape[1]
    frames = np.clip(frames, 0, n - 1)
    keep = len(frames) - 1

    def cut(data, how):
        got = librosa.util.sync(data, frames, aggregate=how)[:, 1:keep + 1]
        if got.shape[1] < keep:
            pad = np.zeros((got.shape[0], keep - got.shape[1]), dtype=got.dtype)
            got = np.concatenate([got, pad], axis=1)
        return got

    return cut(chroma, np.median), cut(mfcc, np.mean), cut(busy, np.mean), cut(bright, np.mean)


def word_for(rel, rise, has, had):
    beat = has.get("drums", ("none", 0))[0]
    was = had.get("drums", ("none", 0))[0] if had else "none"
    vlevel = has.get("vocals", ("none", 0.0))[1]
    wlevel = had.get("vocals", ("none", 0.0))[1] if had else 0.0
    voice = "full" if vlevel >= SURE else "none"
    wasvoice = "full" if wlevel >= SURE else "none"
    if beat == "none" and was != "none":
        return "drums out"
    if beat == "full" and was != "full":
        return "drums in"
    if beat == "some":
        return "half a kit"
    if voice != "none" and wasvoice == "none":
        return "voice in"
    if voice == "none" and wasvoice != "none":
        return "voice out"
    if beat == "none" and voice != "none":
        return "voice, no drums"
    if beat == "none":
        return "no drums"
    if rel > 0.85:
        return "full"
    if rise > 0.12:
        return "building"
    if rise < -0.12:
        return "thinning"
    if rel < 0.45:
        return "sparse"
    return "steady"


NAMES = ("drums", "bass", "vocals", "other")


SURE = 0.45


def how_much(voices, a, b):
    out = {}
    if voices is None:
        return out
    for i, name in enumerate(NAMES):
        if i >= voices.shape[0]:
            continue
        lane = voices[i]
        floor = float(np.percentile(lane, 10))
        ceiling = float(np.percentile(lane, 90))
        here = float(np.median(lane[a:b])) if b > a else 0.0
        if ceiling - floor < 1e-6:
            out[name] = ("none", 0.0)
            continue
        share = (here - floor) / (ceiling - floor)
        if share < 0.10:
            state = "none"
        elif share < 0.40:
            state = "some"
        else:
            state = "full"
        out[name] = (state, round(max(0.0, min(1.0, share)), 3))
    return out


def curves(path, grid, edges=None):
    bar_s = (60.0 / grid["bpm"]) * grid["beats_per_bar"]
    harmony, colour, busy, bright = features(path, grid["first_beat_s"], bar_s,
                                             grid["bars"], edges=edges)
    return busy, bright
