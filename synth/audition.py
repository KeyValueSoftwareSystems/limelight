#!/usr/bin/env python3
"""Hear what the map claims, against the record. Standard library only.

Every chord and melody number in this project has been checked against another
program's guess, and two uncertain methods agreeing 50% of the time proves
nothing about either. There is one reliable judge available and it is Renjith's
ear -- the same one that settled the beat grid and the bar phase when two maps
disagreed.

So this renders an audio file: the song, quieted, with the map's own reading
played over it. If the map says the bar is C# minor, you hear a C# minor triad
across that bar. If it is wrong you hear it clash immediately, which no
correlation against another model can tell you.

Writes OUTSIDE the repo, because audio never goes in the repo.

    python3 synth/audition.py levels chords
    python3 synth/audition.py levels melody --from 60 --for 45
"""
import sys, os, json, math, wave, array

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.environ.get("AUDITION_DIR", "/tmp/claude-1001")
NOTES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]


def midi_hz(m): return 440.0 * (2.0 ** ((m - 69) / 12.0))


def chord_midis(label, octave=4):
    root = label[0] + ("#" if len(label) > 1 and label[1] == "#" else "")
    if root not in NOTES: return []
    r = NOTES.index(root) + 12 * (octave + 1)
    suffix = label[len(root):]
    third = 3 if suffix.startswith("m") and not suffix.startswith("maj") else 4
    out = [r, r + third, r + 7]
    if suffix.endswith("7"): out.append(r + 10)
    return out


def render(slug, what, t0, dur, song_gain=0.30, tone_gain=0.16):
    wav = os.path.join(ROOT, "synth", "out", slug + ".wav")
    m = json.load(open(os.path.join(ROOT, "synth", "truth", slug + ".map.json")))
    with wave.open(wav, "rb") as w:
        sr, n, ch = w.getframerate(), w.getnframes(), w.getnchannels()
        raw = w.readframes(n)
    a = array.array("h"); a.frombytes(raw[: len(raw) - (len(raw) % 2)])
    if ch > 1: a = a[::ch]

    i0, i1 = int(t0 * sr), int(min(len(a), (t0 + dur) * sr))
    out = array.array("h", [0]) * (i1 - i0)
    for i in range(i1 - i0):
        out[i] = int(a[i0 + i] * song_gain)

    obs = m.get("observations", {})
    events = []
    if what == "chords":
        for e in (obs.get("chords") or {}).get("events", []):
            events.append((e["at"], chord_midis(e["chord"]), e.get("confidence", 0)))
    else:
        for e in (obs.get("melody") or {}).get("notes", []):
            if e: events.append((e[0], [e[2]], 1.0))
    events = [e for e in events if t0 - 2 <= e[0] < t0 + dur]
    if not events:
        print("nothing in that window"); return None

    # each event sounds until the next one, with a short fade so it does not click
    for k, (at, midis, conf) in enumerate(events):
        end = events[k + 1][0] if k + 1 < len(events) else at + 2.0
        s = max(i0, int(at * sr)); e = min(i1, int(end * sr))
        if e <= s: continue
        fade = min(int(0.02 * sr), (e - s) // 4)
        for mi in midis:
            f = midi_hz(mi); wstep = 2 * math.pi * f / sr
            amp = tone_gain * 32767 / max(1, len(midis))
            for i in range(s, e):
                env = 1.0
                if i - s < fade: env = (i - s) / fade
                elif e - i < fade: env = (e - i) / fade
                j = i - i0
                if 0 <= j < len(out):
                    v = out[j] + int(amp * env * math.sin(wstep * (i - s)))
                    out[j] = max(-32768, min(32767, v))

    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"{slug}.{what}.audition.wav")
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(out.tobytes())
    print(f"  {len(events)} events sounded over {dur:.0f}s from {t0:.0f}s")
    if what == "chords":
        print("  what you hear:", ", ".join(
            f"{NOTES[c[0]%12]}{'m' if len(c)>1 and c[1]-c[0]==3 else ''}"
            for _, c, _ in events[:10] if c))
    print(f"  -> {path}")
    return path


if __name__ == "__main__":
    slug = sys.argv[1]; what = sys.argv[2] if len(sys.argv) > 2 else "chords"
    t0 = float(sys.argv[sys.argv.index("--from") + 1]) if "--from" in sys.argv else 30.0
    dur = float(sys.argv[sys.argv.index("--for") + 1]) if "--for" in sys.argv else 30.0
    render(slug, what, t0, dur)
