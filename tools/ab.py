import argparse
import array
import json
import math
import os
import subprocess
import sys
import wave


def tone(sr, secs, freq, amp):
    n = int(sr * secs)
    return [int(amp * 32767 * math.sin(2 * math.pi * freq * i / sr) * math.exp(-9.0 * i / n))
            for i in range(n)]


def read(path):
    with wave.open(path, "rb") as w:
        sr, n, ch = w.getframerate(), w.getnframes(), w.getnchannels()
        raw = w.readframes(n)
    buf = array.array("h")
    buf.frombytes(raw[: len(raw) - (len(raw) % 2)])
    if ch > 1:
        buf = buf[::ch]
    return buf, sr


def render(seg, sr, grid, frm, shift, out, gain):
    step = 60.0 / grid["bpm"]
    first, bpb = grid["first_beat_s"], grid["beats_per_bar"]
    mix = array.array("h", [int(v * gain) for v in seg])
    beat, down = tone(sr, 0.028, 2000.0, 0.55), tone(sr, 0.042, 1000.0, 0.8)
    end = frm + len(seg) / sr
    k = max(0, int((frm - first) / step))
    placed = 0
    while True:
        t = first + k * step + shift
        if t >= end:
            break
        if t >= frm:
            click = down if k % bpb == 0 else beat
            at = int((t - frm) * sr)
            for j, v in enumerate(click):
                if 0 <= at + j < len(mix):
                    mix[at + j] = max(-32768, min(32767, mix[at + j] + v))
            placed += 1
        k += 1
    tmp = out + ".tmp.wav"
    with wave.open(tmp, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(mix.tobytes())
    subprocess.run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", tmp,
                    "-c:a", "libmp3lame", "-q:a", "3", out], check=True)
    os.remove(tmp)
    return placed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("score")
    ap.add_argument("wav")
    ap.add_argument("--from", dest="frm", type=float, required=True)
    ap.add_argument("--secs", type=float, default=20.0)
    ap.add_argument("--outdir", default="renders/ab")
    ap.add_argument("--gain", type=float, default=0.85)
    a = ap.parse_args()

    grid = json.load(open(a.score))["grid"]
    slug = os.path.splitext(os.path.basename(a.score))[0]
    work = os.path.join("work", "ab", slug)
    os.makedirs(work, exist_ok=True)
    os.makedirs(a.outdir, exist_ok=True)

    clip = os.path.join(work, "clip.wav")
    subprocess.run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-ss", str(a.frm),
                    "-t", str(a.secs), "-i", a.wav, "-ac", "2", "-ar", "44100", clip], check=True)

    drums = os.path.join(work, "htdemucs", "clip", "drums.wav")
    if not os.path.isfile(drums):
        subprocess.run([sys.executable, "-m", "demucs", "--two-stems", "drums",
                        "-o", work, clip], check=True)
        got = os.path.join(work, "htdemucs", "clip", "drums.wav")
        if os.path.isfile(got):
            drums = got

    seg, sr = read(drums)
    step = 60.0 / grid["bpm"]
    for name, shift in (("A", 0.0), ("B", 0.080), ("C", step / 2)):
        out = os.path.join(a.outdir, f"{slug}-{name}.mp3")
        n = render(seg, sr, grid, a.frm, shift, out, a.gain)
        print(f"  {name}  shift {shift * 1000:6.1f} ms   {n} clicks   {out}")


if __name__ == "__main__":
    sys.exit(main())
