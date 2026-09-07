#!/usr/bin/env python3
"""The bass line, note by note, from the separated bass stem. Stdlib + ffmpeg.

    python3 listen/stempitch.py levels [--write]

The root the bass is playing is the strongest single statement a record makes
about its harmony, and it is the one thing chroma over a full mix is worst at:
a kick drum lands in the same bins. the-nights got this from the isolated stem
and our four songs had nothing.

Autocorrelation, not FFT. A bass note at 41 Hz has a period of 24 ms, so an FFT
window long enough to resolve it is long enough to smear two notes together.
Autocorrelation finds the period directly and stays sharp.

The band is 38-420 Hz, so lags of 5-58 samples once the signal is decimated to
2205 Hz -- which also makes the search cheap enough to run in Python. A beat with
no clear periodicity gets null rather than the nearest note; an unvoiced beat is
a fact and a guessed one is not (rule 2).
"""
import json, os, subprocess, sys, array, math

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
STEMS = "/tmp/claude-1001/stems/htdemucs_6s"
# Two voices, two bands, two sample rates. A bass note at 41 Hz has a 24 ms
# period and needs a low rate to make the lag search cheap; a sung note at
# 900 Hz has a 1.1 ms period and needs a high one to resolve it at all.
VOICES = {
    "bass":   {"stem": "bass",   "sr": 2205, "lo": 38.0,  "hi": 420.0,  "field": "bass_notes",
               "hi_bass": 200.0},
    "melody": {"stem": "vocals", "sr": 8820, "lo": 80.0,  "hi": 1000.0, "field": "melody",
               "floor": 0.34, "lo_sung": 125.0},
}
SR = 2205
LO_HZ, HI_HZ = 38.0, 420.0
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
CLARITY_FLOOR = 0.34          # peak autocorrelation, normalised. Below it: null.


def stem_path(slug, stem):
    for ext in (".mp3", ".wav"):
        p = os.path.join(STEMS, slug, stem + ext)
        if os.path.exists(p):
            return p
    return None


def decode_mono(path, sr):
    out = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1",
                          "-ar", str(sr), "-f", "s16le", "-"],
                         stdout=subprocess.PIPE, check=True).stdout
    a = array.array("h"); a.frombytes(out)
    return a


def f0(win, sr, lo_hz=None, hi_hz=None):
    """Normalised autocorrelation peak in a band. Returns (hz, clarity)."""
    lo_hz = LO_HZ if lo_hz is None else lo_hz
    hi_hz = HI_HZ if hi_hz is None else hi_hz
    n = len(win)
    mean = sum(win) / n
    x = [v - mean for v in win]
    e0 = sum(v * v for v in x)
    if e0 < 1e-6:
        return None, 0.0
    lo = max(2, int(sr / hi_hz)); hi = min(n - 2, int(sr / lo_hz))
    if hi <= lo:
        return None, 0.0
    best, blag = 0.0, 0
    for lag in range(lo, hi + 1):
        s = 0.0
        for i in range(0, n - lag, 2):        # every other sample: plenty at this rate
            s += x[i] * x[i + lag]
        s *= 2.0
        if s > best:
            best, blag = s, lag
    if not blag:
        return None, 0.0
    clarity = best / e0
    if clarity < CLARITY_FLOOR:
        return None, clarity
    return sr / blag, clarity


def goertzel(x, i0, n, f, sr):
    k = 2.0 * math.cos(2.0 * math.pi * f / sr); s1 = s2 = 0.0
    for i in range(i0, min(len(x), i0 + n)):
        s0 = x[i] + k * s1 - s2; s2, s1 = s1, s0
    return math.sqrt(abs(s1 * s1 + s2 * s2 - k * s1 * s2))


def fix_octave(x, i0, n, hz, sr, hi_hz, lo_sung=None, hi_bass=None):
    """Autocorrelation is honest about the PERIOD and careless about the OCTAVE:
    a sung E4 with a strong second harmonic reads as E3, and a bright E5 can read
    as E6. Measured on Levels, octave-2 notes passed an audio check 15% of the
    time and 69% of them had twice the energy one octave up; on Mizhiyoram the
    same error reached two octaves down.

    Two rules, both from the instrument rather than from a threshold sweep:
      - a sung fundamental lives above about C3. A voice-stem note below that is
        a sub-harmonic almost by definition, so it walks UP until it is in range
        or the energy stops rising -- however many octaves that takes.
      - once in range, the reported octave stands unless a neighbour beats it by
        a clear margin (1.39x), because at that point the estimator is usually
        right and a strong harmonic is not a reason to move.
    Energy is read from the stem itself, same window, so this stays one
    measurement and not a vote between two."""
    def E(f): return goertzel(x, i0, n, f, sr)
    if hi_bass:
        # the mirror image for the bass: a fundamental above about G3 is not a
        # bass note, it is a harmonic the estimator locked onto. Walk DOWN while
        # the octave below carries comparable energy. Against the teammate's
        # basic-pitch bass line (100% in octaves 1-2), ours had 25% in octave 4
        # on Starlight.
        steps = 0
        while hz > hi_bass and hz / 2 >= 30 and steps < 3:
            if E(hz / 2) > E(hz) * 0.9: hz /= 2
            else: break
            steps += 1
    if lo_sung:
        steps = 0
        while hz < lo_sung and hz * 2 <= hi_hz and steps < 4:
            if E(hz * 2) > E(hz) * 0.9: hz *= 2
            else: break
            steps += 1
    cands = [hz / 2, hz, hz * 2]
    best, bhz = -1.0, hz
    for c in cands:
        if c < 30 or c > hi_hz: continue
        e = E(c)
        if c != hz: e *= 0.72
        if e > best: best, bhz = e, c
    return bhz


def name_to_midi(name):
    if not name: return None
    i = len(name)
    while i and (name[i-1].isdigit() or name[i-1] == "-"): i -= 1
    pc, octv = name[:i], name[i:]
    if pc not in NAMES or not octv: return None
    try: return NAMES.index(pc) + (int(octv) + 1) * 12
    except ValueError: return None


def name_of(hz):
    if not hz or hz <= 0:
        return None
    midi = 69 + 12 * math.log(hz / 440.0, 2)
    k = int(round(midi))
    return "%s%d" % (NAMES[k % 12], k // 12 - 1)


try:
    from mapio import map_path
except ImportError:
    import sys as _s, os as _o
    _s.path.insert(0, _o.path.dirname(_o.path.abspath(__file__)))
    from mapio import map_path


def analyse(slug, write=False):
    sp = stem_path(slug, "bass"); mp = map_path(slug)
    if not sp or not mp:
        return {"song": slug, "error": "no bass stem or no map"}
    m = json.load(open(mp))
    beats = m.get("beats") or []
    if len(beats) < 4:
        return {"song": slug, "error": "no beats"}
    x = decode_mono(sp, SR)
    per = (m.get("grid") or {}).get("period") or 0.5
    win = int(SR * min(0.28, per * 0.85))
    notes, clar = [], []
    for b in beats:
        i0 = int(b * SR)
        seg = x[i0:i0 + win]
        if len(seg) < win // 2:
            notes.append(None); clar.append(0.0); continue
        hz, c = f0(seg, SR)
        if hz: hz = fix_octave(x, i0, win, hz, SR, HI_HZ * 1.05, hi_bass=VOICES["bass"]["hi_bass"])
        notes.append(name_of(hz)); clar.append(round(c, 3))
    voiced = sum(1 for v in notes if v)
    obs = {
        "rate": "per_beat",
        "how": "autocorrelation f0 on the %g-%g Hz band of the separated bass stem"
               % (LO_HZ, HI_HZ),
        "unvoiced": "null",
        "not": ("the note the BASS is playing, which is not always the root of the "
                "chord and never the chord itself. A beat whose autocorrelation "
                "peak is below %.2f is null rather than the nearest note"
                % CLARITY_FLOOR),
        "voiced_beats": voiced, "total_beats": len(notes),
        "clarity": clar,
        "notes": notes,
    }
    if write:
        m.setdefault("observations", {})["bass_notes"] = obs
        json.dump(m, open(mp, "w"), indent=1); open(mp, "a").write("\n")
    from collections import Counter
    top = Counter(v[:-1] for v in notes if v).most_common(5)
    return {"song": slug, "voiced": voiced, "beats": len(notes), "top": top,
            "wrote": os.path.relpath(mp, ROOT) if write else None}


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    for slug in (args or ["levels", "starlight", "mizhiyoram", "dont-look-down"]):
        r = analyse(slug, write)
        if "error" in r:
            print("  %-16s %s" % (slug, r["error"])); continue
        print("  %-16s %4d/%4d beats voiced   most played: %s%s"
              % (slug, r["voiced"], r["beats"],
                 " ".join("%s x%d" % t for t in r["top"]),
                 "  -> " + r["wrote"] if r["wrote"] else ""))


def analyse_voice(slug, voice, write=False):
    """The same machinery on a different stem and band. `melody` is the note the
    VOICE is singing, which is what the scorer and the-nights both mean by the
    word; our older observations.melody was a spectral centroid, a different fact
    wearing the same name, and it moves to melody_centroid."""
    V = VOICES[voice]
    sp = stem_path(slug, V["stem"]); mp = map_path(slug)
    if not sp or not mp:
        return {"song": slug, "error": "no %s stem or no map" % V["stem"]}
    m = json.load(open(mp))
    beats = m.get("beats") or []
    if len(beats) < 4:
        return {"song": slug, "error": "no beats"}
    sr = V["sr"]
    x = decode_mono(sp, sr)
    per = (m.get("grid") or {}).get("period") or 0.5
    win = int(sr * min(0.26, per * 0.8))
    notes, clar = [], []
    for b in beats:
        i0 = int(b * sr); seg = x[i0:i0 + win]
        if len(seg) < win // 2:
            notes.append(None); clar.append(0.0); continue
        hz, c = f0(seg, sr, V["lo"], V["hi"])
        if hz and c < V.get("floor", CLARITY_FLOOR): hz = None
        if hz: hz = fix_octave(x, i0, win, hz, sr, V["hi"] * 1.05, lo_sung=V.get("lo_sung"))
        notes.append(name_of(hz)); clar.append(round(c, 3))
    voiced = sum(1 for v in notes if v)
    obs = {
        "rate": "per_beat",
        "how": "autocorrelation f0 on the %g-%g Hz band of the separated %s stem"
               % (V["lo"], V["hi"], V["stem"]),
        "unvoiced": "null",
        "not": ("the note the %s stem is carrying. It is monophonic by construction "
                "and will take the loudest voice where there are several, and a "
                "beat whose autocorrelation peak is below %.2f is null rather than "
                "the nearest note" % (V["stem"], CLARITY_FLOOR)),
        "voiced_beats": voiced, "total_beats": len(notes),
        "clarity": clar, "notes": notes,
    }
    # Note EVENTS, not per-beat samples: consecutive beats on the same pitch are
    # one held note. [start_s, duration_s, midi, name, amplitude] is the format
    # the-nights uses and the one listen/mapeval.py reads, so a note here can be
    # checked by anything in the repo.
    events = []
    i = 0
    while i < len(notes):
        if not notes[i]:
            i += 1; continue
        j = i
        while j + 1 < len(notes) and notes[j + 1] == notes[i]:
            j += 1
        t0 = beats[i]
        t1 = beats[j + 1] if j + 1 < len(beats) else beats[j] + per
        mi = name_to_midi(notes[i])
        amp = max(clar[i:j + 1]) if clar[i:j + 1] else 0.0
        if mi is not None:
            events.append([round(t0, 3), round(max(0.05, t1 - t0), 3), mi,
                           notes[i], round(min(1.0, amp), 3)])
        i = j + 1
    obs["format"] = "[start_s, duration_s, midi, name, amplitude]"
    obs["per_beat"] = obs.pop("notes")
    obs["notes"] = events
    obs["note_events"] = len(events)

    if write:
        o = m.setdefault("observations", {})
        if voice == "melody":
            old = o.get("melody")
            # the centroid is a real measurement, it is just not what `melody`
            # means to anyone else. Keep it, under a name that says what it is.
            if isinstance(old, dict) and "notes" not in old:
                old = dict(old)
                old["renamed_from"] = ("observations.melody. It is a spectral "
                                       "centroid, not a note, and melody now "
                                       "carries the sung note like the-nights "
                                       "and listen/mapeval.py both expect")
                o["melody_centroid"] = old
        o[V["field"]] = obs
        json.dump(m, open(mp, "w"), indent=1); open(mp, "a").write("\n")
    from collections import Counter
    top = Counter(v[:-1] for v in notes if v).most_common(5)
    return {"song": slug, "voiced": voiced, "beats": len(notes), "top": top,
            "wrote": os.path.relpath(mp, ROOT) if write else None}
