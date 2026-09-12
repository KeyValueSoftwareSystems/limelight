"""What a song clock has to do, and a test that a guessing clock cannot pass.

The protocol answers "where are we in the song" in musical terms, but something
has to tell it where the song is in seconds. That something is a clock, and a
show is only as well synchronised as its clock is honest.

There are two ways to build one.

  COUNTING   Note the wall time when play is pressed, then report the elapsed
             wall seconds since. Cheap, needs nothing from the audio, and wrong
             in three ways: it starts counting before the sound starts, so it
             runs ahead by however long the audio took to begin; that head start
             is a different number every time, so no fixed delay setting can
             remove it; and a sound card's sample clock does not run at exactly
             the speed the CPU thinks it does, so the two slide apart over a
             song.

  MEASURING  Ask the audio device how much sound it has actually delivered to
             the speaker. Nothing to estimate: if the device started late, the
             number says so; if the card runs slow, the number runs slow with
             it. A delay setting survives, but it goes back to meaning the only
             thing it should ever have meant -- how long the lamps and the cable
             take to react, which really is the same every time.

The contract is one method:

    position() -> float     song seconds, measured, honest while paused

Hand it to a Session as `song_time` and the protocol reads it instead of
running a clock of its own:

    clock = MeasuredClock(device)
    s = Session(score, song_time=clock.position)

`conformance()` below is the part that makes this a rule rather than advice.
It drives a clock through a device that starts late and runs at the wrong
speed, and fails anything that answers with arithmetic instead of measurement.
CountingClock is kept in this file on purpose: a test that nothing can fail is
not a test, so the suite proves the harness by failing that one.
"""
import math


# ---------------------------------------------------------------------------
# The device a measuring clock needs.
#
# Three methods. An implementation over sounddevice is about fifteen lines:
# open an OutputStream, count the frames handed to the callback, and report
# frames / samplerate minus the stream's own output latency -- because frames
# handed to the driver have not reached the speaker yet.
# ---------------------------------------------------------------------------
class Device:
    def start(self, at: float) -> None:
        """Begin playing from `at` song seconds."""
        raise NotImplementedError

    def stop(self) -> None:
        raise NotImplementedError

    def played(self):
        """Song seconds currently audible, or None if no sound is out yet.

        None is not zero and the difference matters: between pressing play and
        the first sample reaching the speaker, a clock that says 0.0 is making
        the same claim as one that has measured silence.
        """
        raise NotImplementedError


class MeasuredClock:
    """A clock that asks the device where the music is."""

    def __init__(self, device: Device, latency_s: float = 0.0):
        self.device = device
        self.latency_s = float(latency_s)   # lamps and cable, not audio startup
        self._anchor = 0.0                  # where we were told to be
        self._playing = False

    @property
    def playing(self) -> bool:
        return self._playing

    def position(self) -> float:
        if not self._playing:
            return self._anchor
        p = self.device.played()
        # Nothing audible yet: hold at the anchor rather than run ahead of the
        # sound. This is the head start that a counting clock builds in and
        # then spends an evening trying to tune out.
        if p is None:
            return self._anchor
        return p + self.latency_s

    def play(self, at=None) -> None:
        if at is None:
            at = self.position()
        self._anchor = max(0.0, float(at))
        self._playing = True
        self.device.start(self._anchor)

    def pause(self) -> None:
        self._anchor = self.position()
        self._playing = False
        self.device.stop()

    def seek(self, to: float) -> None:
        was = self._playing
        self.device.stop()
        self._anchor = max(0.0, float(to))
        if was:
            self.device.start(self._anchor)
        self._playing = was


class CountingClock:
    """The clock this project has been using, kept so the test can fail it.

    It never asks the device anything. Every number it returns is arithmetic on
    wall time, which is why a show driven by it needs a delay setting, why the
    right value for that setting changes between runs, and why the lights are
    furthest out at the end of the song.
    """

    def __init__(self, device: Device, now, latency_s: float = 0.0):
        self.device = device
        self.now = now
        self.latency_s = float(latency_s)
        self._anchor = 0.0
        self._anchor_wall = None
        self._playing = False

    @property
    def playing(self) -> bool:
        return self._playing

    def position(self) -> float:
        if not self._playing or self._anchor_wall is None:
            return self._anchor
        return self._anchor + (self.now() - self._anchor_wall) + self.latency_s

    def play(self, at=None) -> None:
        if at is None:
            at = self.position()
        self._anchor = max(0.0, float(at))
        self._anchor_wall = self.now()      # counting starts here...
        self._playing = True
        self.device.start(self._anchor)     # ...and the sound starts later

    def pause(self) -> None:
        self._anchor = self.position()
        self._playing = False
        self.device.stop()

    def seek(self, to: float) -> None:
        was = self._playing
        self.device.stop()
        self._anchor = max(0.0, float(to))
        self._anchor_wall = self.now()
        if was:
            self.device.start(self._anchor)
        self._playing = was


# ---------------------------------------------------------------------------
# A device that misbehaves the way real ones do, so a clock can be tested
# without a sound card.
# ---------------------------------------------------------------------------
class FakeDevice(Device):
    """Starts late and runs at the wrong speed, both by a stated amount.

    `start_delay_s` is the gap between being told to play and the first sample
    reaching the speaker -- process spawn, buffer fill, and on the panel today
    a temporary copy of the rest of the track being written to disk, which is
    why it is not the same number twice.

    `rate` is the device's sample clock measured against the CPU's: 1.0003 means
    the card plays slightly fast, which is an ordinary amount of wrong.
    """

    def __init__(self, now, start_delay_s=0.08, rate=1.0):
        self.now = now
        self.start_delay_s = float(start_delay_s)
        self.rate = float(rate)
        self._from = None
        self._started_wall = None

    def start(self, at: float) -> None:
        self._from = float(at)
        self._started_wall = self.now()

    def stop(self) -> None:
        self._from = None
        self._started_wall = None

    def played(self):
        if self._from is None:
            return None
        elapsed = self.now() - self._started_wall - self.start_delay_s
        if elapsed < 0:
            return None                      # told to play; nothing audible yet
        return self._from + elapsed * self.rate

    def true_position(self):
        """What is actually coming out of the speaker. The thing being checked."""
        p = self.played()
        return self._from if p is None else p


def conformance(make_clock, label=""):
    """Drive a clock through a misbehaving device and report where it lies.

    Returns a list of (passed, name, detail). Tolerances are in milliseconds and
    chosen for what an audience can see: a fixed 20 ms error is invisible, a
    varying one is not, and 50 ms of slide across a song is a drummer playing
    to a different click.
    """
    res = []
    def ok(name, cond, detail=""):
        res.append((bool(cond), (label + ": " if label else "") + name, detail))

    # --- 1. the sound starts late, and the clock must not run ahead of it ----
    t = [0.0]
    now = lambda: t[0]
    dev = FakeDevice(now, start_delay_s=0.080, rate=1.0)
    c = make_clock(dev, now)
    c.play(0.0)
    t[0] += 0.040                       # 40 ms in: still silent
    err_silent = (c.position() - dev.true_position()) * 1000
    ok("does not run ahead of a sound that has not started",
       abs(err_silent) < 5, f"{err_silent:+.0f} ms ahead while still silent")

    t[0] += 1.000                       # 1.04 s of wall, 0.96 s of music
    err_start = (c.position() - dev.true_position()) * 1000
    ok("agrees with the audio once it is playing",
       abs(err_start) < 5, f"{err_start:+.0f} ms")

    # --- 2. the same test, with a different start delay ---------------------
    # This is the one a fixed delay setting cannot survive. If the error here
    # differs from the error above, no single number can correct both.
    t2 = [0.0]
    now2 = lambda: t2[0]
    dev2 = FakeDevice(now2, start_delay_s=0.020, rate=1.0)
    c2 = make_clock(dev2, now2)
    c2.play(0.0)
    t2[0] += 1.040
    err_other = (c2.position() - dev2.true_position()) * 1000
    ok("is wrong by the same amount when the start delay changes",
       abs(err_other - err_start) < 5,
       f"{err_start:+.0f} ms at one delay, {err_other:+.0f} ms at another "
       f"-- a fixed offset cannot fix both" if abs(err_other - err_start) >= 5 else
       f"{err_start:+.0f} vs {err_other:+.0f} ms")

    # --- 3. the card runs fast, and the clock must run fast with it ---------
    t3 = [0.0]
    now3 = lambda: t3[0]
    dev3 = FakeDevice(now3, start_delay_s=0.0, rate=1.0003)
    c3 = make_clock(dev3, now3)
    c3.play(0.0)
    t3[0] += 1.0
    early = (c3.position() - dev3.true_position()) * 1000
    t3[0] += 240.0                      # a four-minute song
    late = (c3.position() - dev3.true_position()) * 1000
    ok("does not slide apart from the audio across a song",
       abs(late - early) < 50, f"{early:+.0f} ms at the start, {late:+.0f} ms four minutes in")

    # --- 4. paused means paused, and a seek lands where it was sent ---------
    t4 = [0.0]
    now4 = lambda: t4[0]
    dev4 = FakeDevice(now4, start_delay_s=0.0, rate=1.0)
    c4 = make_clock(dev4, now4)
    c4.play(10.0)
    t4[0] += 2.0
    held = c4.position()
    c4.pause()
    t4[0] += 30.0
    ok("does not move while paused", abs(c4.position() - held) * 1000 < 5,
       f"moved {(c4.position() - held) * 1000:+.0f} ms in 30 s of pause")
    c4.seek(61.9)
    ok("reports where it was sent", abs(c4.position() - 61.9) < 0.005,
       f"{c4.position():.3f} s")

    return res


# ---------------------------------------------------------------------------
# A real device, over sounddevice. Written against the library's documented
# behaviour and checked only by the conformance harness above, which uses a
# simulated device -- it has not yet been run against a sound card. Treat the
# first run on the rig as the real test.
# ---------------------------------------------------------------------------
class SoundDeviceOutput(Device):
    """Plays a WAV and reports how much of it has actually reached the speaker.

    The measurement is the whole point and it is two lines: count the frames
    handed to the callback, then subtract the stream's own output latency,
    because frames given to the driver are not audible yet. No estimate of
    startup time is needed or made -- before the first callback runs, played()
    says None, which is the honest answer.

    Replaces pw-play, which cannot report its position at all. That is the only
    reason the panel had to guess.
    """

    def __init__(self, path, blocksize=0):
        import soundfile as sf
        self.path = path
        info = sf.info(path)
        self.sr, self.channels = info.samplerate, info.channels
        self.frames_total = info.frames
        self.blocksize = blocksize
        self._stream = None
        self._file = None
        self._from = 0.0
        self._frames = 0
        self._done = False

    @property
    def duration(self):
        return self.frames_total / self.sr

    def start(self, at: float) -> None:
        import sounddevice as sd
        import soundfile as sf
        self.stop()
        self._from = max(0.0, float(at))
        self._frames = 0
        self._done = False
        self._file = sf.SoundFile(self.path)
        self._file.seek(min(int(round(self._from * self.sr)), self.frames_total))

        def callback(outdata, frames, time_info, status):
            data = self._file.read(frames, dtype="float32", always_2d=True)
            n = len(data)
            outdata[:n] = data
            if n < frames:
                outdata[n:] = 0
                self._done = True
                raise sd.CallbackStop
            self._frames += frames

        self._stream = sd.OutputStream(samplerate=self.sr, channels=self.channels,
                                       blocksize=self.blocksize, callback=callback)
        self._stream.start()

    def stop(self) -> None:
        if self._stream is not None:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception:
                pass
        self._stream = None
        if self._file is not None:
            try:
                self._file.close()
            except Exception:
                pass
        self._file = None
        self._frames = 0

    def played(self):
        if self._stream is None or self._frames == 0:
            return None                     # nothing audible yet, and say so
        latency = getattr(self._stream, "latency", 0.0) or 0.0
        return self._from + self._frames / self.sr - float(latency)

    @property
    def finished(self):
        return self._done
