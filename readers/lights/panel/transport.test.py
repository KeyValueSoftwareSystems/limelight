"""The panel's transport clock, held to the protocol's clock contract.

The transport no longer keeps its own clock; it hands the audio device to
protocol/clock.py. So the same conformance harness that fails a guessing clock is
pointed at the transport: driven through a device that starts late and runs fast,
its position must stay honest. And the fallback is checked too -- a device that
cannot report a position gets a counting clock, because that is the best that can
be done for pw-play.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "protocol"))

from clock import conformance, MeasuredClock, CountingClock, FakeDevice   # noqa: E402
from transport import Transport, _NullDevice                              # noqa: E402


class NullSender:
    def send(self, values):
        pass

    def blackout(self, pause=0, frame=None):
        pass


FRAMES = [[0] * 41 for _ in range(2600)]   # 65 s at 40 fps: long enough for the seek test


class _Adapter:
    """Presents a loaded Transport through the clock interface conformance expects."""

    def __init__(self, device):
        self.t = Transport(NullSender(), fps=40)
        self.t.load(FRAMES, 40, audio=device)

    @property
    def playing(self):
        return self.t.playing

    def position(self):
        return self.t.position()

    def play(self, at=None):
        self.t.play(at)

    def pause(self):
        self.t.pause()

    def seek(self, to):
        self.t.seek(to)


out = []
def ok(name, cond, detail=""):
    out.append((bool(cond), name, detail))


# ---- the transport, driven through a measuring device, keeps the contract ----
for passed, name, detail in conformance(lambda dev, now: _Adapter(dev), "panel"):
    ok(name, passed, detail)

# ---- the transport picks the right clock for the device it is given ----------
measuring = Transport(NullSender(), fps=40)
measuring.load(FRAMES, 40, audio=FakeDevice(lambda: 0.0))
ok("a device that reports played() gets a MeasuredClock",
   isinstance(measuring.clock, MeasuredClock), type(measuring.clock).__name__)


class _PwPlayLike:
    """start/stop only, no played() -- like AudioPlayer over pw-play."""
    def start(self, at): pass
    def stop(self): pass


counting = Transport(NullSender(), fps=40)
counting.load(FRAMES, 40, audio=_PwPlayLike())
ok("a device that cannot report a position gets a CountingClock",
   isinstance(counting.clock, CountingClock), type(counting.clock).__name__)

noaudio = Transport(NullSender(), fps=40)
noaudio.load(FRAMES, 40, audio=None)
ok("no audio also counts (lights-only preview)",
   isinstance(noaudio.clock, CountingClock), type(noaudio.clock).__name__)

bad = 0
for passed, name, detail in out:
    print(f"  {'pass' if passed else 'FAIL'}  {name}{'   ' + detail if detail else ''}")
    bad += not passed
print(f"\nall {len(out)} checks pass" if not bad else f"\n{bad} FAILED")
sys.exit(1 if bad else 0)
