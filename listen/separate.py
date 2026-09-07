"""Real instrument tracks for a map, from separated stems.

    python3 listen/separate.py <slug> <stem-dir> <map-in> <map-out>

ear.py estimates `stems` by splitting the mix into three frequency bands, and
says so. Those bands are not instruments: on Levels the bass band correlates
0.971 with the song's own energy, so a fixture told to follow the bass is
following the loudness of the record. This reads stems a separator actually
produced and writes the same fields from them, so a reader asking for the voice
gets the voice.

One writer per fact: whatever this emits replaces ear.py's estimate of the same
field, and made_by.note records that it did.

Onsets are NOT backtracked. librosa's backtrack walks each detection back to the
preceding local minimum, which put every kick 36 ms early on Levels and 18 ms
early on Starlight -- a bias in the detector, measured against a grid that did
not come from it. Without it those become -15 ms and +1 ms.
"""
import json, os, sys, math

STEM_NAMES = ("vocals", "drums", "bass", "guitar", "piano", "other")
DRUM_BANDS = (("kick", 20.0, 140.0), ("snare", 140.0, 900.0), ("hat", 4000.0, 12000.0))
ONSET_MIN_GAP = 0.045
HOP = 128


def load(path, sr_target):
    import librosa
    y, sr = librosa.load(path, sr=sr_target, mono=True)
    return y, sr


def envelope_on(y, sr, times, win):
    out = []
    n = len(y)
    for t in times:
        a = max(0, int((t - win * 0.5) * sr))
        b = min(n, int((t + win * 0.5) * sr))
        if b <= a:
            out.append(0.0)
            continue
        acc = 0.0
        for i in range(a, b, 8):
            acc += y[i] * y[i]
        out.append(math.sqrt(acc / max(1, (b - a) / 8)))
    peak = max(out) or 1.0
    return [round(min(1.0, v / peak), 4) for v in out]


def onsets(y, sr, lo=None, hi=None):
    import librosa
    import numpy as np
    if lo is not None or hi is not None:
        S = np.abs(librosa.stft(y, n_fft=2048, hop_length=HOP))
        freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
        keep = np.ones_like(freqs, dtype=bool)
        if lo is not None:
            keep &= freqs >= lo
        if hi is not None:
            keep &= freqs <= hi
        if not keep.any():
            return [], []
        env = librosa.onset.onset_strength(S=librosa.amplitude_to_db(S[keep], ref=np.max), sr=sr, hop_length=HOP)
    else:
        env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)
    if env.size == 0 or float(env.max()) <= 0:
        return [], []
    frames = librosa.onset.onset_detect(onset_envelope=env, sr=sr, hop_length=HOP,
                                        backtrack=False, units="frames")
    times = librosa.frames_to_time(frames, sr=sr, hop_length=HOP)
    strength = env[np.clip(frames, 0, len(env) - 1)]
    peak = float(strength.max()) or 1.0
    keep_t, keep_s = [], []
    last = -1e9
    for t, s in zip(times.tolist(), (strength / peak).tolist()):
        if t - last < ONSET_MIN_GAP:
            continue
        last = t
        keep_t.append(round(float(t), 3))
        keep_s.append(round(float(s), 3))
    return keep_t, keep_s


def main():
    if len(sys.argv) < 5:
        print(__doc__)
        return 2
    slug, stem_dir, map_in, map_out = sys.argv[1:5]
    m = json.load(open(map_in))
    curve = m.get("energy") or []
    times = [t for t, _ in curve]
    if not times:
        print("no energy grid to hang stems on", file=sys.stderr)
        return 1
    bar = (m.get("grid") or {}).get("period", 0.5) * 4

    found = {}
    for name in STEM_NAMES:
        for ext in (".mp3", ".wav"):
            p = os.path.join(stem_dir, slug, name + ext)
            if os.path.exists(p):
                found[name] = p
                break
    if not found:
        print("no stems under " + os.path.join(stem_dir, slug), file=sys.stderr)
        return 1

    sr = 22050
    sources, acc = {}, []
    for name, path in found.items():
        y, s = load(path, sr)
        sources[name] = envelope_on(y, s, times, bar)
        if name == "drums":
            for label, lo, hi in DRUM_BANDS:
                ts, st = onsets(y, s, lo, hi)
                for t, v in zip(ts, st):
                    acc.append({"at": t, "of": label, "strength": v})
        else:
            ts, st = onsets(y, s)
            for t, v in zip(ts, st):
                acc.append({"at": t, "of": name, "strength": v})
    acc.sort(key=lambda a: a["at"])

    m["stems"] = {
        "model": "htdemucs_6s",
        "rate": "per_downbeat",
        "note": "RMS of each separated stem over one bar, normalised per stem",
        "sources": sources,
    }
    m["accents"] = {
        "of": sorted({a["of"] for a in acc}),
        "how": "librosa onset detection per separated stem; the drum stem is split "
               "into kick, snare and hat bands before detection",
        "note": "the instrument label is now the stem a separator assigned it to, "
                "not a guess from the mix",
        "events": acc,
    }
    mb = dict(m.get("made_by") or {})
    note = str(mb.get("note", "")).split(" | stems and accents")[0]
    mb["note"] = (note + " | stems and accents from htdemucs_6s separation, "
                         "replacing the band-split estimate").strip(" |")
    m["made_by"] = mb
    json.dump(m, open(map_out, "w"))
    print("%-16s %d stems, %d accents over %s"
          % (slug, len(sources), len(acc), ", ".join(sorted(sources))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
