#!/usr/bin/env python3
"""Play a .lights.json stream to the PAR over Art-Net while the audio plays.

  play.py "The Nights.lights.json" [--offset MS] [--gain 0..1] [--start SEC]
                                   [--no-net] [--no-audio] [--gateway IP] [--universe N]

  --offset   positive = lights later, negative = lights earlier (ms)
  --start    begin this many seconds into the track (audio and lights)
  --no-net   preview in the terminal only, nothing on the wire
  --no-audio lights only

Ctrl-C blacks out DMX 1-3 and stops the audio. Only channels 1-3 of the
universe are ever written (Art-Net Length 4, channel 4 padded to 0).
"""
import argparse
import json
import math
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time

import numpy as np

from artnet import Sender


def load_stream(path):
    with open(path) as fh:
        d = json.load(fh)
    frames = np.asarray(d["frames"], dtype=np.uint8)
    wav = d.get("wav")
    if wav and not os.path.isabs(wav):
        wav = os.path.join(os.path.dirname(os.path.abspath(path)), wav)
    return {"fps": int(d["fps"]), "frames": frames, "wav": wav,
            "beats": d.get("beats", []), "sections": d.get("sections", []),
            "duration": d.get("duration", len(frames) / d["fps"])}


def apply_gain(frames, gain):
    return np.clip(np.round(np.asarray(frames, dtype=float) * gain), 0, 255).astype(np.uint8)


def stream_frames(frames, fps, sender, now=time.monotonic, sleep=time.sleep,
                  offset_s=0.0, start_s=0.0, on_frame=None):
    """Send frames[i] every 1/fps, where i follows the clock (dropping frames
    if we fall behind, never repeating a later frame). Frame 0 is held while
    a positive offset delays the start."""
    n = len(frames)
    t0 = now()
    tick = 1.0 / fps
    while True:
        wall = now()
        t = wall - t0 - offset_s + start_s
        if t < 0:
            i, next_wall = 0, wall + tick
        else:
            i = int(math.floor(t * fps + 1e-6))
            if i >= n:
                return
            next_wall = wall + ((i + 1) * tick - t)
        sender.send(frames[i])
        if on_frame:
            on_frame(i, t, frames[i])
        sleep(max(0.0, next_wall - now()))


def start_audio(wav_path, start_s=0.0, scratch=None):
    """Launch a PipeWire (or ALSA) player on the cached WAV; returns the Popen."""
    if start_s > 0:
        import soundfile as sf
        data, sr = sf.read(wav_path, start=int(start_s * sf.info(wav_path).samplerate), always_2d=True)
        scratch = scratch or tempfile.mkdtemp(prefix="music_sync_")
        wav_path = os.path.join(scratch, "trimmed.wav")
        sf.write(wav_path, data, sr, subtype="PCM_16")
    if shutil.which("pw-play"):
        cmd = ["pw-play", wav_path]
    elif shutil.which("aplay"):
        cmd = ["aplay", "-q", wav_path]
    else:
        raise RuntimeError("no audio player found (need pw-play or aplay)")
    return subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


class TerminalPreview:
    """Prints a coloured block + bar once per `every` frames; no network needed."""

    def __init__(self, fps, beats, every=4):
        self.every, self.fps = every, fps
        self.beats = np.asarray(beats, dtype=float)

    def __call__(self, i, t, rgb):
        if i % self.every:
            return
        r, g, b = (int(v) for v in rgb)
        level = max(r, g, b)
        bar = "#" * (level * 40 // 255)
        beat = "*" if len(self.beats) and np.min(np.abs(self.beats - t)) < 0.5 / self.fps * self.every else " "
        sys.stdout.write(f"\r{t:7.2f}s {beat} \x1b[48;2;{r};{g};{b}m   \x1b[0m {r:3d} {g:3d} {b:3d} {bar:<40}")
        sys.stdout.flush()


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stream")
    ap.add_argument("--offset", type=float, default=0.0, help="ms; + = lights later")
    ap.add_argument("--gain", type=float, default=1.0)
    ap.add_argument("--start", type=float, default=0.0, help="seconds into the track")
    ap.add_argument("--no-net", action="store_true")
    ap.add_argument("--no-audio", action="store_true")
    ap.add_argument("--gateway", default="2.0.0.100")
    ap.add_argument("--universe", type=int, default=1)
    args = ap.parse_args(argv)

    s = load_stream(args.stream)
    frames = apply_gain(s["frames"], args.gain)

    class NullSender:
        def send(self, v): pass
        def blackout(self, **kw): pass

    sender = NullSender() if args.no_net else Sender(gateway=args.gateway, universe=args.universe)
    audio = None

    def shutdown(*_):
        sender.blackout()
        if audio and audio.poll() is None:
            audio.terminate()
        print("\nblacked out DMX 1-3, audio stopped.", flush=True)
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    print(f"{os.path.basename(args.stream)}: {len(frames)} frames @ {s['fps']} fps, "
          f"{s['duration']:.1f}s, {len(s['beats'])} beats -> "
          f"{'PREVIEW ONLY' if args.no_net else f'{args.gateway} universe {args.universe} ch 1-3'}"
          f", offset {args.offset:+.0f} ms, gain {args.gain:.2f}", flush=True)

    if not args.no_audio:
        if not s["wav"] or not os.path.exists(s["wav"]):
            sys.exit(f"cached wav not found: {s['wav']} (re-run analyze.py)")
        audio = start_audio(s["wav"], args.start)

    preview = TerminalPreview(s["fps"], s["beats"]) if args.no_net else None
    stream_frames(frames, s["fps"], sender, offset_s=args.offset / 1000.0, start_s=args.start,
                  on_frame=preview)
    shutdown()


if __name__ == "__main__":
    main()
