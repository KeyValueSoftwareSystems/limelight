#!/usr/bin/env python3
"""Render a synthetic map to audio, then prove the audio matches the map.

    python3 synth/render.py                    # every case in synth/cases/
    python3 synth/render.py synth/cases/01-metronome.json

Writes a 48 kHz mono WAV next to the case in synth/out/. The WAV is NOT committed
-- it regenerates in under a second, and the repo holds scores, never songs.

The self-check matters more than the rendering. If this file places a kick 5 ms
away from where the map declares it, the ground truth is corrupt and every
accuracy number measured against it afterwards is a confident lie. So after
rendering, every authored event is located again in the rendered signal by a
method that shares nothing with the listener under test: a click in near-silence
has an unambiguous onset, so peak-picking the energy derivative is enough, and
disagreement means the renderer is wrong.
"""
import json, math, os, struct, sys, wave

SR = 48000

def _env(n, tau):
    return [math.exp(-i / (tau * SR)) for i in range(n)]

def kick(sr=SR):
    """Pitch sweep 90 -> 45 Hz. The sweep is what makes it read as a kick rather
    than a low beep, and the sharp front edge is what an onset detector sees."""
    n, ph, out = int(0.14 * sr), 0.0, []
    for i, e in enumerate(_env(n, 0.045)):
        f = 90.0 - 45.0 * (i / n) ** 0.55
        ph += 2 * math.pi * f / sr
        out.append(math.sin(ph) * e)
    return out

def hat(sr=SR):
    """Highpassed noise. Deterministic LCG rather than random, so two runs of this
    file produce byte-identical audio and a diff means something changed."""
    n, s, prev, out = int(0.045 * sr), 12345, 0.0, []
    for e in _env(n, 0.010):
        s = (1103515245 * s + 12345) & 0x7FFFFFFF
        x = (s / 0x3FFFFFFF) - 1.0
        hp = x - prev; prev = x
        out.append(hp * e * 0.6)
    return out

def click(sr=SR):
    n, out = int(0.012 * sr), []
    for i, e in enumerate(_env(n, 0.003)):
        out.append(math.sin(2 * math.pi * 2000.0 * i / sr) * e)
    return out

VOICES = {"kick": kick(), "hat": hat(), "click": click()}

def render(case):
    sr = case["render"].get("sample_rate", SR)
    buf = [0.0] * (int(case["song"]["length"] * sr) + sr)
    for ev in case["render"]["events"]:
        v = VOICES[ev["voice"]]; g = ev["gain"]; at = int(ev["at"] * sr)
        for i, s in enumerate(v):
            if at + i < len(buf): buf[at + i] += s * g
    peak = max(1e-9, max(abs(x) for x in buf))
    return [x / peak * 0.89 for x in buf], sr

def envelope(buf, sr):
    hop = max(1, sr // 1000)
    return [max((abs(x) for x in buf[i:i + hop]), default=0.0)
            for i in range(0, len(buf) - hop, hop)], hop


def verify(case, buf, sr, window_ms=10.0, tol_ms=2.0, floor=0.008):
    """Locate every authored event in the rendered signal, one event at a time.

    A single global threshold cannot work here: case 04 deliberately mixes
    full-scale kicks with hats a sixth as loud, and one threshold either misses
    the hats or fires twice on the kicks. So each authored time is checked in its
    own +/- 10 ms window against its own local noise floor. The 2 ms timing
    tolerance is the part that must never move -- detection sensitivity is a
    property of this checker, placement accuracy is a property of the renderer,
    and only the second one is under test.
    """
    en, hop = envelope(buf, sr)
    per_s = sr / hop                      # envelope samples per second
    w = max(1, int(window_ms / 1000.0 * per_s))
    want = sorted({round(e["at"], 4) for e in case["render"]["events"]})
    errs, missed, claimed = [], [], set()
    for t in want:
        c = int(t * per_s)
        lo, hi = max(1, c - w), min(len(en) - 1, c + w)
        best, best_rise = None, 0.0
        for i in range(lo, hi):
            rise = en[i] - en[i - 1]
            if rise > best_rise: best, best_rise = i, rise
        if best is None or best_rise < floor:
            missed.append(t); continue
        errs.append(abs(best / per_s - t) * 1000.0)
        claimed.add(best)
    # An event OCCUPIES a span, it is not an instant. A decaying 60 Hz kick has an
    # envelope that ripples at 60 Hz, so its own tail reads as fresh onsets unless
    # the whole note is treated as accounted for. An extra is therefore sound the
    # renderer put somewhere no authored event reaches.
    spans = [(e["at"], e["at"] + len(VOICES[e["voice"]]) / sr + window_ms / 1000.0)
             for e in case["render"]["events"]]
    extra = 0
    for i in range(1, len(en)):
        if en[i] - en[i - 1] > floor:
            t_i = i / per_s
            if not any(a - window_ms / 1000.0 <= t_i <= b for a, b in spans): extra += 1
    return {"events": len(want), "located": len(errs), "missed": len(missed),
            "missed_at": missed[:4],
            "max_err_ms": round(max(errs), 3) if errs else None,
            "mean_err_ms": round(sum(errs) / len(errs), 3) if errs else None,
            "extra": extra, "tol_ms": tol_ms}


def write_wav(path, buf, sr):
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, x)) * 32767)) for x in buf))

def main(argv):
    here = os.path.dirname(os.path.abspath(__file__))
    paths = argv[1:] or sorted(os.path.join(here, "cases", f)
                               for f in os.listdir(os.path.join(here, "cases")) if f.endswith(".json"))
    os.makedirs(os.path.join(here, "out"), exist_ok=True)
    bad = 0
    for p in paths:
        case = json.load(open(p))
        buf, sr = render(case)
        out = os.path.join(here, "out", os.path.basename(p).replace(".json", ".wav"))
        write_wav(out, buf, sr)
        v = verify(case, buf, sr)
        ok = v["missed"] == 0 and v["extra"] == 0 and (v["max_err_ms"] or 0) <= v["tol_ms"]
        if not ok: bad += 1
        print(f"  {os.path.basename(p):22s} {case['song']['length']:6.1f} s  "
              f"{v['located']}/{v['events']} events located   "
              f"max {str(v['max_err_ms']):>5} ms  mean {str(v['mean_err_ms']):>5} ms   "
              f"{'OK' if ok else 'RENDERER WRONG'}")
    print(f"\n  {'all renders match their maps' if not bad else str(bad) + ' CASE(S) CORRUPT -- do not measure against these'}")
    return 1 if bad else 0

if __name__ == "__main__":
    sys.exit(main(sys.argv))
