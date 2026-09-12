import warnings

from pathlib import Path

import numpy as np

warnings.filterwarnings("ignore")

HOP = 2048
SR = 44100


CACHE = Path("work/heard")


def chords(path, slug=None):
    if slug:
        at = CACHE / f"{slug}.chords.npz"
        if at.exists():
            z = np.load(at, allow_pickle=True)
            return [str(x) for x in z["found"]], z["strength"]
    import essentia
    import essentia.standard as es

    audio = es.MonoLoader(filename=path, sampleRate=SR)()
    window = es.Windowing(type="blackmanharris62")
    spectrum = es.Spectrum()
    peaks = es.SpectralPeaks(orderBy="magnitude", magnitudeThreshold=1e-5,
                             minFrequency=40, maxFrequency=5000, maxPeaks=100)
    profile = es.HPCP(size=12)

    frames = []
    for frame in es.FrameGenerator(audio, frameSize=4096, hopSize=HOP, startFromZero=True):
        f, m = peaks(spectrum(window(frame)))
        frames.append(profile(f, m))

    found, strength = es.ChordsDetection(hopSize=HOP, sampleRate=SR)(essentia.array(frames))
    found = [str(x) for x in found]
    strength = np.asarray(strength, dtype=float)
    if slug:
        at.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(at, found=np.array(found, dtype=object), strength=strength)
    return found, strength


def per_bar(found, strength, first_s, bar_s, bars, pickup):
    step = HOP / SR
    spans = []
    if pickup:
        spans.append((0.0, first_s))
    spans += [(first_s + b * bar_s, first_s + (b + 1) * bar_s) for b in range(bars)]

    out, sure = [], []
    for lo, hi in spans:
        a, b = int(lo / step), int(hi / step)
        window = found[max(0, a):max(0, b)]
        if not window:
            out.append(None)
            sure.append(0.0)
            continue
        names, counts = np.unique(window, return_counts=True)
        pick = str(names[counts.argmax()])
        out.append(pick)
        held = [strength[i] for i in range(max(0, a), min(len(strength), b)) if found[i] == pick]
        sure.append(round(float(np.mean(held)) if held else 0.0, 3))
    return out, sure


def changes(per, pickup):
    out = []
    for i in range(1, len(per)):
        if per[i] and per[i - 1] and per[i] != per[i - 1]:
            out.append({"bar": max(0, i), "beat": 1,
                        "is": f"chord to {per[i]}", "strength": 0.4})
    return out
