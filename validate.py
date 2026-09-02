#!/usr/bin/env python3
"""Is this a legal map? Run this before you show anyone anything.

    python3 validate.py maps/the-nights.map.json

Every check here exists because a downstream reader breaks without it. Passing
this does not mean the map is *right* -- that is what the bench is for -- it
means the map is *readable*. Exit 0 means Dheeraj's renderer will not crash.
"""
import json, sys

KINDS = {"build", "drop", "stop", "quiet", "spotlight", "return"}
RISES = {"steady", "late", "early", "stepped"}
HOWS  = {"truth", "model", "sketch", "hand-written"}

def check(m):
    e, w = [], []
    A = lambda c, msg: None if c else e.append(msg)
    W = lambda c, msg: None if c else w.append(msg)

    for k in ("map", "song", "made_by", "beats", "downbeats", "chapters", "moments", "confidence"):
        A(k in m, f"missing required field: {k}")
    if e: return e, w

    # A truth file may be PARTIAL. `null` is a legitimate answer and is worth more than a
    # guess, so a half-filled truth file is a valid artifact -- the bench scores per field
    # and simply scores less. A model, by contrast, has no excuse for a null.
    is_truth = m["made_by"].get("how") == "truth"
    blank = [k for k in ("beats", "downbeats", "chapters", "moments", "spans", "energy")
             if m.get(k) in (None, [])]
    if blank:
        if is_truth:
            for k in blank: w.append(f"{k}: null — awaiting a human. Not an error in a truth file")
        else:
            for k in ("beats", "downbeats", "chapters") :
                if k in blank: e.append(f"{k} is null, and this is not a truth file")

    song = m["song"]
    A(isinstance(song.get("length"), (int, float)) and song["length"] > 0, "song.length must be a positive number")
    A(m["made_by"].get("how") in HOWS, f"made_by.how must be one of {sorted(HOWS)}, got {m['made_by'].get('how')!r}")
    A(isinstance(m["confidence"], (int, float)) and 0 <= m["confidence"] <= 1, "confidence must be 0-1")

    L = song.get("length", 0)
    b = m.get("beats") or []
    if b: A(len(b) > 1, "beats: need at least two")
    if len(b) > 1:
        A(all(b[i] < b[i+1] for i in range(len(b)-1)), "beats must be strictly increasing")
        A(all(0 <= x <= L + 0.5 for x in b), "a beat falls outside the song length -- are these seconds, or did you emit frames or ms?")
        gaps = [b[i+1]-b[i] for i in range(len(b)-1)]
        A(min(gaps) > 0.05, f"smallest beat gap is {min(gaps):.3f}s (1200 bpm) -- almost certainly wrong units")
        W(max(gaps) < 4.0, f"largest beat gap is {max(gaps):.2f}s -- a hole in the beat track, or a real pause?")
        cover = (b[-1] - b[0]) / L
        W(cover > 0.75, f"beats cover only {cover*100:.0f}% of the song")

    bs = set(round(x, 3) for x in b)
    d = m.get("downbeats") or []
    if b: A(all(round(x, 3) in bs for x in d), "every downbeat must also appear in beats")
    A(all(d[i] < d[i+1] for i in range(len(d)-1)), "downbeats must be strictly increasing")
    if not is_truth: W(len(d) > 0, "no downbeats -- a reader cannot find the bar")

    ch = m.get("chapters") or []
    if not is_truth: A(len(ch) > 0, "at least one chapter")
    A(all(ch[i]["at"] < ch[i+1]["at"] for i in range(len(ch)-1)), "chapters must be sorted by at")
    A(all("name" in c for c in ch), "every chapter needs a name")
    if ch: W(ch[0]["at"] == 0.0, "first chapter should start at 0.0 so every t is covered")

    for x in (m.get("moments") or []):
        A(x.get("kind") in KINDS, f"moment kind {x.get('kind')!r} is not one of the six")
        A(isinstance(x.get("at"), (int, float)), "every moment needs a numeric at")
        A(0 <= x.get("at", -1) <= L, f"moment at {x.get('at')} is outside the song")
        if x.get("kind") == "stop" and not is_truth:
            A("holds" in x, "a stop must say how long it holds")
        if x.get("kind") == "drop" and x.get("size") is None:
            (w if is_truth else w).append("a drop without size -- readers must guess how hard it hits")

    sp = m.get("spans") or []
    for s in sp:
        A(s.get("kind") in KINDS, f"span kind {s.get('kind')!r} is not one of the six")
        A(s.get("from", 0) < s.get("to", 0), f"span {s.get('kind')} has from >= to")
        A(0 <= s.get("from", -1) and s.get("to", L+1) <= L + 0.5, "span falls outside the song")
        if s.get("kind") == "build": A(s.get("rise") in RISES, f"a build span needs rise in {sorted(RISES)}, got {s.get('rise')!r}")
    for i in range(len(sp)):
        for j in range(i+1, len(sp)):
            a2, b2 = sp[i], sp[j]
            if a2["from"] < b2["to"] and b2["from"] < a2["to"]:
                e.append(f"spans overlap: {a2['kind']} {a2['from']}-{a2['to']} and {b2['kind']} {b2['from']}-{b2['to']}")
    if not is_truth: W(len(sp) > 0, "no spans -- an elevation cannot be expressed as a point")

    en = m.get("energy") or []
    if en:
        A(all(isinstance(p, list) and len(p) == 2 for p in en), "energy must be [[t, value], ...]")
        A(all(en[i][0] < en[i+1][0] for i in range(len(en)-1)), "energy points must be sorted by time")
        A(all(0 <= p[1] <= 1 for p in en), "energy values must be 0-1")
        W(len(en) >= len(d) * 0.8 if d else True, f"only {len(en)} energy points for {len(d)} downbeats")
    elif not is_truth:
        W(False, "no energy curve -- downstream readers have to fake the rise")

    v = m.get("vectors")
    if isinstance(v, dict):
        for k in ("model", "rate", "rows", "dim", "dtype", "file"):
            A(k in v, f"vectors.{k} is required once vectors are present")

    if m["made_by"].get("how") == "sketch":
        W(m["confidence"] <= 0.5, "a sketch claiming confidence above 0.5 is a lie waiting to happen")
    return e, w

if __name__ == "__main__":
    if len(sys.argv) < 2: print(__doc__); sys.exit(2)
    bad = 0
    for p in sys.argv[1:]:
        e, w = check(json.load(open(p)))
        print(f"\n{p}")
        for x in e: print(f"  ERROR  {x}")
        for x in w: print(f"  warn   {x}")
        if not e and not w: print("  clean")
        elif not e: print(f"  OK with {len(w)} warning(s)")
        bad += len(e)
    print()
    sys.exit(1 if bad else 0)
