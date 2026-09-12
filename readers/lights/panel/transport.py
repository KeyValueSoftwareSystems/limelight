"""Frame transport: the master clock for audio and lights.

play/pause/seek move an anchor (position, wall time); `tick()` at 40 Hz
extrapolates from it and sends the matching frame to the PAR. The audio
player is started/stopped from the same anchor so the two stay locked.
Paused = hold and refresh the current frame.
"""
import math
import threading
import time

import numpy as np


class Transport:
    def __init__(self, sender, fps: int = 40, park=None):
        self.sender = sender
        self.fps = fps
        self.park = None if park is None else list(park)   # safe dark frame (head parked); None = zeros
        self.gain_mask = None                               # bool per channel: which ones gain scales
        self.frames = None
        self.playing = False
        self.anchor_pos = 0.0
        self.anchor_time = None
        self.offset_s = 0.0
        self.gain = 1.0
        self.net = True
        self.index = None
        self.rgb = [0, 0, 0]
        self.audio = None
        self.send_errors = 0
        self.last_send_error = None
        self.lock = threading.Lock()

    # ----- configuration ------------------------------------------------
    def load(self, frames, fps: int, audio=None, gain_mask=None, park=None) -> None:
        self._audio_stop()
        with self.lock:
            self.frames = np.asarray(frames, dtype=np.uint8)
            self.fps = int(fps)
            self.gain_mask = None if gain_mask is None else np.asarray(gain_mask, dtype=bool)
            if park is not None:
                self.park = list(park)
            self.playing = False
            self.anchor_pos, self.anchor_time = 0.0, None
            self.index, self.rgb = None, [0, 0, 0]
            self.audio = audio

    def set_clock(self, position: float, playing: bool, now: float | None = None) -> None:
        with self.lock:
            self.anchor_pos = max(0.0, float(position))
            self.anchor_time = time.monotonic() if now is None else now
            self.playing = bool(playing)

    # ----- transport controls -----------------------------------------------
    def _audio_stop(self) -> None:
        if self.audio is not None:
            self.audio.stop()

    def _audio_start(self, position: float) -> None:
        if self.audio is not None:
            self.audio.start(position)

    def play(self, position: float | None = None, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        pos = self.position(now) if position is None else max(0.0, float(position))
        if self.frames is not None and pos >= self.duration:
            pos = 0.0
        self.set_clock(pos, True, now)
        self._audio_start(pos)

    def pause(self, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        pos = self.position(now)
        self._audio_stop()
        self.set_clock(pos, False, now)

    def seek(self, position: float, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        was_playing = self.playing
        pos = max(0.0, float(position))
        self._audio_stop()
        self.set_clock(pos, was_playing, now)
        if was_playing:
            self._audio_start(pos)

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
        self._audio_stop()
        with self.lock:
            if self.playing:
                self.anchor_pos = self.position()
            self.playing = False
        self._dark()
        self.rgb = [0, 0, 0]

    def nudge(self, delta_s: float, now: float | None = None) -> None:
        """Shift the playhead by delta seconds (audio, if any, restarts at the new position)."""
        now = time.monotonic() if now is None else now
        self.seek(self.position(now) + float(delta_s), now)

    # ----- clock ----------------------------------------------------------
    def position(self, now: float | None = None) -> float:
        if self.anchor_time is None:
            return 0.0
        if not self.playing:
            return self.anchor_pos
        now = time.monotonic() if now is None else now
        return self.anchor_pos + (now - self.anchor_time)

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
            if self.frames is None or self.anchor_time is None:
                if self.park is not None and self.net:
                    self.sender.send(self.park)          # idle: keep the head parked, never silent
                return
            pos = self.position(now) - self.offset_s
            i = max(0, int(math.floor(pos * self.fps + 1e-6)))
            if i >= len(self.frames):
                if self.playing:
                    self.playing = False
                    self.anchor_pos = self.duration
                    self.index, self.rgb = len(self.frames) - 1, [0, 0, 0]
                    if self.audio is not None:
                        self.audio.stop()
                # end-of-song: keep the head PARKED, never go silent. (success-limelight's
                # transport had a bug here -- it stopped sending the park after the last
                # frame, so the head ran its auto-program; hold the park every tick.)
                if self.park is not None and self.net:
                    self.sender.send(self.park)
                return
            vals = self._scaled(self.frames[i])
            self.index, self.rgb = i, [int(v) for v in vals[:3]]
            self.values = [int(v) for v in vals]
            if self.net:
                self.sender.send(vals)

    def status(self, now: float | None = None) -> dict:
        return {
            "loaded": self.frames is not None,
            "playing": self.playing,
            "position": self.position(now),
            "duration": self.duration,
            "fps": self.fps,
            "index": self.index,
            "rgb": list(self.rgb),
            "offset_ms": self.offset_s * 1000.0,
            "gain": self.gain,
            "net": self.net,
            "audio": bool(self.audio is not None and self.audio.running),
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
