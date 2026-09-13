import io
import shutil
import struct
import threading

import numpy as np
import pytest
import soundfile as sf

from audio_out import wav_header, AudioPlayer, feed_pcm


def test_wav_header_describes_remaining_pcm():
    h = wav_header(n_frames=1000, sr=44100, channels=2)
    assert len(h) == 44
    assert h[:4] == b"RIFF" and h[8:12] == b"WAVE" and h[36:40] == b"data"
    assert struct.unpack("<I", h[40:44])[0] == 1000 * 2 * 2          # data bytes
    assert struct.unpack("<I", h[4:8])[0] == 36 + 1000 * 2 * 2       # riff size
    assert struct.unpack("<H", h[22:24])[0] == 2                     # channels
    assert struct.unpack("<I", h[24:28])[0] == 44100                 # rate
    assert struct.unpack("<H", h[34:36])[0] == 16                    # bits


def test_feed_pcm_streams_header_then_samples_from_position(tmp_path):
    sr = 8000
    ramp = (np.arange(sr) % 1000).astype(np.int16)                  # 1 s, recognisable values
    path = tmp_path / "t.wav"
    sf.write(path, np.stack([ramp, ramp], axis=1), sr, subtype="PCM_16")
    sink = io.BytesIO()
    feed_pcm(str(path), start_frame=4000, sink=sink, stop=threading.Event(), block=512)
    data = sink.getvalue()
    assert data[:4] == b"RIFF"
    n_remaining = sr - 4000
    assert struct.unpack("<I", data[40:44])[0] == n_remaining * 2 * 2
    first = np.frombuffer(data[44:44 + 8], dtype=np.int16)
    assert list(first) == [4000 % 1000, 4000 % 1000, 4001 % 1000, 4001 % 1000]
    assert len(data) == 44 + n_remaining * 4


def test_feed_pcm_stops_early_when_asked(tmp_path):
    sr = 8000
    path = tmp_path / "t.wav"
    sf.write(path, np.zeros((sr * 5, 1), dtype=np.int16), sr, subtype="PCM_16")

    class StopAfterOne(io.BytesIO):
        def __init__(self, ev):
            super().__init__(); self.ev = ev
        def write(self, b):
            self.ev.set(); return super().write(b)

    ev = threading.Event()
    sink = StopAfterOne(ev)
    feed_pcm(str(path), start_frame=0, sink=sink, stop=ev, block=256)
    assert len(sink.getvalue()) < sr * 5 * 2                          # bailed out early


@pytest.mark.skipif(not shutil.which("pw-play"), reason="pw-play not installed")
def test_audio_player_starts_and_stops_a_real_process(tmp_path):
    sr = 44100
    path = tmp_path / "s.wav"
    sf.write(path, np.zeros((sr * 3, 2), dtype=np.int16), sr, subtype="PCM_16")   # 3 s silence
    p = AudioPlayer(str(path))
    assert p.duration == pytest.approx(3.0)
    p.start(1.0)
    assert p.running
    p.stop()
    assert not p.running


def test_source_for_position_is_the_original_at_zero_and_a_trimmed_wav_otherwise(tmp_path):
    from audio_out import AudioPlayer
    sr = 8000
    ramp = (np.arange(sr * 2) % 1000).astype(np.int16)
    path = tmp_path / "t.wav"
    sf.write(path, np.stack([ramp, ramp], axis=1), sr, subtype="PCM_16")
    p = AudioPlayer(str(path))
    assert p.source_for(0.0) == str(path)
    src = p.source_for(1.0)
    assert src != str(path) and src.endswith(".wav")
    info = sf.info(src)
    assert info.samplerate == sr and info.channels == 2 and info.frames == sr     # header carries the real rate
    data, _ = sf.read(src, dtype="int16")
    assert list(data[0]) == [8000 % 1000, 8000 % 1000]
    p.cleanup()
    assert not __import__("os").path.exists(src)


def test_concurrent_starts_leave_no_orphan_processes(tmp_path):
    """Two seeks racing (ThreadingHTTPServer) must not leave a second player running."""
    import threading
    from audio_out import AudioPlayer

    class FakeProc:
        alive = []
        def __init__(self, cmd, **kw):
            self.dead = False; FakeProc.alive.append(self)
        def poll(self): return 0 if self.dead else None
        def kill(self): self.dead = True
        def wait(self, timeout=None): return 0

    sr = 8000
    path = tmp_path / "t.wav"
    sf.write(path, np.zeros((sr * 2, 2), dtype=np.int16), sr, subtype="PCM_16")
    p = AudioPlayer(str(path), popen=FakeProc)
    threads = [threading.Thread(target=p.start, args=(0.5 * i,)) for i in range(6)]
    for th in threads: th.start()
    for th in threads: th.join()
    assert sum(not fp.dead for fp in FakeProc.alive) == 1          # exactly one player alive
    p.stop()
    assert all(fp.dead for fp in FakeProc.alive)
