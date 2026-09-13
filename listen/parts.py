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


def smooth(v, k=3):
    import scipy.signal

    if v.shape[1] < k:
        return v
    return scipy.signal.medfilt(v, kernel_size=(1, k))


def stack(harmony, colour, busy, voices=None):
    h = harmony / (np.linalg.norm(harmony, axis=0, keepdims=True) + 1e-9)
    c = colour[1:]
    c = (c - c.mean(axis=1, keepdims=True)) / (c.std(axis=1, keepdims=True) + 1e-9)
    b = smooth(busy)
    f = (b - b.mean()) / (b.std() + 1e-9)
    rows = [h * 1.0, c * 0.4, f * 1.6]
    if voices is not None and len(voices):
        v = smooth(np.asarray(voices, dtype=float))
        v = (v - v.mean(axis=1, keepdims=True)) / (v.std(axis=1, keepdims=True) + 1e-9)
        rows.append(v * 2.0)
    return np.vstack(rows)


def hush(busy, deep=0.35):
    v = np.asarray(busy, dtype=float).ravel()
    n = len(v)
    out = np.zeros(n)
    for i in range(2, n):
        before = v[max(0, i - 3):i - 1]
        if not len(before):
            continue
        dip = min(before.max(), v[i]) - v[i - 1]
        if dip > deep:
            out[i] = dip
    return out


def novelty(f, w=4):
    n = f.shape[1]
    out = np.zeros(n)
    for i in range(n):
        before = f[:, max(0, i - w):i]
        after = f[:, i:min(n, i + w)]
        if before.shape[1] < 2 or after.shape[1] < 2:
            continue
        out[i] = np.linalg.norm(before.mean(axis=1) - after.mean(axis=1))
    return out


def breaks(nov, phrase=4, least=4, origin=0):
    import librosa

    n = len(nov)
    if n < least * 2:
        return [0, n]
    v = nov / (nov.max() or 1.0)
    peaks = librosa.util.peak_pick(v, pre_max=4, post_max=4, pre_avg=12, post_avg=12,
                                   delta=0.10, wait=least)
    snapped = []
    for p in peaks:
        if not (least <= p <= n - least):
            continue
        near = origin + int(round((p - origin) / phrase) * phrase)
        snapped.append(near if abs(near - p) <= phrase // 2 and least <= near <= n - least else int(p))
    cuts = [0]
    for c in sorted(set(snapped)):
        if c - cuts[-1] >= least:
            cuts.append(c)
    if n - cuts[-1] < least and len(cuts) > 1:
        cuts.pop()
    cuts.append(n)
    return cuts


def letters(cuts, harmony, colour):
    import sklearn.cluster
    import sklearn.metrics

    rows = []
    for i in range(len(cuts) - 1):
        a, b = cuts[i], cuts[i + 1]
        h = harmony[:, a:b].mean(axis=1)
        h = h / (np.linalg.norm(h) + 1e-9)
        c = colour[1:, a:b].mean(axis=1)
        c = c / (np.linalg.norm(c) + 1e-9)
        rows.append(np.concatenate([h, c * 0.5]))
    x = np.vstack(rows)
    if len(x) < 4:
        return list(range(len(x)))
    best, pick = -2.0, list(range(len(x)))
    for k in range(2, min(6, len(x))):
        got = sklearn.cluster.AgglomerativeClustering(n_clusters=k, linkage="average").fit_predict(x)
        if len(set(got)) < 2:
            continue
        s = sklearn.metrics.silhouette_score(x, got)
        if s > best:
            best, pick = s, list(got)
    return pick


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


def split(v):
    v = np.asarray(v, dtype=float)
    lo, hi = v.min(), v.max()
    if hi - lo < 1e-6:
        return hi + 1.0
    mid = (lo + hi) / 2
    for _ in range(30):
        a, b = v[v <= mid], v[v > mid]
        if not len(a) or not len(b):
            break
        nxt = (a.mean() + b.mean()) / 2
        if abs(nxt - mid) < 1e-9:
            break
        mid = nxt
    return mid


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


def playing_in(voices, a, b):
    return [n for n, (state, _) in how_much(voices, a, b).items() if state != "none"]


def shape(cuts, labels, busy, voices=None):
    v = np.nan_to_num(np.asarray(busy[0], dtype=float), nan=0.0, posinf=0.0, neginf=0.0)
    peak = float(v.max()) if v.size else 0.0
    if not np.isfinite(peak) or peak == 0.0:
        peak = 1.0
    out = []
    order, seen = {}, 0
    had = {}
    for i in range(len(cuts) - 1):
        a, b = cuts[i], cuts[i + 1]
        part = v[a:b]
        if not len(part):
            continue
        rel = float(part.mean() / peak)
        third = max(1, len(part) // 3)
        rise = float((part[-third:].mean() - part[:third].mean()) / peak)
        has = how_much(voices, a, b)
        word = word_for(rel, rise, has, had)
        had = has
        lab = labels[i]
        if lab not in order:
            order[lab] = seen
            seen += 1
        out.append((a, b, order[lab], word, round(rel, 3), round(rise, 3)))
    return out


def curves(path, grid, edges=None):
    bar_s = (60.0 / grid["bpm"]) * grid["beats_per_bar"]
    harmony, colour, busy, bright = features(path, grid["first_beat_s"], bar_s,
                                             grid["bars"], edges=edges)
    return busy, bright


def call_it(levels):
    d = levels.get("drums", 0) > 0.15
    b = levels.get("bass", 0) > 0.15
    v = levels.get("vocals", 0) >= SURE
    o = levels.get("other", 0) > 0.15
    if d and v:
        return "voice + beat"
    if d and b:
        return "beat"
    if d:
        return "drums"
    if v and o:
        return "voice + chords"
    if v:
        return "voice"
    if b and o:
        return "bass + chords"
    if o:
        return "chords"
    return "quiet"


def name_groups(shaped, voices):
    seen = {}
    for a, b, lab, *_ in shaped:
        seen.setdefault(lab, []).append((a, b))
    names, used = {}, {}
    for lab in sorted(seen, key=lambda k: seen[k][0][0]):
        levels = {}
        for i, name in enumerate(NAMES):
            if voices is None or i >= voices.shape[0]:
                continue
            vals = [np.median(voices[i, a:b]) for a, b in seen[lab] if b > a]
            levels[name] = float(np.median(vals)) if vals else 0.0
        base = call_it(levels)
        used[base] = used.get(base, 0) + 1
        names[lab] = base if used[base] == 1 else f"{base} {used[base]}"
    return names


def roles(shaped, voices, busy):
    v = busy[0] if busy.ndim > 1 else busy
    peak = np.percentile(v, 98) or 1.0
    low = None
    if voices is not None and voices.shape[0] > 1:
        low = voices[1]
        low = low / (np.percentile(low, 98) or 1.0)

    told = []
    for a, b, *_ in shaped:
        full = float(np.median(v[a:b]) / peak) if b > a else 0.0
        deep = float(np.median(low[a:b])) if low is not None and b > a else 0.0
        told.append({"full": full, "deep": deep, "bars": b - a, "a": a, "b": b})

    heavy = max((t["deep"] for t in told), default=0.0)
    peaks = [i for i, t in enumerate(told)
             if t["deep"] > heavy * 0.8 and t["full"] > 0.7 and t["bars"] >= 4]

    out = []
    for i, t in enumerate(told):
        role = None
        if t["full"] < 0.25 and t["bars"] <= 2:
            role = "gap"
        elif i in peaks:
            role = "drop"
        elif peaks and i == min(peaks) - 1 and t["deep"] < heavy * 0.6 and t["full"] > 0.45:
            role = "build"
        elif peaks and i + 1 in peaks and t["deep"] < heavy * 0.6 and t["full"] > 0.45:
            role = "build"
        elif not peaks and i == 0:
            role = "intro"
        elif peaks and i < min(peaks) and i == 0:
            role = "intro"
        elif peaks and i < min(peaks):
            role = "verse"
        elif peaks and i > max(peaks):
            role = "outro" if i == len(told) - 1 else "breakdown"
        elif peaks and t["deep"] < heavy * 0.5:
            role = "breakdown"
        elif peaks:
            role = "anthem"
        out.append(role)

    if peaks:
        seen = 0
        for i, role in enumerate(out):
            if role == "drop":
                seen += 1
                out[i] = f"drop {seen}" if seen > 1 else "drop"
    return out


def parts(path, grid, report=None, voices=None):
    bar_s = (60.0 / grid["bpm"]) * grid["beats_per_bar"]
    harmony, colour, busy, bright = features(path, grid["first_beat_s"], bar_s, grid["bars"])
    pickup = 1 if grid["first_beat_s"] > 0.2 else 0
    n = harmony.shape[1]
    if voices is not None:
        voices = np.asarray(voices, dtype=float)[:, :n]
    nov = novelty(stack(harmony, colour, busy, voices))
    nov = nov / (nov.std() or 1.0) + hush(busy / (busy.max() or 1.0)) * 3.0
    cuts = breaks(nov, origin=pickup)
    shaped = shape(cuts, letters(cuts, harmony, colour), busy, voices)
    if report is not None:
        report["parts"] = len(shaped)
        report["kinds"] = sorted({s[3] for s in shaped})
    named = name_groups(shaped, voices)
    told = roles(shaped, voices, busy)
    out = []
    for n, (a, b, lab, word, rel, rise) in enumerate(shaped):
        one = {"from_bar": a + 1 - pickup, "to_bar": b - pickup,
               "repeats_as": named.get(lab, chr(65 + lab % 26)),
               "role": told[n] if n < len(told) else None,
               "feels": word, "fullness": rel, "rise": rise}
        if voices is not None:
            much = how_much(voices, a, b)
            one["playing"] = [n for n, (st, _) in much.items() if st != "none"]
            one["stems"] = {
                n: {"is": st, "sits": lv,
                    "level": round(float(np.mean(voices[i][a:b])), 3)
                    if b > a and i < voices.shape[0] else 0.0}
                for i, (n, (st, lv)) in enumerate(much.items())}
        out.append(one)
    return out
