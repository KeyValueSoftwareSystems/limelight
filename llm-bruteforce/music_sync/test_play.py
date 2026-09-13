import json

import numpy as np

from play import stream_frames, load_stream, apply_gain


class FakeClock:
    """Deterministic clock: sleep() advances time, now() reads it."""

    def __init__(self):
        self.t = 100.0

    def now(self):
        return self.t

    def sleep(self, s):
        self.t += s


class RecordingSender:
    def __init__(self):
        self.sent = []

    def send(self, values):
        self.sent.append(list(values))


def test_every_frame_is_sent_once_in_order_at_fps():
    frames = [[i, 0, 0] for i in range(10)]
    clk, snd = FakeClock(), RecordingSender()
    stream_frames(frames, fps=40, sender=snd, now=clk.now, sleep=clk.sleep)
    assert [f[0] for f in snd.sent] == list(range(10))
    assert clk.t - 100.0 >= 10 / 40 - 1e-9          # ran for the stream's duration


def test_clock_jump_skips_frames_instead_of_double_sending():
    frames = [[i, 0, 0] for i in range(10)]
    clk, snd = FakeClock(), RecordingSender()

    def jumpy_sleep(s):
        clk.t += s * 3                               # machine stalls: 3 frames pass per tick

    stream_frames(frames, fps=40, sender=snd, now=clk.now, sleep=jumpy_sleep)
    sent = [f[0] for f in snd.sent]
    assert sent == sorted(set(sent))                 # strictly increasing, no repeats
    assert sent[0] == 0 and sent[-1] >= 7


def test_positive_offset_starts_lights_later_and_start_skips_ahead():
    frames = [[i, 0, 0] for i in range(10)]
    clk, snd = FakeClock(), RecordingSender()
    stream_frames(frames, fps=40, sender=snd, now=clk.now, sleep=clk.sleep, offset_s=0.05)
    assert snd.sent[0][0] == 0
    assert snd.sent[1][0] == 0 or snd.sent[2][0] == 0    # frame 0 is held during the 2-frame offset

    clk, snd = FakeClock(), RecordingSender()
    stream_frames(frames, fps=40, sender=snd, now=clk.now, sleep=clk.sleep, start_s=0.1)
    assert snd.sent[0][0] == 4


def test_apply_gain_scales_and_clamps():
    out = apply_gain(np.array([[255, 128, 0]]), 0.5)
    assert out.tolist() == [[128, 64, 0]]
    assert apply_gain(np.array([[255, 0, 0]]), 2.0).tolist() == [[255, 0, 0]]


def test_load_stream_reads_frames_and_resolves_wav_next_to_json(tmp_path):
    p = tmp_path / "song.lights.json"
    p.write_text(json.dumps({"fps": 40, "frames": [[1, 2, 3]], "wav": "song.cache.wav",
                             "beats": [], "sections": [0.0], "duration": 0.025}))
    s = load_stream(str(p))
    assert s["fps"] == 40
    assert s["frames"].shape == (1, 3) and s["frames"].dtype == np.uint8
    assert s["wav"] == str(tmp_path / "song.cache.wav")
