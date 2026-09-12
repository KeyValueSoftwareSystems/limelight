"""Frame transport: the DMX side of playback, driven by the protocol's clock.

Where are we in the song? That question belongs to the protocol, and the answer
is only as honest as the clock behind it. So the transport no longer runs a clock
of its own -- it hands the audio device to protocol/clock.py and reads back the
position:

  * a device that can report how much sound it has actually played (SoundDeviceOutput)
    gets a MeasuredClock: the position is measured, not guessed, so there is no
    start-up head start to tune out and no slide across the song;
  * pw-play (AudioPlayer) and lights-only preview cannot report a position, so they
    get a CountingClock over wall time -- the old behaviour, kept for the fallback.

`tick()` at 40 Hz reads clock.position(), subtracts the light-vs-sound offset (the
lamp + cable delay, which really is constant), and sends the matching frame. Paused =
hold and refresh the current frame. The output loop must never die: a dead loop is no
DMX, and the head then runs its own auto-program.
"""
import math
import os
import sys
import threading
import time

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "..", "..", "..", "protocol"))
from clock import MeasuredClock, CountingClock, Device   # noqa: E402


class _NullDevice(Device):
    """No audio (lights-only preview): start/stop do nothing and played() is None,
    so a CountingClock over it simply tracks wall time."""

    def start(self, at: float) -> None:
        pass

    def stop(self) -> None:
        pass

    def played(self):
        return None


class Transport:
    def __init__(self, sender, fps: int = 40, park=None):
        self.sender = sender
        self.fps = fps
        self.park = None if park is None else list(park)   # safe dark frame (head parked); None = zeros
        self.gain_mask = None                               # bool per channel: which ones gain scales
        self.frames = None
        self.offset_s = 0.0                                 # light-vs-sound trim (lamp + cable)
        self.gain = 1.0
        self.net = True
        self.index = None
        self.rgb = [0, 0, 0]
        self.values = []
        self.audio = None
        self.clock = CountingClock(_NullDevice(), time.monotonic)   # replaced on load
        self.send_errors = 0
        self.last_send_error = None
        self.lock = threading.Lock()

    # ----- configuration ------------------------------------------------
    def _make_clock(self, audio):
        """A device that can say how much sound it has played gets measured; one
        that cannot (pw-play, or no audio) is counted. Honest sync needs the first."""
        if audio is not None and hasattr(audio, "played"):
            return MeasuredClock(audio)
        return CountingClock(audio if audio is not None else _NullDevice(), time.monotonic)

    def load(self, frames, fps: int, audio=None, gain_mask=None, park=None) -> None:
        with self.lock:
            self._stop_audio_locked()
            self.frames = np.asarray(frames, dtype=np.uint8)
            self.fps = int(fps)
            self.gain_mask = None if gain_mask is None else np.asarray(gain_mask, dtype=bool)
            if park is not None:
                self.park = list(park)
            self.audio = audio
            self.clock = self._make_clock(audio)
            self.index, self.rgb = None, [0, 0, 0]

    def _stop_audio_locked(self) -> None:
        try:
            self.clock.pause()          # stops the current device wherever it is
        except Exception:               # noqa: BLE001 - never let a bad device block a load
            pass

    # ----- transport controls -----------------------------------------------
    def play(self, position: float | None = None, now: float | None = None) -> None:
        with self.lock:
            pos = self.clock.position() if position is None else max(0.0, float(position))
            if self.frames is not None and pos >= self.duration:
                pos = 0.0
            self.clock.play(pos)

    def pause(self, now: float | None = None) -> None:
        with self.lock:
            self.clock.pause()

    def seek(self, position: float, now: float | None = None) -> None:
        with self.lock:
            self.clock.seek(max(0.0, float(position)))

    def nudge(self, delta_s: float, now: float | None = None) -> None:
        """Shift the playhead by delta seconds (audio, if any, restarts at the new position)."""
        with self.lock:
            self.clock.seek(max(0.0, self.clock.position() + float(delta_s)))

    def set_offset_ms(self, ms: float) -> None:
        self.offset_s = float(ms) / 1000.0

    def set_gain(self, gain: float) -> None:
        self.gain = max(0.0, min(1.0, float(gain)))

    def set_net(self, on: bool) -> None:
        on = bool(on)
        if self.net and not on:
            self._dark()
        self.net = on

    def _dark(self) -> None:
        self.sender.blackout(pause=0, frame=self.park)

    def blackout(self) -> None:
        with self.lock:
            self.clock.pause()
            self.rgb = [0, 0, 0]
        self._dark()

    # ----- clock ----------------------------------------------------------
    def position(self, now: float | None = None) -> float:
        return self.clock.position()

    @property
    def playing(self) -> bool:
        return self.clock.playing

    @property
    def duration(self) -> float:
        return 0.0 if self.frames is None else len(self.frames) / self.fps

    # ----- output -----------------------------------------------------------
    def _scaled(self, row):
        vals = row.astype(float)
        if self.gain_mask is None:
            vals *= self.gain
        else:
            vals[self.gain_mask] *= self.gain
        return np.clip(np.round(vals), 0, 255).astype(int)

    def tick(self, now: float | None = None) -> None:
        with self.lock:
            if self.frames is None:
                if self.park is not None and self.net:
                    self.sender.send(self.park)          # idle: keep the head parked, never silent
                return
            # position is measured/counted by the clock; the offset is only the
            # lamp + cable delay -- the audio start-up guesswork is gone.
            pos = self.clock.position() - self.offset_s
            i = max(0, int(math.floor(pos * self.fps + 1e-6)))
            if i >= len(self.frames):
                if self.clock.playing:
                    self.clock.pause()
                    self.index, self.rgb = len(self.frames) - 1, [0, 0, 0]
                # end-of-song: keep the head PARKED, never go silent.
                if self.park is not None and self.net:
                    self.sender.send(self.park)
                return
            vals = self._scaled(self.frames[i])
            self.index, self.rgb = i, [int(v) for v in vals[:3]]
            self.values = [int(v) for v in vals]
            if self.net:
                self.sender.send(vals)

    def _audio_running(self) -> bool:
        a = self.audio
        if a is None:
            return False
        r = getattr(a, "running", None)
        if r is not None:
            return bool(r)
        # a measuring device: audible if it reports a position
        try:
            return a.played() is not None
        except Exception:  # noqa: BLE001
            return False

    def status(self, now: float | None = None) -> dict:
        return {
            "loaded": self.frames is not None,
            "playing": self.clock.playing,
            "position": self.clock.position(),
            "duration": self.duration,
            "fps": self.fps,
            "index": self.index,
            "rgb": list(self.rgb),
            "offset_ms": self.offset_s * 1000.0,
            "gain": self.gain,
            "net": self.net,
            "audio": self._audio_running(),
            # so the browser can see which clock is live: "measured" reads the audio
            # device's real position (honest); "counting" is the wall-time fallback.
            "clock": "measured" if isinstance(self.clock, MeasuredClock) else "counting",
            "audio_backend": type(self.audio).__name__ if self.audio is not None else None,
            "values": list(getattr(self, "values", [])),
            "send_errors": self.send_errors,
            "last_send_error": self.last_send_error,
        }

    # ----- background loop ------------------------------------------------
    def run_forever(self, stop_event: threading.Event) -> None:
        """The output loop must never die: a dead loop means no DMX, and the head then
        runs its own auto-program. Network errors (cable unplugged) are counted and retried."""
        tick = 1.0 / self.fps
        next_t = time.monotonic()
        while not stop_event.is_set():
            try:
                self.tick()
            except OSError as e:
                self.send_errors += 1
                self.last_send_error = f"{time.strftime('%H:%M:%S')} {e}"
                if self.send_errors in (1, 10, 100) or self.send_errors % 1000 == 0:
                    print(f"transport: send failed ({e}); retrying every tick [{self.send_errors}]", flush=True)
            except Exception as e:  # noqa: BLE001 - never let the loop die
                self.send_errors += 1
                self.last_send_error = f"{time.strftime('%H:%M:%S')} {type(e).__name__}: {e}"
                print(f"transport: tick error {type(e).__name__}: {e}", flush=True)
            next_t += tick
            delay = next_t - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            else:
                next_t = time.monotonic()
