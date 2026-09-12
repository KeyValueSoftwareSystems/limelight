"""Server-side audio playback through PipeWire, startable from any position.

`pw-play FILE` (or `aplay FILE`) plays a WAV *file*: from a pipe pw-play ignores the
WAV header and assumes 48 kHz, which made 44.1 kHz tracks play fast and sharp.
Starting mid-song writes a trimmed temporary WAV first (~40 ms for a full track).
Pause = kill the process; resume = start a new one at the paused position. Start
latency is a constant few tens of ms, which the UI's offset setting absorbs.
"""
import os
import sys
import tempfile
import shutil
import struct
import subprocess
import threading

import soundfile as sf


def wav_header(n_frames: int, sr: int, channels: int) -> bytes:
    data_bytes = n_frames * channels * 2
    return (b"RIFF" + struct.pack("<I", 36 + data_bytes) + b"WAVE"
            + b"fmt " + struct.pack("<IHHIIHH", 16, 1, channels, sr, sr * channels * 2, channels * 2, 16)
            + b"data" + struct.pack("<I", data_bytes))


def feed_pcm(path: str, start_frame: int, sink, stop: threading.Event, block: int = 4096) -> None:
    """Write a WAV stream for path[start_frame:] into sink until done or stop is set."""
    with sf.SoundFile(path) as f:
        start_frame = max(0, min(int(start_frame), f.frames))
        f.seek(start_frame)
        try:
            sink.write(wav_header(f.frames - start_frame, f.samplerate, f.channels))
            while not stop.is_set():
                chunk = f.read(block, dtype="int16")
                if len(chunk) == 0:
                    break
                sink.write(chunk.tobytes())
        except (BrokenPipeError, ValueError, OSError):
            pass


class AudioPlayer:
    def __init__(self, path: str, popen=subprocess.Popen):
        self.path = path
        info = sf.info(path)
        self.sr, self.channels, self.frames = info.samplerate, info.channels, info.frames
        self.proc = None
        self._tmp = None
        self._popen = popen
        self._lock = threading.RLock()      # start/stop race from concurrent HTTP requests
        self._spawned = []                  # every process we ever started: stop() kills them all

    @property
    def duration(self) -> float:
        return self.frames / self.sr

    @property
    def running(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def source_for(self, position: float) -> str:
        """Path of a WAV that starts at `position`: the original at 0, else a trimmed temp copy."""
        start = int(round(max(0.0, position) * self.sr))
        if start <= 0:
            return self.path
        self.cleanup()
        fd, tmp = tempfile.mkstemp(prefix="music_sync_", suffix=".wav")
        os.close(fd)
        with sf.SoundFile(self.path) as src:
            src.seek(min(start, src.frames))
            data = src.read(dtype="int16", always_2d=True)
        sf.write(tmp, data, self.sr, subtype="PCM_16")
        self._tmp = tmp
        return tmp

    def cleanup(self) -> None:
        if self._tmp and os.path.exists(self._tmp):
            try:
                os.remove(self._tmp)
            except OSError:
                pass
        self._tmp = None

    def start(self, position: float) -> None:
        with self._lock:
            self.stop()
            src = self.source_for(position)
            if shutil.which("pw-play"):
                cmd = ["pw-play", src]
            elif shutil.which("aplay"):
                cmd = ["aplay", "-q", src]
            else:
                raise RuntimeError("no audio player found (need pw-play or aplay)")
            self.proc = self._popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self._spawned.append(self.proc)

    def stop(self) -> None:
        with self._lock:
            self.proc = None
            for proc in self._spawned:
                if proc.poll() is None:
                    try:
                        proc.kill()
                        proc.wait(timeout=1)
                    except (OSError, subprocess.TimeoutExpired):
                        pass
            self._spawned = [p for p in self._spawned if p.poll() is None]
            self.cleanup()


def make_audio(path: str):
    """The audio backend the panel should use for a WAV.

    Prefer protocol/clock.py's SoundDeviceOutput when the `sounddevice` library is
    installed: it reports how much sound has actually reached the speaker, which lets
    the transport run a MeasuredClock and stops the show guessing where the song is.
    Fall back to pw-play (AudioPlayer), which cannot report a position -- the reason
    the panel needed a hand-tuned offset that changed every run.
    """
    import importlib.util
    if importlib.util.find_spec("sounddevice") is not None:
        proto = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             "..", "..", "..", "protocol")
        if proto not in sys.path:
            sys.path.insert(0, proto)
        try:
            from clock import SoundDeviceOutput
            return SoundDeviceOutput(path)
        except Exception:  # noqa: BLE001 - any import/construction trouble -> fall back
            pass
    return AudioPlayer(path)
