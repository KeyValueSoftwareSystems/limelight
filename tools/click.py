#!/usr/bin/env python3
"""The song with a click on every beat, so a person can hear if the grid is right.

    python3 tools/click.py holocene [--from 60 --secs 20]

WHY. Four ways of testing a beat grid were written in one night and all four
were confidently wrong -- one locked onto the bar, one rewarded sparsity, one
rewarded density, and the fourth rejected a correct grid because it assumed
off-beats are quiet in every genre. Each was graded against another
measurement, never against a person.

A tempo octave error is audible in two seconds. This makes the map's own grid
audible, so the check is a human ear and not more arithmetic. The verdict goes
in truth/, and THAT is what the detector gets graded against.

Beats get a short high click; downbeats get a lower, louder one, so a wrong
bar phase is audible too, not just a wrong tempo.
"""
import argparse, json, os, sys, math, wave, array, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "listen"))
from mapio import map_path


def tone(sr, secs, freq, amp):
    n = int(sr * secs)
    return [int(amp * 32767 * math.sin(2 * math.pi * freq * i / sr)
                * math.exp(-6.0 * i / n)) for i in range(n)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("--from", dest="frm", type=float, default=0.0)
    ap.add_argument("--secs", type=float, default=0.0, help="0 = whole song")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()

    p = map_path(a.slug)
    wav = os.path.join(ROOT, "synth", "out", a.slug + ".wav")
    if not p or not os.path.exists(wav):
        print("no map or no audio for " + a.slug, file=sys.stderr); return 2
    m = json.load(open(p))

    with wave.open(wav, "rb") as w:
        sr, n, ch = w.getframerate(), w.getnframes(), w.getnchannels()
        raw = w.readframes(n)
    buf = array.array("h"); buf.frombytes(raw[:len(raw) - (len(raw) % 2)])
    if ch > 1: buf = buf[::ch]

    lo = int(a.frm * sr)
    hi = len(buf) if a.secs <= 0 else min(len(buf), lo + int(a.secs * sr))
    seg = array.array("h", buf[lo:hi])
    # Duck the music a little so the clicks sit on top of it.
    for i in range(len(seg)):
        seg[i] = int(seg[i] * 0.55)

    beat = tone(sr, 0.030, 1800.0, 0.55)
    down = tone(sr, 0.045, 900.0, 0.80)
    downs = set(round(t, 3) for t in (m.get("downbeats") or []))

    placed = 0
    for t in (m.get("beats") or []):
        if t < a.frm or (a.secs > 0 and t > a.frm + a.secs):
            continue
        click = down if round(t, 3) in downs else beat
        at = int((t - a.frm) * sr)
        for j, v in enumerate(click):
            k = at + j
            if 0 <= k < len(seg):
                seg[k] = max(-32768, min(32767, seg[k] + v))
        placed += 1

    out = a.out or os.path.join(ROOT, "renders", "click", a.slug + ".mp3")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    tmp = out + ".wav"
    with wave.open(tmp, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(seg.tobytes())
    subprocess.run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", tmp,
                    "-c:a", "libmp3lame", "-q:a", "4", out], check=False)
    os.remove(tmp)
    g = m.get("grid") or {}
    print(f"  {a.slug}: {g.get('bpm')} bpm, {placed} clicks -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
