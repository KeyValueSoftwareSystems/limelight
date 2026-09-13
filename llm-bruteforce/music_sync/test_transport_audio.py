import numpy as np
import pytest

from transport import Transport


class RecordingSender:
    def __init__(self):
        self.sent, self.blackouts = [], 0

    def send(self, v):
        self.sent.append([int(x) for x in v])

    def blackout(self, repeats=5, pause=0.02, frame=None):
        self.blackouts += 1


class FakeAudio:
    def __init__(self):
        self.calls, self.running = [], False

    def start(self, position):
        self.calls.append(("start", round(position, 3))); self.running = True

    def stop(self):
        self.calls.append(("stop",)); self.running = False


def frames(n):
    return np.array([[i % 256, 0, 0] for i in range(n)], dtype=np.uint8)


def make():
    snd, au = RecordingSender(), FakeAudio()
    tr = Transport(snd, fps=40)
    tr.load(frames(400), fps=40, audio=au)
    return tr, snd, au


def test_play_starts_audio_at_position_and_runs_the_clock():
    tr, snd, au = make()
    tr.play(position=2.0, now=100.0)
    assert au.calls == [("start", 2.0)]
    tr.tick(now=100.5)
    assert snd.sent[-1][0] == 100                       # 2.5 s * 40
    assert tr.status(now=100.5)["playing"] is True and tr.status()["audio"] is True


def test_pause_stops_audio_and_freezes_position():
    tr, snd, au = make()
    tr.play(position=0.0, now=0.0)
    tr.pause(now=1.0)
    assert au.calls[-1] == ("stop",)
    assert tr.status(now=5.0)["position"] == pytest.approx(1.0)
    assert tr.status()["playing"] is False


def test_seek_while_playing_restarts_audio_and_while_paused_only_moves():
    tr, snd, au = make()
    tr.play(position=0.0, now=0.0)
    tr.seek(3.0, now=1.0)
    assert au.calls[-2:] == [("stop",), ("start", 3.0)]
    assert tr.status(now=1.0)["position"] == pytest.approx(3.0) and tr.status()["playing"] is True
    tr.pause(now=1.0)
    tr.seek(5.0, now=2.0)
    assert au.calls[-1] == ("stop",)                    # no restart while paused
    assert tr.status(now=9.0)["position"] == pytest.approx(5.0)


def test_end_of_stream_stops_audio_and_blacks_out():
    tr, snd, au = make()
    tr.play(position=9.9, now=0.0)
    tr.tick(now=0.5)                                    # 10.4 s > 10 s duration
    assert snd.blackouts == 1 and au.running is False and tr.status()["playing"] is False


def test_blackout_and_load_stop_audio():
    tr, snd, au = make()
    tr.play(position=0.0, now=0.0)
    tr.blackout()
    assert au.running is False and tr.status()["playing"] is False
    tr.play(position=0.0, now=0.0)
    au2 = FakeAudio()
    tr.load(frames(10), fps=40, audio=au2)
    assert au.running is False and tr.status()["loaded"] is True
