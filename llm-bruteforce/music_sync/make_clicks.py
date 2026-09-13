#!/usr/bin/env python3
"""Write a click-track WAV for offset calibration: make_clicks.py [bpm] [seconds] [out.wav]

Every beat is a short 1 kHz tick; every 4th is louder (the downbeat)."""
import sys
import numpy as np
import soundfile as sf

bpm = float(sys.argv[1]) if len(sys.argv) > 1 else 120.0
seconds = float(sys.argv[2]) if len(sys.argv) > 2 else 12.0
out = sys.argv[3] if len(sys.argv) > 3 else "clicks.wav"
sr = 44100

y = np.zeros(int(seconds * sr))
n = int(0.03 * sr)
tick = np.sin(2 * np.pi * 1000 * np.arange(n) / sr) * np.exp(-np.arange(n) / (0.006 * sr))
for k, t in enumerate(np.arange(0.5, seconds - 0.1, 60.0 / bpm)):
    i = int(t * sr)
    y[i:i + n] += tick * (0.9 if k % 4 == 0 else 0.45)
sf.write(out, y, sr, subtype="PCM_16")
print(f"wrote {out}: {bpm:.0f} BPM, {seconds:.0f} s, first click at 0.50 s")
