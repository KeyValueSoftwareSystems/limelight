#!/usr/bin/env python3
"""Chords and melody from the mixed recording. Standard library only.

The Nights got both of these from separated stems -- chroma over bass, guitar and
piano, and pitch tracking on the isolated vocal. We do not have stems for Levels,
only the mix, so this does it the harder way and is honest about the cost.

Chords: energy at every semitone from C2 to C7 by Goertzel, folded into twelve
pitch classes, matched against major, minor and dominant-seventh templates, then
median-smoothed across three bars so it states a chord rather than flickering.

Melody: the strongest semitone between 200 and 1200 Hz per sixteenth. In a dense
mix that is usually the lead, but it is NOT a vocal stem and it will follow
whatever is loudest in that band, so the confidence recorded is lower than the
stem-derived version and the field says where it came from.

Validated by running it on The Nights, whose chords were derived independently
from stems, and comparing. That agreement is the only reason to trust the numbers
it produces for Levels.

    python3 listen/harmony.py levels --write
    python3 listen/harmony.py the-nights --validate
"""
import sys, os, json, math, wave, array

HERE = os.path.dirname(os.path.abspath(__file__))
try:
    from mapio import map_path
except ImportError:
    import sys as _s, os as _o
    _s.path.insert(0, _o.path.dirname(_o.path.abspath(__file__)))
    from mapio import map_path

ROOT = os.path.dirname(HERE)
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Major, minor and dominant seventh. Dropping the sevenths was tried and made it
# worse -- root agreement with the stem-derived chords fell from 60% to 33% --
# because that record is largely built on sevenths and a detector without them
# cannot land on the right root.
TEMPLATES = []
for r in range(12):
    TEMPLATES.append((NAMES[r],        [r, (r+4) % 12, (r+7) % 12]))
    TEMPLATES.append((NAMES[r] + "m",  [r, (r+3) % 12, (r+7) % 12]))
    TEMPLATES.append((NAMES[r] + "7",  [r, (r+4) % 12, (r+7) % 12, (r+10) % 12]))


def load(path, target_sr):
    with wave.open(path, "rb") as w:
        sr, n, ch = w.getframerate(), w.getnframes(), w.getnchannels()
        raw = w.readframes(n)
    a = array.array("h")
    a.frombytes(raw[:len(raw) - (len(raw) % 2)])
    if ch > 1:
        a = a[::ch]
    step = max(1, int(round(sr / target_sr)))
    return a[::step], sr / step


def goertzel(sig, i0, n, f, sr):
    """Magnitude at one frequency over one window. O(n), no FFT needed."""
    k = 2.0 * math.cos(2.0 * math.pi * f / sr)
    s1 = s2 = 0.0
    end = min(len(sig), i0 + n)
    for i in range(i0, end):
        s0 = sig[i] + k * s1 - s2
        s2, s1 = s1, s0
    return math.sqrt(abs(s1*s1 + s2*s2 - k*s1*s2))


def chroma_at(sig, sr, t, win_s, lo_midi=36, hi_midi=96):
    """Twelve pitch classes, summed over every octave in range."""
    i0 = int(t * sr)
    n = int(win_s * sr)
    if i0 < 0 or i0 + n >= len(sig):
        return None
    c = [0.0] * 12
    for m in range(lo_midi, hi_midi + 1):
        f = 440.0 * (2.0 ** ((m - 69) / 12.0))
        if f > sr * 0.45:
            break
        c[m % 12] += goertzel(sig, i0, n, f, sr)
    tot = sum(c)
    return [v / tot for v in c] if tot > 0 else None


def best_chord(c):
    best, bv = None, -1.0
    for name, notes in TEMPLATES:
        got = sum(c[p] for p in notes) / len(notes)
        rest = (sum(c) - sum(c[p] for p in notes)) / (12 - len(notes))
        score = got - rest
        if score > bv:
            bv, best = score, name
    return best, bv


def chords(sig, sr, bars, win_s=0.35):
    raw = []
    for i, t in enumerate(bars):
        cs = []
        for frac in (0.15, 0.55):
            c = chroma_at(sig, sr, t + frac * (bars[i+1] - t if i+1 < len(bars) else 1.8), win_s)
            if c: cs.append(c)
        if not cs:
            raw.append(None); continue
        avg = [sum(c[k] for c in cs) / len(cs) for k in range(12)]
        raw.append(best_chord(avg))
    # median smoothing across three bars: a chord that appears once is noise
    out = []
    for i, r in enumerate(raw):
        if r is None:
            continue
        window = [raw[j][0] for j in range(max(0, i-1), min(len(raw), i+2)) if raw[j]]
        # Ties must break the same way every run. max(set(...)) does not: set
        # iteration order over strings depends on hash randomisation, so three runs
        # of this identical code scored 60%, 43% and 27% against the same reference.
        # A validation number that moves between runs is worth nothing. On a tie the
        # bar's own answer wins, and failing that the alphabetically first, so the
        # result is a property of the audio rather than of the process.
        counts = {}
        for w in window: counts[w] = counts.get(w, 0) + 1
        top = max(counts.values())
        tied = sorted(k for k, v in counts.items() if v == top)
        winner = raw[i][0] if raw[i] and raw[i][0] in tied else tied[0]
        conf = window.count(winner) / len(window) * min(1.0, max(0.0, r[1] * 6))
        out.append({"at": round(bars[i], 3), "chord": winner, "confidence": round(conf, 3)})
    return out


def melody(sig, sr, t0, t1, hop, lo_hz=200.0, hi_hz=1200.0, win_s=0.08):
    lo_m = int(round(12 * math.log2(lo_hz / 440.0) + 69))
    hi_m = int(round(12 * math.log2(hi_hz / 440.0) + 69))
    freqs = [(m, 440.0 * (2.0 ** ((m - 69) / 12.0))) for m in range(lo_m, hi_m + 1)]
    notes, t = [], t0
    while t < t1:
        i0 = int(t * sr); n = int(win_s * sr)
        if i0 + n >= len(sig):
            break
        best, bv, tot = None, 0.0, 0.0
        for m, f in freqs:
            v = goertzel(sig, i0, n, f, sr)
            tot += v
            if v > bv:
                bv, best = v, m
        # only keep it when one note clearly stands out of the band
        if best is not None and tot > 0 and bv / tot > 0.10:
            notes.append([round(t, 3), NAMES[best % 12] + str(best // 12 - 1), best])
        else:
            notes.append(None)
        t += hop
    return notes


def run(slug, write=False, validate=False):
    wav = os.path.join(ROOT, "synth", "out", slug + ".wav")
    mp = None
    # maps/model is where the measured maps actually live. These tools only
    # looked in synth/truth and synth/songs, so none of them had ever run on
    # levels, starlight, mizhiyoram or dont-look-down -- including pump.py,
    # which finds the one production element the record is built on.
    for c in ([map_path(slug)] if map_path(slug) else []) + (
              os.path.join(ROOT, "synth", "truth", slug + ".map.json"),
              os.path.join(ROOT, "synth", "songs", slug + ".map.json")):
        if os.path.exists(c):
            mp = c; break
    if not os.path.exists(wav) or not mp:
        print(f"{slug}: no audio or no map"); return
    m = json.load(open(mp))
    beats = m.get("beats") or []
    downs = m.get("downbeats") or beats[::4]
    per = m["grid"]["period"]

    print(f"{slug}: reading audio…", flush=True)
    sig_c, sr_c = load(wav, 5512)          # chords live low; this is plenty
    print(f"  chords over {len(downs)} bars…", flush=True)
    ch = chords(sig_c, sr_c, downs)

    if validate:
        old = ((m.get("observations") or {}).get("chords") or {}).get("events")
        if not old:
            print("  nothing to validate against"); return
        byt = {round(e["at"], 1): e["chord"] for e in old}
        same = root = tot = 0
        for e in ch:
            k = round(e["at"], 1)
            if k not in byt: continue
            tot += 1
            if byt[k] == e["chord"]: same += 1
            if byt[k][0] == e["chord"][0]: root += 1
        print(f"  against the stem-derived chords: {same}/{tot} exact "
              f"({100*same/max(1,tot):.0f}%), {root}/{tot} same root "
              f"({100*root/max(1,tot):.0f}%)")
        return

    sig_m, sr_m = load(wav, 11025)          # melody needs the higher band
    hop = per / 4
    print(f"  melody every {hop:.3f}s…", flush=True)
    mel = melody(sig_m, sr_m, beats[0] if beats else 0.0,
                 m["song"]["length"] - 1.0, hop)
    voiced = sum(1 for x in mel if x)

    obs = m.setdefault("observations", {})
    obs["chords"] = {
        "how": ("Goertzel at every semitone C2-C7 on the MIX, folded to twelve pitch "
                "classes, matched against major/minor/dominant-seventh templates and "
                "median-smoothed across three bars. Not from stems -- we have none for "
                "this song -- so it is weaker than the-nights' chords and the "
                "confidence says so. Checked by running the same code on the-nights, "
                "whose chords came independently from stems: it gets the ROOT right on "
                "50% of bars against a chance rate near 8%, and the exact chord on 23%. "
                "It hears the harmony moving and is unreliable about major versus minor "
                "versus seventh. Use the root; distrust the quality."),
        "rate": "per_bar", "from": "mixed recording, not stems",
        "events": ch,
        "made_by": {"how": "model", "who": "listen/harmony.py",
                    "reproduce": f"python3 listen/harmony.py {slug} --write"},
    }
    obs["melody"] = {
        "how": ("strongest semitone between 200 and 1200 Hz per sixteenth, on the MIX. "
                "In a dense arrangement that is usually the lead, but it follows "
                "whatever is loudest in that band and is not a separated vocal, so it "
                "is less reliable than the-nights' melody."),
        "rate": "per_sixteenth", "of": "mixed recording, not a vocals stem",
        "notes": mel,
        "made_by": {"how": "model", "who": "listen/harmony.py",
                    "reproduce": f"python3 listen/harmony.py {slug} --write"},
    }
    if write:
        json.dump(m, open(mp, "w"), indent=1)
    print(f"  {len(ch)} chords, {voiced} of {len(mel)} sixteenths voiced"
          + (f"  -> {os.path.relpath(mp, ROOT)}" if write else "  (not written)"))
    print("  first chords:", ", ".join(e["chord"] for e in ch[:12]))


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    for s in args:
        run(s, "--write" in sys.argv, "--validate" in sys.argv)
