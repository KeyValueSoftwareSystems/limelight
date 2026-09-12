"""The clock contract, checked -- including that the check can fail.

A test that nothing can fail is not a test. That is not a general worry here,
it is the specific bug this project has already hit twice: a phrase origin
chosen by scoring boundaries against themselves, and a scores check that would
have skipped itself when its input went missing. So this asserts both halves --
that a measuring clock passes, and that a counting one does not.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from clock import conformance, MeasuredClock, CountingClock, FakeDevice   # noqa: E402
from session import Session                                              # noqa: E402

out = []
def ok(name, cond, detail=""):
    out.append((bool(cond), name, detail))


# ---- a measuring clock keeps the contract ---------------------------------
for passed, name, detail in conformance(lambda d, n: MeasuredClock(d), "measured"):
    ok(name, passed, detail)

# ---- a counting clock does not, and the harness proves it -----------------
counting = conformance(lambda d, n: CountingClock(d, n), "counting")
failed = [r for r in counting if not r[0]]
ok("the harness can fail: a counting clock breaks the contract",
   len(failed) >= 3, f"{len(failed)} of {len(counting)} checks fail")
ok("and it fails on the three things that break a show",
   all(any(k in r[1] for r in failed)
       for k in ("ahead of a sound", "start delay changes", "slide apart")),
   "; ".join(r[1].split(": ", 1)[1] for r in failed))

# ---- the fixed-delay setting cannot rescue a counting clock ---------------
# Tune the delay perfectly at one start, then start somewhere else. This is the
# evening that keeps getting spent in the room.
t = [0.0]
now = lambda: t[0]
dev = FakeDevice(now, start_delay_s=0.080, rate=1.0)
c = CountingClock(dev, now)
c.play(0.0)
t[0] += 1.080
tuned = c.position() - dev.true_position()     # the delay that fixes THIS run

t2 = [0.0]
now2 = lambda: t2[0]
dev2 = FakeDevice(now2, start_delay_s=0.025, rate=1.0)
c2 = CountingClock(dev2, now2, latency_s=-tuned)   # same setting, next run
c2.play(0.0)
t2[0] += 1.025
left = (c2.position() - dev2.true_position()) * 1000
ok("a delay tuned on one run is wrong on the next", abs(left) > 20,
   f"tuned out {tuned*1000:.0f} ms, still {left:+.0f} ms out next time")

# ---- and the same setting on a measuring clock stays right ----------------
t3 = [0.0]
now3 = lambda: t3[0]
d3 = FakeDevice(now3, start_delay_s=0.025, rate=1.0)
m = MeasuredClock(d3)
m.play(0.0)
t3[0] += 1.025
ok("a measuring clock needs no tuning at all",
   abs(m.position() - d3.true_position()) * 1000 < 5,
   f"{(m.position() - d3.true_position())*1000:+.0f} ms with no setting")


# ---- the clock plugs into the protocol, and the music follows it ----------
score = {"grid": {"bpm": 120, "beats_per_bar": 4, "first_beat_s": 0.0, "first_bar": 1}}
t4 = [0.0]
now4 = lambda: t4[0]
d4 = FakeDevice(now4, start_delay_s=0.100, rate=1.0)
clock = MeasuredClock(d4)
s = Session(score, song_time=clock.position)
clock.play(0.0)
t4[0] += 0.050                       # half the start delay: no sound yet
ok("the protocol does not advance while the audio is still silent",
   s.now()["position"]["bar"] == 1 and s.now()["position"]["beat"] == 1,
   f"bar {s.now()['position']['bar']} beat {s.now()['position']['beat']}")

t4[0] += 2.100                       # 2.05 s of music at 120 bpm = bar 2 beat 1.1
pos = s.now()["position"]
ok("and lands on the bar the audio is actually at",
   pos["bar"] == 2 and abs(pos["beat"] - 1.1) < 0.01, f"bar {pos['bar']} beat {pos['beat']}")

# the same moment through a counting clock is a beat and a half early
t5 = [0.0]
now5 = lambda: t5[0]
d5 = FakeDevice(now5, start_delay_s=0.100, rate=1.0)
cc = CountingClock(d5, now5)
s5 = Session(score, song_time=cc.position)
cc.play(0.0)
t5[0] += 2.150
drift_beats = (s5.now()["seconds"] - s.now()["seconds"]) / (60.0 / 120)
ok("where a counting clock would have put it is measurably early",
   drift_beats > 0.15, f"{drift_beats:.2f} beats early")

bad = [r for r in out if not r[0]]
for passed, name, detail in out:
    if not passed:
        print(f"  FAIL  {name}   {detail}")
print(f"\n{len(bad)} of {len(out)} FAILED" if bad else f"\nall {len(out)} checks pass")
sys.exit(1 if bad else 0)
