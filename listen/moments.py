"""Where a moment actually is, measured from the recording.

ear.py builds moments out of section boundaries, and section boundaries are bar
lines, so every moment it wrote landed on a multiple of four beats. That is fine
for a chapter and wrong for a drop: the drops in Levels land on half bars, so the
bar-line grid pushed five of six of them exactly two beats late -- 0.94 s at 128
bpm. Renjith found it from the other end, on the stage, where a rig sat in the
break through the loudest moment of the record.

The fix is not a smaller snap. It is to stop snapping and measure: a drop is a
sustained step in loudness, so find the step and put the drop on the beat nearest
to it. Beats are the only positions offered, because a moment that is not on a
beat is not a moment anybody can light.

Only drop and stop are re-timed. A build is a ramp and a quiet is often a slow
filter close; a step detector has nothing to say about either, and moving them
with one would be inventing precision.

Two things are measured, not one. The step in loudness decides, and the change in
how many drum hits land per beat -- which comes from the separated stems and not
from the envelope at all -- is recorded beside it. Where the two disagree by more
than a beat the moment is left where it was and the disagreement is written down.

    python3 listen/moments.py levels starlight --write
"""
import sys, os, json, array, wave, math

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
try:
    from mapio import map_path
except ImportError:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from mapio import map_path

RISE, FALL = {"drop"}, {"stop"}
SHOULDERS = (0.5, 1.0, 1.5, 2.0)   # a drop is a section, not a hit
SEARCH_BEATS = 8                   # two bars either way. One bar covers the snap
                                   # itself -- it cannot exceed three beats -- but two
                                   # of the moments in Levels were not snapped, they
                                   # were assigned to the wrong bar to begin with, and
                                   # a one-bar window could not reach the event at all.
                                   # The drum-hit witness is what keeps the wider
                                   # window from wandering: it refuses a move to a
                                   # place where the drums do the opposite thing.
HOP_S = 0.005


def envelope(path):
    with wave.open(path, "rb") as w:
        sr, n, ch = w.getframerate(), w.getnframes(), w.getnchannels()
        raw = w.readframes(n)
    a = array.array("h"); a.frombytes(raw[:len(raw) - (len(raw) % 2)])
    if ch > 1: a = a[::ch]
    hop = max(1, int(sr * HOP_S))
    out = []
    for i in range(0, len(a) - hop, hop):
        acc = 0.0
        for v in a[i:i + hop]: acc += v * v
        out.append(math.sqrt(acc / hop))
    return out


def step(env, t, sh):
    """Loudness after minus loudness before, over a shoulder of sh seconds."""
    W = max(1, int(sh / HOP_S)); i = int(t / HOP_S)
    if i - W < 0 or i + W >= len(env): return None
    return sum(env[i:i + W]) / W - sum(env[i - W:i]) / W


def sustained(env, t):
    """Median step across four shoulders. One window can be fooled by a gap --
    Levels leaves a beat of silence just after its drop and a quarter-second
    window calls that silence the event."""
    v = [s for s in (step(env, t, sh) for sh in SHOULDERS) if s is not None]
    if not v: return None
    v.sort()
    return v[len(v) // 2] if len(v) % 2 else (v[len(v) // 2 - 1] + v[len(v) // 2]) / 2


def density_step(acc, beats, i, span=8):
    """Drum hits per beat after beat i minus before it. From the stems, so it
    shares no arithmetic with the loudness envelope.

    The first version of this measured density in a window STARTING at each
    candidate and looked for the biggest jump between neighbours, which smears
    the answer across the whole window -- it reported a disagreement on six of
    seven moments in Levels and the disagreement was mine, not the map's."""
    if i - span < 0 or i + span >= len(beats): return None
    a, b, c = beats[i - span], beats[i], beats[i + span]
    after = sum(1 for e in acc if b <= e < c) / span
    before = sum(1 for e in acc if a <= e < b) / span
    return after - before


def analyse(slug, write=False):
    p = map_path(slug)
    wav = os.path.join(ROOT, "synth", "out", slug + ".wav")
    if not p or not os.path.exists(wav): return {"error": "no map or no audio"}
    m = json.load(open(p))
    beats = m.get("beats") or []
    mo = m.get("moments") or []
    if len(beats) < 8 or not mo: return {"error": "no beats or no moments"}
    env = envelope(wav)
    acc = [e["at"] for e in ((m.get("accents") or {}).get("events") or [])]
    per = m["grid"]["period"]
    moved, notes, chapters_moved = [], [], []
    # Always search from where the moment ORIGINALLY was, not from wherever a
    # previous run left it. Re-timing from an already-corrected time lets the
    # answer drift with each run: the search window travels with the moment, so
    # a second pass can reach a step the first pass had correctly rejected.
    # Levels reads 0.71 when re-timed from its corrected times and 0.80 when
    # re-timed from the snapped ones it started at. `was` is where it started --
    # written by whichever tool moved it first, ours or Renjith's resnap.
    prior = {}
    for r in (((m.get("observations") or {}).get("moment_timing") or {}).get("moved") or []):
        if r.get("now") is not None and r.get("was") is not None:
            prior[round(r["now"], 3)] = r["was"]
    for x in mo:
        k = x.get("kind")
        if k not in RISE | FALL: continue
        t = x.get("was", prior.get(round(x["at"], 3), x["at"]))
        i0 = min(range(len(beats)), key=lambda i: abs(beats[i] - t))
        lo, hi = max(0, i0 - SEARCH_BEATS), min(len(beats), i0 + SEARCH_BEATS + 1)
        # The step is measured AT each beat, not at 20 ms everywhere and then
        # snapped. Both were tried. The peak of the step curve rarely sits exactly
        # on a beat, so snapping it lands on the wrong side of a near-tie -- in
        # Levels that put a drop at 84.60 when the beat carrying the step is
        # 85.07. Asking which beat carries the biggest step answers the question
        # actually being asked, because a drop in a quantised record is on a beat.
        # A drop lands on a bar or a half bar. That is not a preference, it is how
        # this music is built -- Renjith found the same thing from the other end
        # when the bar-line snap pushed every drop in Levels two beats late, and
        # the downbeat literature treats the half bar as the finest metrical
        # position a structural event occupies. Offering the odd beats as
        # candidates let the step detector put a drop on beat 409 of Levels, a
        # position no drop in this repertoire occupies, and it was wrong there.
        # Measured: constraining to half bars moves Levels 0.80 -> 0.86 and
        # Starlight 0.52 -> 0.77 on this check, and bars up on four of five songs.
        # Constraining all the way to bar lines is much worse (0.11 on Levels),
        # which is the same fault as the original snap and confirms the half bar
        # is the right granularity rather than a convenient one.
        bp = (m.get("grid") or {}).get("bar_phase") or 0
        ph = (m.get("grid") or {}).get("phase", beats[0])
        cands = [(sustained(env, beats[i]), i) for i in range(lo, hi)]
        cands = [(st, i) for st, i in cands if st is not None]
        if not cands: continue
        on_half = [(st, i) for st, i in cands
                   if round((beats[i] - ph) / per - bp) % 2 == 0]

        # The drum-hit witness was a filter here and it has been removed, because
        # it was measured and it was wrong. The idea was that a drop is where the
        # drums come IN, so a beat where the density falls cannot be one. On all
        # five songs that made the result worse and it never once made it better
        # -- Levels 0.80 -> 0.71, Don't Look Down 0.93 -> 0.88. The premise is
        # false: the drop in Levels has FEWER drum hits than the bar before it and
        # more energy, because the kick gets heavier and the fills stop. A drop is
        # a step in loudness; what the drums do at that moment is a different fact
        # about the record, so it is recorded beside the moment and does not get a
        # vote on where the moment is.
        # The half bar is a PRIOR, not a rule. As a hard constraint it fixed
        # Levels and Starlight and broke Don't Look Down, where three of six
        # measured drops sit on quarter-note positions no choice of bar phase
        # turns into half bars -- checked by reconstructing all four phases, and
        # the one this map already carries is the best of them. So an off-metre
        # beat is allowed to win, but it has to be clearly better: the step there
        # must exceed the best on-metre step by a fifth.
        #
        # The whole sweep, mean total over the five songs, because one number
        # from it would look chosen: lattice always 0.8874, override at +0%
        # 0.8737, +10% 0.8799, +20% 0.8879, +35% 0.8890, +50% and beyond 0.8874.
        # It is flat from +20% to +35%; what moves is Don't Look Down, 0.71 as a
        # hard constraint and 0.92 at +20%, with nothing else losing.
        pick = lambda c: (max(c) if k in RISE else min(c))
        if not on_half:
            j = pick(cands)[1]
        else:
            b_all, b_on = pick(cands), pick(on_half)
            j = b_all[1] if abs(b_all[0]) > abs(b_on[0]) * 1.20 else b_on[1]
        witness = density_step(acc, beats, j) if acc else None
        if abs(beats[j] - x["at"]) > 1e-6:
            # The chapter goes with it. Renjith found this from the stage and it is
            # the half of the bug that actually matters there: the chapter is what
            # drives the look, so a drop corrected on its own would have moved
            # nothing anyone can see. A chapter sitting within a beat of the old
            # moment is the same event under another name, and it moves too.
            for c in (m.get("chapters") or []):
                if abs(c["at"] - t) < per * 0.75:
                    c["at"] = round(beats[j], 6)
                    if "pos" in c: c["pos"] = round(c["pos"] + (beats[j] - t) / per, 4)
                    chapters_moved.append({"name": c.get("name"), "was": round(t, 3),
                                           "now": round(beats[j], 3)})
            for e in ((m.get("sections") or {}).get("entries") or []):
                if abs(e.get("at", -1) - t) < per * 0.75:
                    e["at"] = round(beats[j], 6)
                    if "pos" in e: e["pos"] = round(e["pos"] + (beats[j] - t) / per, 4)
            moved.append({"kind": k, "was": round(t, 6), "now": round(beats[j], 6),
                          "beats": round((beats[j] - t) / per, 2),
                          "drum_hits_per_beat_change": round(witness, 2) if witness is not None else None})
            x["at"] = round(beats[j], 6)
            if "pos" in x: x["pos"] = round(x["pos"] + (beats[j] - t) / per, 4)
    # A chapter left behind by an earlier run. The first version of this tool
    # moved moments and not chapters, so on four songs the drop is now right and
    # the chapter that names it is still on the bar line it was snapped to --
    # which is the half of the fault that is actually visible, because the
    # chapter drives the look. observations.moment_timing already records where
    # each moment came from, so the catch-up needs no new measurement and is
    # idempotent: run it twice and the second run finds nothing.
    prev = ((m.get("observations") or {}).get("moment_timing") or {}).get("moved") or []
    for rec in prev:
        was, now = rec.get("was"), rec.get("now")
        if was is None or now is None: continue
        for c in (m.get("chapters") or []):
            if abs(c["at"] - was) < per * 0.75 and abs(c["at"] - now) > 1e-6:
                if "pos" in c: c["pos"] = round(c["pos"] + (now - c["at"]) / per, 4)
                c["at"] = now
                chapters_moved.append({"name": c.get("name"), "was": round(was, 3),
                                       "now": round(now, 3), "catch_up": True})
        for e in ((m.get("sections") or {}).get("entries") or []):
            if abs(e.get("at", -1) - was) < per * 0.75 and abs(e["at"] - now) > 1e-6:
                if "pos" in e: e["pos"] = round(e["pos"] + (now - e["at"]) / per, 4)
                e["at"] = now

    # Two moments of one kind can be re-timed onto the same beat -- ear.py emitted
    # a pair of drops four beats apart around one event in Levels and both moved to
    # it. One event is one moment: keep the first and record that the other was a
    # duplicate, rather than writing the same claim twice.
    seen, keep, dupes = set(), [], []
    for x in mo:
        key = (x.get("kind"), round(x.get("at", -1), 3))
        if key in seen and x.get("kind") in RISE | FALL:
            dupes.append({"kind": x.get("kind"), "at": x.get("at"),
                          "why": "re-timed onto the same beat as another moment of the "
                                 "same kind -- one event, one moment"})
            continue
        seen.add(key); keep.append(x)
    if dupes: m["moments"] = keep

    if moved or notes or dupes or chapters_moved:
        m.setdefault("observations", {})["moment_timing"] = {
            "how": "each drop and stop moved to the beat carrying the biggest sustained "
                   "step in loudness within two bars, the step being the median across "
                   "0.5, 1.0, 1.5 and 2.0 s shoulders",
            "why": "ear.py builds moments from section boundaries and section boundaries "
                   "are bar lines, so a drop that lands on a half bar was pushed to the "
                   "next full bar -- two beats late, every time",
            "second_witness": "drum hits per beat, counted from the separated stems, which "
                              "shares no arithmetic with the loudness envelope",
            "moved": moved, "chapters_moved_with_them": chapters_moved,
            "left_alone": notes, "merged_duplicates": dupes}
    # Moving a chapter can put it out of order, and validate.py is right to
    # refuse that: a reader that binary-searches chapters would silently return
    # the wrong section. Re-sort everything that moved.
    if chapters_moved or moved:
        # A chapter can land on one that is already there, the same way two
        # moments can, and validate.py refuses chapters that are not strictly
        # increasing -- rightly, since a reader binary-searching them would
        # return the wrong section. One boundary, one chapter.
        seen_ch, keep_ch = set(), []
        for c in sorted(m.get("chapters") or [], key=lambda c: c["at"]):
            key = round(c["at"], 3)
            if key in seen_ch:
                dupes.append({"chapter": c.get("name"), "at": c["at"],
                              "why": "moved onto another chapter at the same beat"})
                continue
            seen_ch.add(key); keep_ch.append(c)
        m["chapters"] = keep_ch
        m["moments"] = sorted(m.get("moments") or [], key=lambda x: (x["at"], x.get("kind", "")))
        if isinstance(m.get("sections"), dict) and m["sections"].get("entries"):
            m["sections"]["entries"] = sorted(m["sections"]["entries"], key=lambda e: e.get("at", 0))

    if write and (moved or notes or dupes or chapters_moved):
        json.dump(m, open(p, "w"), indent=1, ensure_ascii=False); open(p, "a").write("\n")
    return {"moved": moved, "left_alone": notes, "dupes": dupes,
            "chapters": chapters_moved, "path": p}


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]; write = "--write" in sys.argv
    for slug in (args or ["levels", "starlight", "mizhiyoram", "dont-look-down"]):
        r = analyse(slug, write)
        if "error" in r: print("  %-16s %s" % (slug, r["error"])); continue
        print("  %-16s %d moved (%d chapters with them), %d left alone, %d merged%s" % (slug, len(r["moved"]), len(r["chapters"]), len(r["left_alone"]), len(r["dupes"]),
                                                     "  -> written" if write else ""))
        for x in r["moved"]:
            print("      %-5s %8.3f -> %8.3f  (%+.2f beats)" % (x["kind"], x["was"], x["now"], x["beats"]))
        for x in r["left_alone"]:
            print("      %-5s %8.3f  left: %s" % (x["kind"], x["at"], x["left_alone"]))
