#!/usr/bin/env python3
"""What survives validate_edits, and where describe_edits says it landed.

Runs in-process against server.py; no socket is opened and no bake is started."""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import server  # noqa: E402

PASS = FAIL = 0


def ok(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  ok   %s" % name)
    else:
        FAIL += 1
        print("  FAIL %s  %s" % (name, detail))


def one(**kw):
    """A single validated edit, or None when it was dropped."""
    out = server.validate_edits([kw])
    return out[0] if out else None


print("validate_edits")
ok("a known effect survives", one(type="impact", bar=17, beats=1) is not None)
ok("an unknown effect is dropped", one(type="nonesuch", bar=1, beats=1) is None)
ok("beat defaults to 1", one(type="impact", bar=17, beats=1)["beat"] == 1)
ok("beat is carried through", one(type="impact", bar=17, beat=3, beats=1)["beat"] == 3)
ok("beat below 1 is clamped up", one(type="impact", bar=17, beat=0, beats=1)["beat"] == 1)
ok("beat above 16 is clamped down", one(type="impact", bar=17, beat=99, beats=1)["beat"] == 16)
ok("beats is clamped to at least 1", one(type="impact", bar=1, beats=0)["beats"] == 1)
ok("beats is clamped to at most 256", one(type="impact", bar=1, beats=9999)["beats"] == 256)

print("describe_edits")
# 120 bpm, 4/4, first beat at 0 -> one beat is 0.5s, one bar is 2s.
seconds_at = lambda bar, beat=1: (bar - 1) * 2.0 + (beat - 1) * 0.5
rows = server.describe_edits(
    [{"type": "impact", "bar": 3, "beat": 1, "beats": 2},
     {"type": "impact", "bar": 3, "beat": 3, "beats": 2}],
    40, seconds_at, 4, 10_000)
ok("bar 3 beat 1 lands at 4.0s", rows[0]["from_s"] == 4.0, rows[0])
ok("two beats last 1.0s", rows[0]["to_s"] == 5.0, rows[0])
ok("bar 3 beat 3 lands at 5.0s", rows[1]["from_s"] == 5.0, rows[1])
ok("frames follow from seconds", rows[0]["from_frame"] == 160, rows[0])

print("dial_filter")
ok("an allowed choice is kept",
   server.dial_filter("white_blast", {"coverage": "outer"}) == {"coverage": "outer"})
ok("a choice outside the list is dropped",
   server.dial_filter("white_blast", {"coverage": "sideways"}) == {})
ok("a dial the renderer does not read is dropped",
   server.dial_filter("blackout", {"coverage": "outer"}) == {})
ok("a numeric dial is clamped to 0..1",
   server.dial_filter("white_blast", {"strength": 5}) == {"strength": 1.0})
ok("a non-numeric value for a numeric dial is dropped",
   server.dial_filter("white_blast", {"strength": "loud"}) == {})
ok("an unknown effect type allows nothing",
   server.dial_filter("laser_sweep", {"strength": 1}) == {})

print("validate_edits params")
ok("params survive validation",
   one(type="stab", bar=1, beats=1, params={"extent": "outer"})["params"]
   == {"extent": "outer"})
ok("a dial the effect's renderer type cannot read leaves no params behind",
   "params" not in one(type="cut", bar=1, beats=1, params={"extent": "outer"}))
ok("an edit with no params carries none",
   "params" not in one(type="stab", bar=1, beats=1))

print("validate_edits off")
ok("off survives as a boolean", one(type="stab", bar=1, beats=1, off=True)["off"] is True)
ok("off absent stays absent", "off" not in one(type="stab", bar=1, beats=1))
ok("off false is treated as absent", "off" not in one(type="stab", bar=1, beats=1, off=False))

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
