#!/usr/bin/env python3
import argparse, json, math, os, subprocess, sys, wave, array


def tone(sr, secs, freq, amp):
    n = int(sr * secs)
    return [int(amp * 32767 * math.sin(2 * math.pi * freq * i / sr)
                * math.exp(-6.0 * i / n)) for i in range(n)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("score")
    ap.add_argument("wav")
    ap.add_argument("--from", dest="frm", type=float, default=0.0)
    ap.add_argument("--secs", type=float, default=0.0)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    g = json.load(open(a.score))["grid"]
    bpm, first, bpb = g["bpm"], g["first_beat_s"], g.get("beats_per_bar", 4)
    beat_s = 60.0 / bpm

    with wave.open(a.wav, "rb") as w:
        sr, n, ch = w.getframerate(), w.getnframes(), w.getnchannels()
        raw = w.readframes(n)
    buf = array.array("h"); buf.frombytes(raw[:len(raw) - (len(raw) % 2)])
    if ch > 1:
        buf = buf[::ch]

    lo = int(a.frm * sr)
    hi = len(buf) if a.secs <= 0 else min(len(buf), lo + int(a.secs * sr))
    seg = array.array("h", buf[lo:hi])
    for i in range(len(seg)):          # duck the music so the clicks sit on top
        seg[i] = int(seg[i] * 0.55)

    beat = tone(sr, 0.030, 1800.0, 0.55)
    down = tone(sr, 0.045, 900.0, 0.80)

    end = a.frm + (len(seg) / sr)
    k = max(0, int((a.frm - first) / beat_s))
    placed = 0
    while True:
        t = first + k * beat_s
        if t >= end:
            break
        if t >= a.frm:
            click = down if k % bpb == 0 else beat
            at = int((t - a.frm) * sr)
            for j, v in enumerate(click):
                if 0 <= at + j < len(seg):
                    seg[at + j] = max(-32768, min(32767, seg[at + j] + v))
            placed += 1
        k += 1

    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    tmp = a.out + ".wav"
    with wave.open(tmp, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(seg.tobytes())
    subprocess.run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", tmp,
                    "-c:a", "libmp3lame", "-q:a", "4", a.out], check=False)
    os.remove(tmp)
    print(f"  {bpm} bpm, bar of {bpb}, {placed} clicks derived from 3 numbers -> {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
