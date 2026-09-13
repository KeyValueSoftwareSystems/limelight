import json
import threading
import urllib.request
import urllib.error

import numpy as np
import pytest
import soundfile as sf

from server import make_server


class FakeSender:
    def __init__(self):
        self.sent = []

    def send(self, v):
        self.sent.append([int(x) for x in v])

    def blackout(self, repeats=5, pause=0.02, frame=None):
        self.sent.append(list(frame) if frame is not None else [0, 0, 0])


class FakeAudio:
    instances = []

    def __init__(self, path):
        self.path, self.calls, self.running = path, [], False
        FakeAudio.instances.append(self)

    def start(self, position):
        self.calls.append(("start", round(position, 3))); self.running = True

    def stop(self):
        self.calls.append(("stop",)); self.running = False


@pytest.fixture
def site(tmp_path):
    sf.write(tmp_path / "song.cache.wav", np.zeros((2205, 2), dtype="float32"), 22050, subtype="PCM_16")
    (tmp_path / "song.lights.json").write_text(json.dumps({
        "source": "song.mp3", "wav": "song.cache.wav", "style": "pulse", "fps": 40,
        "duration": 0.1, "tempo": 120.0, "beats": [0.0, 0.05], "downbeats": [0.0],
        "sections": [0.0], "frames": [[255, 0, 0], [0, 255, 0], [0, 0, 255], [9, 9, 9]]}))
    sender = FakeSender()
    httpd, transport, stop = make_server("127.0.0.1", 0, [str(tmp_path)], sender, fps=40,
                                         audio_factory=FakeAudio)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    base = f"http://127.0.0.1:{httpd.server_address[1]}"
    yield base, sender, transport
    stop.set()
    httpd.shutdown()


def get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req) as r:
        return r.status, dict(r.headers), r.read()


def post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return r.status, json.loads(r.read())


def test_index_serves_the_ui_page(site):
    base, *_ = site
    status, headers, body = get(base + "/")
    assert status == 200 and "text/html" in headers["Content-Type"]
    assert b"<title>" in body


def test_tracks_hides_pre_rig_streams(site):
    """3-channel single-PAR streams predate the 4-PAR + head rig and would drive the wrong
    channels; they are loadable by name but never listed."""
    base, *_ = site
    _, _, body = get(base + "/api/tracks")
    assert json.loads(body)["tracks"] == []


def test_load_returns_metadata_and_arms_the_transport(site):
    base, _, transport = site
    _, meta = post(base + "/api/load", {"name": "song.lights.json"})
    assert meta["beats"] == [0.0, 0.05] and meta["fps"] == 40
    assert meta["audio_url"] == "/audio/song.lights.json"
    assert transport.status()["loaded"] is True
    _, _, body = get(base + "/api/status")
    assert json.loads(body)["track"] == "song.lights.json"


def test_audio_endpoint_supports_range_requests(site):
    base, *_ = site
    status, headers, full = get(base + "/audio/song.lights.json")
    assert status == 200 and headers["Content-Type"] == "audio/wav"
    assert int(headers["Content-Length"]) == len(full) > 44
    status, headers, part = get(base + "/audio/song.lights.json", {"Range": "bytes=10-19"})
    assert status == 206 and len(part) == 10 and part == full[10:20]
    assert headers["Content-Range"] == f"bytes 10-19/{len(full)}"


def test_play_pause_seek_drive_audio_and_clock(site):
    base, sender, transport = site
    post(base + "/api/load", {"name": "song.lights.json"})
    audio = FakeAudio.instances[-1]
    assert audio.path.endswith("song.cache.wav")          # wav is what we play, mp3 is absent
    _, st = post(base + "/api/play", {"position": 0.025})
    assert st["playing"] is True and audio.calls[-1] == ("start", 0.025)
    _, st = post(base + "/api/pause", {})
    assert st["playing"] is False and audio.calls[-1] == ("stop",)
    assert st["position"] == pytest.approx(0.025, abs=0.02)
    _, st = post(base + "/api/seek", {"position": 0.05})
    assert st["position"] == pytest.approx(0.05) and st["playing"] is False
    _, st = post(base + "/api/stop", {})
    assert st["position"] == 0 and st["playing"] is False
    parked = sender.sent[-1]                                   # narrow stream embedded in the park frame
    assert len(parked) == 41 and parked[:3] == [0, 0, 0] and parked[28] == 169 and parked[30] == 127


def test_settings_apply_offset_gain_and_net(site):
    base, sender, transport = site
    post(base + "/api/load", {"name": "song.lights.json"})
    post(base + "/api/seek", {"position": 0.05})
    _, st = post(base + "/api/settings", {"offset_ms": 25, "gain": 0.5, "net": False})
    assert st["offset_ms"] == 25 and st["gain"] == 0.5 and st["net"] is False
    transport.tick()
    assert transport.status()["rgb"] == [0, 128, 0]      # 0.05 s minus 25 ms offset -> frame 1, gain 0.5


def test_unknown_track_is_404(site):
    base, *_ = site
    with pytest.raises(urllib.error.HTTPError) as e:
        post(base + "/api/load", {"name": "nope.lights.json"})
    assert e.value.code == 404


@pytest.fixture
def rig_site(tmp_path):
    frames = [[0] * 41 for _ in range(200)]                    # 5 s @ 40 fps
    for f in frames:
        f[0] = 255; f[1] = 200                                 # PAR@1 dim + red
        f[28] = 169; f[30] = 60; f[33] = 180                   # head pan, tilt, dimmer
    (tmp_path / "Faded (guess).lights.json").write_text(json.dumps({
        "source": "Faded guess", "wav": None, "style": "concert", "fps": 40, "duration": 5.0,
        "tempo": 90.0, "rig": "universe0-4par-head", "beats": [i * 60 / 90 for i in range(8)],
        "downbeats": [0.0, 8 / 3], "sections": [0.0, 2.0],
        "phases": [{"start": 0.0, "end": 2.0, "phase": "intro"}, {"start": 2.0, "end": 5.0, "phase": "drop"}],
        "frames": frames}))
    sender = FakeSender()
    httpd, transport, stop = make_server("127.0.0.1", 0, [str(tmp_path)], sender, fps=40, audio_factory=FakeAudio)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}", sender, transport
    stop.set(); httpd.shutdown()


def test_rig_stream_loads_without_audio_and_plays_on_the_clock(rig_site):
    base, sender, transport = rig_site
    _, meta = post(base + "/api/load", {"name": "Faded (guess).lights.json"})
    assert meta["audio_url"] is None and meta["phases"][1]["phase"] == "drop"
    _, st = post(base + "/api/play", {"position": 2.5})
    assert st["playing"] is True and st["audio"] is False
    transport.tick()
    sent = sender.sent[-1]
    assert len(sent) == 41 and sent[28] == 169 and sent[33] == 180


def test_gain_on_rig_stream_leaves_pan_tilt_alone(rig_site):
    base, sender, transport = rig_site
    post(base + "/api/load", {"name": "Faded (guess).lights.json"})
    post(base + "/api/seek", {"position": 1.0})
    post(base + "/api/settings", {"gain": 0.5})
    transport.tick()
    sent = sender.sent[-1]
    assert sent[1] == 100 and sent[33] == 90 and sent[28] == 169 and sent[30] == 60


def test_status_reports_phase_and_fixture_readouts(rig_site):
    base, sender, transport = rig_site
    post(base + "/api/load", {"name": "Faded (guess).lights.json"})
    post(base + "/api/seek", {"position": 3.0})
    transport.tick()
    _, _, body = get(base + "/api/status")
    st = json.loads(body)
    assert st["phase"] == "drop"
    assert st["fixtures"]["pars"][0]["rgb"] == [200, 0, 0] and st["fixtures"]["pars"][0]["addr"] == 1
    assert st["fixtures"]["head"]["pan"] == 169 and st["fixtures"]["head"]["tilt"] == 60 and st["fixtures"]["head"]["dim"] == 180


def test_nudge_endpoint_shifts_the_playhead(rig_site):
    base, sender, transport = rig_site
    post(base + "/api/load", {"name": "Faded (guess).lights.json"})
    post(base + "/api/play", {"position": 1.0})
    _, st = post(base + "/api/nudge", {"delta": 0.5})
    assert st["position"] == pytest.approx(1.5, abs=0.05) and st["playing"] is True


def test_stop_on_rig_stream_sends_parked_head_not_zeros(rig_site):
    base, sender, transport = rig_site
    post(base + "/api/load", {"name": "Faded (guess).lights.json"})
    post(base + "/api/play", {"position": 1.0})
    post(base + "/api/stop", {})
    park = sender.sent[-1]
    assert len(park) == 41 and park[28] == 169 and park[30] == 127 and park[33] == 0


def test_playback_pauses_when_the_page_stops_polling(tmp_path):
    import time as _time
    frames = [[0] * 41 for _ in range(400)]
    (tmp_path / "w.lights.json").write_text(json.dumps({"source": "w", "wav": None, "style": "concert", "fps": 40,
        "duration": 10.0, "tempo": 90.0, "beats": [], "downbeats": [], "sections": [0.0], "phases": [], "frames": frames}))
    sender = FakeSender()
    httpd, transport, stop = make_server("127.0.0.1", 0, [str(tmp_path)], sender, fps=40,
                                         audio_factory=FakeAudio, watchdog_s=0.4)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{httpd.server_address[1]}"
    try:
        post(base + "/api/load", {"name": "w.lights.json"})
        _, st = post(base + "/api/play", {"position": 0.0})
        assert st["playing"] is True
        get(base + "/api/status")                                   # page is alive
        _time.sleep(0.25)
        assert json.loads(get(base + "/api/status")[2])["playing"] is True   # still polled recently
        _time.sleep(1.0)                                            # page closed: no polls
        assert transport.status()["playing"] is False               # watchdog paused it
    finally:
        stop.set(); httpd.shutdown()


def test_server_default_offset_is_applied_to_the_transport(tmp_path):
    sender = FakeSender()
    httpd, transport, stop = make_server("127.0.0.1", 0, [str(tmp_path)], sender, fps=40,
                                         audio_factory=FakeAudio, offset_ms=-240)
    try:
        assert transport.status()["offset_ms"] == -240
    finally:
        stop.set(); httpd.server_close()          # serve_forever never ran: shutdown() would block forever


def test_old_narrow_streams_are_hidden_from_the_list_and_embedded_in_park_if_loaded(rig_site, tmp_path):
    base, sender, transport = rig_site
    (tmp_path / "old.lights.json").write_text(json.dumps({"source": "old.wav", "wav": None, "style": "pulse", "fps": 40,
        "duration": 0.1, "beats": [], "downbeats": [], "sections": [0.0], "frames": [[255, 0, 0]] * 4}))
    names = [t["name"] for t in json.loads(get(base + "/api/tracks")[2])["tracks"]]
    assert "old.lights.json" not in names and "Faded (guess).lights.json" in names
    _, meta = post(base + "/api/load", {"name": "old.lights.json"})     # still loadable by name
    assert meta["width"] == 41
    post(base + "/api/seek", {"position": 0.0})
    transport.tick()
    sent = sender.sent[-1]
    assert sent[0] == 255 and sent[28] == 169 and sent[30] == 127         # PAR data kept, head parked, not zeroed


def test_reloading_the_current_track_is_a_no_op_while_playing(rig_site):
    """Two open pages used to ping-pong /api/load on every version bump, and each load reset
    the transport: playback died half a second after Play."""
    base, sender, transport = rig_site
    _, m1 = post(base + "/api/load", {"name": "Faded (guess).lights.json"})
    post(base + "/api/play", {"position": 1.0})
    _, m2 = post(base + "/api/load", {"name": "Faded (guess).lights.json"})
    assert m2["version"] == m1["version"]
    st = json.loads(get(base + "/api/status")[2])
    assert st["playing"] is True and st["position"] >= 1.0
    _, m3 = post(base + "/api/load", {"name": "Faded (guess).lights.json", "force": True})
    assert m3["version"] == m1["version"] + 1 and transport.status()["playing"] is False


def test_effects_catalogue_endpoint_lists_the_library(site):
    base, _, _ = site
    _, _, body = get(base + "/api/effects")
    effects = json.loads(body)["effects"]
    assert len(effects) >= 25
    assert {e["layer"] for e in effects} == {"par", "head", "event"}
    e = next(x for x in effects if x["name"] == "ripple_hits")
    assert e["suits"]["drop"] == 1.0 and e["doc"]


def test_plan_and_activity_pass_through_to_the_track_metadata(tmp_path):
    from concert import park_frame
    plan = {"score": "x", "seed": 1, "cues": [{"i": 0, "role": "drop", "role_key": "final_drop", "from_s": 0.0, "to_s": 0.1,
                                                "from_bar": 0, "to_bar": 1, "par": "ripple_hits", "head": "figure8",
                                                "events": ["drop_hit"], "params": {"palette": "chord"}}],
            "activity": {"drop_hit": [[0.0, 0.05]]}}
    (tmp_path / "x.lights.json").write_text(json.dumps({
        "rig": "universe0-4par-head", "style": "score", "fps": 40, "duration": 0.1, "tempo": 128.0,
        "beats": [0.0, 0.05], "downbeats": [0.0], "sections": [0.0],
        "phases": [{"start": 0.0, "end": 0.1, "phase": "final_drop"}], "plan": plan, "score_bar_shift": -1,
        "frames": [park_frame() for _ in range(4)]}))
    httpd, transport, stop = make_server("127.0.0.1", 0, [str(tmp_path)], FakeSender(), fps=40, audio_factory=FakeAudio)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{httpd.server_address[1]}"
    try:
        req = urllib.request.Request(base + "/api/load", data=json.dumps({"name": "x.lights.json"}).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req) as r:
            meta = json.load(r)
        assert meta["plan"]["cues"][0]["par"] == "ripple_hits" and meta["plan"]["activity"]["drop_hit"] == [[0.0, 0.05]]
        assert meta["score_bar_shift"] == -1 and meta["phases"][0]["phase"] == "final_drop"
        _, _, body = get(base + "/api/meta")
        assert json.loads(body)["plan"]["cues"][0]["role_key"] == "final_drop"
    finally:
        stop.set(); httpd.shutdown()
