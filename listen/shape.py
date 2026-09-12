import numpy as np
import librosa
import scipy.linalg
import scipy.sparse.csgraph
from scipy.ndimage import median_filter
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score

HOP = 512
SR = 22050


def collapse(x, frames, how=np.median):
    out = np.zeros((x.shape[0], len(frames) - 1))
    for i in range(len(frames) - 1):
        a = int(frames[i])
        b = int(max(a + 1, frames[i + 1]))
        piece = x[:, a:b]
        out[:, i] = how(piece, axis=1) if piece.size else 0.0
    return out


def families(path, edges, lanes=None):
    y, _ = librosa.load(path, sr=SR, mono=True)
    frames = librosa.time_to_frames(np.asarray(edges, dtype=float), sr=SR, hop_length=HOP)
    frames = np.clip(frames, 0, None)

    cq = np.abs(librosa.cqt(y=y, sr=SR, hop_length=HOP, bins_per_octave=36, n_bins=36 * 7))
    chroma = librosa.feature.chroma_cqt(C=cq, sr=SR, hop_length=HOP, bins_per_octave=36)
    mfcc = librosa.feature.mfcc(y=y, sr=SR, hop_length=HOP, n_mfcc=20)
    strength = librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP)
    tempogram = librosa.feature.tempogram(onset_envelope=strength, sr=SR,
                                          hop_length=HOP, win_length=192)

    harm = collapse(chroma, frames)
    harm = librosa.util.normalize(harm, norm=2, axis=0)
    tex = collapse(mfcc, frames, how=np.mean)[1:]
    rhy = collapse(tempogram, frames, how=np.mean)
    rhy = librosa.util.normalize(rhy, norm=2, axis=0)

    if lanes is not None:
        inst = np.asarray(lanes, dtype=float)[:, :harm.shape[1]]
        if inst.shape[1] < harm.shape[1]:
            pad = harm.shape[1] - inst.shape[1]
            inst = np.pad(inst, ((0, 0), (0, pad)), mode="edge")
    else:
        inst = np.zeros((1, harm.shape[1]))

    return harm, tex, rhy, inst


def step(x):
    if x.shape[0] == 0 or x.shape[1] < 2:
        return np.zeros(max(0, x.shape[1] - 1))
    d = np.sqrt(((x[:, 1:] - x[:, :-1]) ** 2).sum(axis=0))
    scale = float(np.median(d)) or 1.0
    return d / scale


def affinity(harm, tex, rhy, inst):
    n = harm.shape[1]
    near = int(np.clip(round(n * 0.08), 3, 24))
    rec = librosa.segment.recurrence_matrix(harm, width=3, k=near,
                                            mode="affinity", sym=True)
    rec = librosa.segment.path_enhance(rec, 9)

    d = (step(tex) + step(rhy) + step(inst)) / 3.0
    w = np.exp(-(d ** 2) / 2.0)
    seq = np.diag(w, 1) + np.diag(w, -1)

    heft_rec = float(rec.sum(axis=1).mean()) or 1.0
    heft_seq = float(seq.sum(axis=1).mean()) or 1.0
    mu = heft_seq / (heft_rec + heft_seq)
    return mu * rec + (1.0 - mu) * seq


def embed(a, most=10):
    lap = scipy.sparse.csgraph.laplacian(a, normed=True)
    vals, vecs = scipy.linalg.eigh(lap)
    vecs = median_filter(vecs, size=(9, 1))
    return vecs[:, :most], vals


def switches(lanes, least=4, on=0.55, off=0.35):
    rows = np.asarray(lanes, dtype=float)
    cuts = []
    for row in rows:
        live = np.zeros(len(row), dtype=int)
        state = bool(row[0] > on)
        for i, v in enumerate(row):
            if state and v < off:
                state = False
            elif not state and v > on:
                state = True
            live[i] = int(state)
        for i in range(1, len(live)):
            if live[i] == live[i - 1]:
                continue
            ahead, j = 0, i
            while j < len(live) and live[j] == live[i]:
                ahead += 1
                j += 1
            behind, j = 0, i - 1
            while j >= 0 and live[j] == live[i - 1]:
                behind += 1
                j -= 1
            if ahead >= least and behind >= least:
                cuts.append(i)
    return sorted(set(cuts))


def steps(level, span=4, apart=0.25):
    x = np.asarray(level, dtype=float)
    n = len(x)
    found = []
    for i in range(span, n - span + 1):
        shift = abs(float(np.median(x[i:i + span])) - float(np.median(x[i - span:i])))
        if shift >= apart:
            found.append((i, shift))
    keep = []
    for i, shift in sorted(found, key=lambda p: -p[1]):
        if all(abs(i - j) > span for j in keep):
            keep.append(i)
    return sorted(keep)


def votes(a, low=2, high=10, slack=2):
    vecs, _ = embed(a)
    n = a.shape[0]
    high = int(min(high, max(low, n // 6)))
    tally, tries = {}, 0
    for k in range(low, high + 1):
        x = vecs[:, :k]
        norm = np.linalg.norm(x, axis=1, keepdims=True)
        x = x / np.where(norm > 0, norm, 1.0)
        guess = KMeans(n_clusters=k, n_init=10, random_state=0).fit_predict(x)
        if len(set(guess)) < 2:
            continue
        tries += 1
        for i in range(1, n):
            if guess[i] != guess[i - 1]:
                tally[i] = tally.get(i, 0) + 1
    if not tries:
        return [0, n], tries
    peaks = []
    for i in sorted(tally):
        if not peaks or i - peaks[-1][0] > slack:
            peaks.append([i, tally[i]])
        elif tally[i] > peaks[-1][1]:
            peaks[-1] = [i, tally[i]]
        else:
            peaks[-1][1] = max(peaks[-1][1], tally[i])
    return [(i, hits / max(1, tries)) for i, hits in peaks], tries


def agree(heard, held, turns, slack=3, most=0.60):
    seen = [("vote", i, share) for i, share in heard]
    seen += [("lane", i, 1.0) for i in held]
    seen += [("step", i, 1.0) for i in turns]
    seen.sort(key=lambda row: row[1])

    bins = []
    for kind, i, share in seen:
        if bins and i - bins[-1][0][1] <= slack:
            bins[-1].append((kind, i, share))
        else:
            bins.append([(kind, i, share)])

    cuts = []
    for group in bins:
        kinds = {kind for kind, _, _ in group}
        loud = max(share for kind, _, share in group if kind == "vote") \
            if "vote" in kinds else 0.0
        if len(kinds) < 2 and loud < most:
            continue
        firm = [i for kind, i, _ in group if kind == "lane"] or \
               [i for kind, i, _ in group if kind == "step"] or \
               [i for kind, i, _ in group if kind == "vote"]
        cuts.append(int(firm[0]))
    return [0] + sorted(set(cuts))


def alike(harm, tex, cuts, apart=0.62):
    mids = []
    for i in range(len(cuts) - 1):
        a, b = cuts[i], cuts[i + 1]
        h = harm[:, a:b].mean(axis=1)
        t = tex[:, a:b].mean(axis=1)
        h = h / (np.linalg.norm(h) or 1.0)
        t = t / (np.linalg.norm(t) or 1.0)
        mids.append(np.concatenate([h, t]))
    mids = np.asarray(mids)
    if len(mids) < 2:
        return [0] * len(mids)
    gaps = np.sqrt(((mids[:, None, :] - mids[None, :, :]) ** 2).sum(axis=2))
    scale = float(np.median(gaps[np.triu_indices(len(mids), 1)])) or 1.0
    mark = list(range(len(mids)))
    for i in range(len(mids)):
        for j in range(i):
            if gaps[i, j] / scale < apart:
                mark[i] = mark[j]
                break
    order, seen = {}, 0
    for i, m in enumerate(mark):
        if m not in order:
            order[m] = seen
            seen += 1
        mark[i] = order[m]
    return mark


def runs(mark, least=4):
    spans, i, n = [], 0, len(mark)
    while i < n:
        j = i
        while j < n and mark[j] == mark[i]:
            j += 1
        spans.append([i, j, int(mark[i])])
        i = j
    while True:
        short = [i for i, s in enumerate(spans) if s[1] - s[0] < least]
        if not short or len(spans) < 2:
            break
        i = min(short, key=lambda i: spans[i][1] - spans[i][0])
        if i == 0:
            spans[1][0] = spans[0][0]
            spans.pop(0)
        elif i == len(spans) - 1:
            spans[-2][1] = spans[-1][1]
            spans.pop()
        else:
            before = spans[i - 1][1] - spans[i - 1][0]
            after = spans[i + 1][1] - spans[i + 1][0]
            if before >= after:
                spans[i - 1][1] = spans[i][1]
            else:
                spans[i + 1][0] = spans[i][0]
            spans.pop(i)
        joined = []
        for s in spans:
            if joined and joined[-1][2] == s[2]:
                joined[-1][1] = s[1]
            else:
                joined.append(s)
        spans = joined
    return spans


def shape(path, edges, lanes=None, least=4):
    harm, tex, rhy, inst = families(path, edges, lanes)
    a = affinity(harm, tex, rhy, inst)
    heard, tries = votes(a)
    n = harm.shape[1]
    held, turns = [], []
    if lanes is not None:
        rows = np.asarray(lanes, dtype=float)
        held = [c for c in switches(rows[:4, :n]) if 0 < c < n]
        turns = [c for c in (steps(rows[4, :n]) if rows.shape[0] > 4 else []) if 0 < c < n]
    cuts = agree(heard, held, turns)
    cuts = sorted(set(cuts + [n]))
    spans = [[cuts[i], cuts[i + 1], 0] for i in range(len(cuts) - 1)]
    spans = [s for s in spans if s[1] > s[0]]
    while True:
        short = [i for i, s in enumerate(spans) if s[1] - s[0] < least]
        if not short or len(spans) < 2:
            break
        i = min(short, key=lambda i: spans[i][1] - spans[i][0])
        if i == 0:
            spans[1][0] = spans[0][0]
            spans.pop(0)
        elif i == len(spans) - 1:
            spans[-2][1] = spans[-1][1]
            spans.pop()
        elif spans[i - 1][1] - spans[i - 1][0] >= spans[i + 1][1] - spans[i + 1][0]:
            spans[i - 1][1] = spans[i][1]
            spans.pop(i)
        else:
            spans[i + 1][0] = spans[i][0]
            spans.pop(i)
    cuts = [s[0] for s in spans] + [spans[-1][1]]
    mark = alike(harm, tex, cuts)
    out = [(cuts[i], cuts[i + 1], mark[i]) for i in range(len(cuts) - 1)]
    joined = []
    for a_, b_, c_ in out:
        if joined and joined[-1][2] == c_ and joined[-1][1] == a_:
            joined[-1][1] = b_
        else:
            joined.append([a_, b_, c_])
    return [tuple(s) for s in joined], {"sweeps": tries, "sections": len(joined),
                                        "firm": sorted(set(list(held) + list(turns)))}
