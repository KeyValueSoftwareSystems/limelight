import numpy as np
import pytest

from transport import Transport


class RecordingSender:
    def __init__(self):
        self.sent, self.blackouts = [], 0

    def send(self, values):
        self.sent.append([int(v) for v in values])

    def blackout(self, repeats=5, pause=0.02, frame=None):
        self.blackouts += 1
        self.sent.append([0, 0, 0])


def frames(n):
    return np.array([[i % 256, 0, 0] for i in range(n)], dtype=np.uint8)


def test_tick_sends_frame_for_extrapolated_position_while_playing():
    snd = RecordingSender()
    tr = Transport(snd, fps=40)
    tr.load(frames(100), fps=40)
    tr.set_clock(position=1.0, playing=True, now=500.0)
    tr.tick(now=500.1)                       # 1.1 s -> frame 44
    assert snd.sent[-1][0] == 44
    assert tr.status()["index"] == 44 and tr.status()["playing"] is True


def test_paused_transport_holds_the_frame_at_the_paused_position():
    snd = RecordingSender()
    tr = Transport(snd, fps=40)
    tr.load(frames(100), fps=40)
    tr.set_clock(position=0.5, playing=False, now=10.0)
    tr.tick(now=10.0)
    tr.tick(now=12.0)
    assert [f[0] for f in snd.sent[-2:]] == [20, 20]    # refreshed, not advanced


def test_positive_offset_shows_earlier_frames_and_clamps_at_zero():
    snd = RecordingSender()
    tr = Transport(snd, fps=40)
    tr.load(frames(100), fps=40)
    tr.set_offset_ms(50)                       # lights later by 2 frames
    tr.set_clock(position=1.0, playing=True, now=0.0)
    tr.tick(now=0.0)
    assert snd.sent[-1][0] == 38
    tr.set_clock(position=0.0, playing=True, now=0.0)
    tr.tick(now=0.0)
    assert snd.sent[-1][0] == 0


def test_running_past_the_end_blacks_out_once_and_stops():
    snd = RecordingSender()
    tr = Transport(snd, fps=40)
    tr.load(frames(10), fps=40)
    tr.set_clock(position=0.0, playing=True, now=0.0)
    tr.tick(now=1.0)
    tr.tick(now=1.1)
    assert snd.blackouts == 1
    assert tr.status()["playing"] is False


def test_gain_scales_output_and_net_off_blacks_out_and_stops_sending():
    snd = RecordingSender()
    tr = Transport(snd, fps=40)
    tr.load(np.array([[200, 100, 0]] * 5, dtype=np.uint8), fps=40)
    tr.set_gain(0.5)
    tr.set_clock(position=0.0, playing=False, now=0.0)
    tr.tick(now=0.0)
    assert snd.sent[-1] == [100, 50, 0]
    tr.set_net(False)
    assert snd.blackouts == 1
    n = len(snd.sent)
    tr.tick(now=0.1)
    assert len(snd.sent) == n                  # nothing on the wire
    assert tr.status()["rgb"] == [100, 50, 0]  # but the preview still tracks


def test_status_reports_position_and_settings():
    tr = Transport(RecordingSender(), fps=40)
    tr.load(frames(400), fps=40)
    tr.set_offset_ms(-20)
    tr.set_clock(position=2.0, playing=True, now=100.0)
    st = tr.status(now=101.0)
    assert st["position"] == pytest.approx(3.0)
    assert st["offset_ms"] == -20 and st["duration"] == pytest.approx(10.0)
    assert st["loaded"] is True


def _rig_frames(n):
    # 41-wide frames: PAR@1 rgb ramps, head pan fixed 169, head dim 200
    fr = np.zeros((n, 41), dtype=np.uint8)
    fr[:, 1:4] = 200
    fr[:, 28] = 169          # ch29 pan
    fr[:, 33] = 200          # ch34 dimmer
    return fr


def test_gain_applies_only_to_masked_intensity_channels():
    snd = RecordingSender()
    tr = Transport(snd, fps=40)
    mask = np.zeros(41, dtype=bool); mask[1:4] = True; mask[33] = True
    tr.load(_rig_frames(10), fps=40, gain_mask=mask)
    tr.set_gain(0.5)
    tr.set_clock(position=0.0, playing=False, now=0.0)
    tr.tick(now=0.0)
    sent = snd.sent[-1]
    assert sent[1:4] == [100, 100, 100] and sent[33] == 100
    assert sent[28] == 169                                      # pan untouched by gain


def test_blackout_and_end_of_stream_send_the_park_frame_not_zeros():
    class ParkSender(RecordingSender):
        def blackout(self, repeats=5, pause=0.02, frame=None):
            self.blackouts += 1; self.sent.append(list(frame) if frame is not None else [0, 0, 0])
    snd = ParkSender()
    park = [0] * 41; park[28] = 169; park[30] = 127
    tr = Transport(snd, fps=40)
    tr.load(_rig_frames(4), fps=40, park=park)
    tr.blackout()
    assert snd.sent[-1][28] == 169 and snd.sent[-1][30] == 127
    tr.set_clock(position=0.0, playing=True, now=0.0)
    tr.tick(now=5.0)                                            # past the end
    assert snd.blackouts == 2 and snd.sent[-1][28] == 169


def test_idle_transport_keeps_sending_the_park_frame():
    snd = RecordingSender()
    park = [0] * 41; park[28] = 169
    tr = Transport(snd, fps=40, park=park)
    tr.tick(now=0.0)                                            # nothing loaded yet
    assert snd.sent[-1][28] == 169
    tr.load(_rig_frames(4), fps=40, park=park)
    tr.tick(now=1.0)                                            # loaded, never started
    assert snd.sent[-1][28] == 169 and snd.sent[-1][33] == 0


def test_nudge_shifts_the_playhead_while_playing():
    snd = RecordingSender()
    tr = Transport(snd, fps=40)
    tr.load(_rig_frames(400), fps=40)
    tr.play(position=2.0, now=100.0)
    tr.nudge(+0.5, now=101.0)
    assert tr.status(now=101.0)["position"] == pytest.approx(3.5)
    assert tr.status()["playing"] is True
    tr.nudge(-10.0, now=101.0)
    assert tr.status(now=101.0)["position"] == 0.0


def test_output_loop_survives_a_sender_error_and_keeps_going():
    """Unplugging the Ethernet cable makes sendto raise OSError; the loop must not die
    (a dead loop = no DMX = the head runs its own auto-program)."""
    import threading, time as _time

    class FlakySender(RecordingSender):
        def __init__(self):
            super().__init__(); self.fail = True; self.errors = 0
        def send(self, v):
            if self.fail:
                self.errors += 1; raise OSError(101, "Network is unreachable")
            super().send(v)

    snd = FlakySender()
    tr = Transport(snd, fps=200, park=[0] * 41)
    stop = threading.Event()
    th = threading.Thread(target=tr.run_forever, args=(stop,), daemon=True); th.start()
    _time.sleep(0.15)
    assert th.is_alive() and snd.errors > 0                     # kept ticking through the errors
    snd.fail = False
    _time.sleep(0.15)
    stop.set(); th.join(timeout=1)
    assert len(snd.sent) > 5                                    # resumed sending once the link was back
    assert tr.status()["send_errors"] >= snd.errors


def test_after_the_stream_ends_the_transport_keeps_sending_the_park_frame():
    """A finished song must not go silent: DMX silence hands the head to its auto-program."""
    snd = RecordingSender()
    park = [0] * 41; park[28] = 169; park[30] = 127
    tr = Transport(snd, fps=40, park=park)
    tr.load(_rig_frames(4), fps=40, park=park)
    tr.set_clock(position=0.0, playing=True, now=0.0)
    tr.tick(now=5.0)                                            # runs past the end -> stops
    n = len(snd.sent)
    tr.tick(now=6.0); tr.tick(now=7.0)
    assert len(snd.sent) == n + 2
    assert snd.sent[-1][28] == 169 and snd.sent[-1][30] == 127 and snd.sent[-1][33] == 0
    tr.pause(now=8.0); tr.seek(99.0, now=8.0)                   # paused beyond the end: same
    tr.tick(now=9.0)
    assert snd.sent[-1][28] == 169
