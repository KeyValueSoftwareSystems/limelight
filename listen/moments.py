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


def low_envelope(path, cut_hz=130.0, hp_hz=35.0, poles=3):
    """Envelope of the kick's own band, at the same hop as `envelope`.

    WHY A SECOND ENVELOPE. The broadband one cannot see the thing that matters
    most in dance music: the beat dropping out while the pads keep playing. At
    255.99 in Where Are U Now the kick falls to 4% of its level and the
    broadband envelope barely moves, because the mid and high bands hold up.
    Every "the floor just disappeared" moment in the record is invisible to a
    full-spectrum measurement.

    Decimate first, then filter. A kick lives under 130 Hz, so averaging blocks
    of `dec` samples is both the anti-alias filter and the speed: it turns six
    million samples into a hundred and fifty thousand before any per-sample
    Python runs. The one-pole pair that follows is not a sharp filter and does
    not need to be -- the question is whether the low end is THERE, not its
    exact shape.
    """
    with wave.open(path, "rb") as w:
        sr, n, ch = w.getframerate(), w.getnframes(), w.getnchannels()
        raw = w.readframes(n)
    a = array.array("h"); a.frombytes(raw[:len(raw) - (len(raw) % 2)])
    if ch > 1: a = a[::ch]
    dec = max(1, int(sr / 525.0))
    dsr = sr / dec
    d = [0.0] * (len(a) // dec)
    for i in range(len(d)):
        acc = 0
        for v in a[i * dec:(i + 1) * dec]: acc += v
        d[i] = acc / dec
    def onepole(x, hz):
        k = math.exp(-2 * math.pi * hz / dsr); y = 0.0; out = [0.0] * len(x)
        for i, v in enumerate(x):
            y = k * y + (1 - k) * v; out[i] = y
        return out
    # Cascade the poles. ONE pole at 130 Hz is 6 dB/octave, which still passes
    # a quarter of what sits at 260 Hz -- enough sustained mid leaks through
    # that the kick leaving does not show as a fall, and the detector missed the
    # 0.53 s dropout at 256.08 that a person picked out as the best moment in
    # the record. Three poles put the same neighbour 18 dB down.
    lp = d
    for _ in range(poles): lp = onepole(lp, cut_hz)
    base = lp
    for _ in range(poles): base = onepole(base, hp_hz)   # below 35 Hz is not a kick
    band = [lp[i] - base[i] for i in range(len(lp))]
    # Return the hop actually used. int(525 * 0.005) truncates 2.625 to 2, so
    # assuming HOP_S here put a dropout at 404 s in a 306 s song -- every time
    # was 31% too large and nothing in the output looked wrong.
    hop = max(1, int(round(dsr * HOP_S)))
    dt = hop / dsr
    out = []
    for i in range(0, len(band) - hop, hop):
        acc = 0.0
        for v in band[i:i + hop]: acc += v * v
        out.append(math.sqrt(acc / hop))
    return out, dt


def local_median(env, dt, half_s=4.0):
    """Median level around each point, so a quiet passage is not read as a stop.

    Coarse grid on purpose: a true median over a 8-second window at every 5 ms
    hop is 60,000 sorts. Half-second means, then a median of those, answers the
    same question -- is this quiet FOR HERE -- at a thousandth of the cost."""
    step_n = max(1, int(round(0.5 / dt)))
    c = [sum(env[i:i + step_n]) / step_n
         for i in range(0, max(1, len(env) - step_n), step_n)]
    k = int(half_s / 0.5)
    med = []
    for i in range(len(c)):
        w = sorted(c[max(0, i - k):i + k + 1])
        med.append(w[len(w) // 2] if w else 0.0)
    out = []
    for i in range(len(env)):
        j = min(len(med) - 1, i // step_n)
        out.append(med[j] if med else 0.0)
    return out


STOP_RATIO = 0.30      # the low band, against the median of its own neighbourhood
STOP_MIN_S = 0.45      # shorter than this is a gap between kicks, not a stop
STOP_NEAR_S = 1.5      # a stop or quiet this close is the SAME event, redetected
SAME_EVENT_PAD_S = 0.25   # any moment inside the dropout itself is that dropout


def find_stops(wav, beats, existing, period):
    """Stops the section-boundary pass could not see, because they happen INSIDE
    a section.

    ear.py builds moments out of section boundaries. That is why the map had one
    moment in the twenty-six seconds a person picked out as the best part of the
    record: the breakdown at 255.5, the kick vanishing at 256.1 and the build
    back into the drop all happen inside one verse, so none of them could ever
    become a moment, however plainly the record performs them.

    A stop is not inferred here, it is measured: the low band falls under
    STOP_RATIO of its own neighbourhood median and stays there for at least
    STOP_MIN_S. The start is snapped to the nearest beat, for the same reason
    the re-timing pass snaps -- a moment that is not on a beat is not a moment
    anybody can light."""
    env, dt = low_envelope(wav)
    if not env: return [], []
    span = max(1, int(round(period / dt)))
    sm, run = [], 0.0
    for i, v in enumerate(env):
        run += v
        if i >= span: run -= env[i - span]
        sm.append(run / min(i + 1, span))
    med = local_median(sm, dt)
    found, declined, i, n = [], [], 0, len(sm)
    while i < n:
        if med[i] > 0 and sm[i] / med[i] < STOP_RATIO:
            j = i
            while j < n and med[j] > 0 and sm[j] / med[j] < STOP_RATIO: j += 1
            a, b = i * dt, j * dt
            if b - a >= STOP_MIN_S:
                # Two different tests, because "is this already recorded" and
                # "is this next to something else" are different questions. A
                # stop or a quiet within STOP_NEAR_S is this same dropout found
                # twice and must not be duplicated. A DROP just after the
                # dropout ends is not a duplicate at all -- it is what the
                # dropout was for, and cutting on both is the entire point. The
                # first version declined the 256.38 stop because a drop sat
                # 1.29 s later, which deleted the very event this pass exists
                # to find.
                owner = None
                for x in existing:
                    t_ = x["at"]; k_ = x.get("kind")
                    if a - SAME_EVENT_PAD_S <= t_ <= b + SAME_EVENT_PAD_S:
                        owner = (x, "inside the dropout"); break
                    if k_ in ("stop", "quiet") and abs(t_ - a) < STOP_NEAR_S:
                        owner = (x, "the same dropout, already recorded"); break
                depth = 1.0 - min(sm[i:j]) / (max(1e-9, med[i]))
                rec = {"at": None, "from": round(a, 3), "to": round(b, 3),
                       "depth": round(min(1.0, max(0.0, depth)), 3)}
                if owner:
                    rec["declined"] = ("a " + owner[0].get("kind", "?") + " at " +
                                       format(owner[0]["at"], ".2f") + " is " + owner[1])
                    declined.append(rec)
                elif beats:
                    # Snap to the nearest beat, but never past the middle of the
                    # dropout. The held-out Toyota track put a beat 1.07 s into
                    # a 1.14 s silence, and "nearest" declared the stop with
                    # 0.07 s left to hold -- a moment marking the end of the
                    # event it names. A moment is an onset, so when the nearest
                    # beat is in the second half, the one before it is the beat
                    # the event actually starts on.
                    mid = a + (b - a) / 2.0
                    cand = [t for t in beats if t <= mid] or beats
                    rec["at"] = round(min(cand, key=lambda t: abs(t - a)), 6)
                    found.append(rec)
            i = j
        else:
            i += 1
    return found, declined


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
    moved, notes, chapters_moved, spans_moved = [], [], [], []
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
        # A moment this file FOUND is not a moment this file needs to correct.
        # The re-timer exists because ear.py derives moments from section
        # boundaries and section boundaries are bar lines; a stop measured
        # directly from the low band was never snapped to anything, so there is
        # no snap to undo. Running the broadband step detector over it moved the
        # 256.24 stop to 255.28 -- a coarser method overwriting a finer one,
        # which is rule 8 with the two writers one function apart.
        if x.get("found_by"): continue
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
            for sp in (m.get("spans") or []):
                if abs(sp.get("to", -1) - t) < per * 1.5:
                    sp["to"] = round(beats[j], 6)
                    if "pos_to" in sp: sp["pos_to"] = round(sp["pos_to"] + (beats[j] - t) / per, 4)
                    spans_moved.append({"kind": sp.get("kind"), "edge": "to",
                                        "was": round(t, 3), "now": round(beats[j], 3)})
                if abs(sp.get("from", -1) - t) < per * 0.75:
                    sp["from"] = round(beats[j], 6)
                    if "pos_from" in sp: sp["pos_from"] = round(sp["pos_from"] + (beats[j] - t) / per, 4)
                    spans_moved.append({"kind": sp.get("kind"), "edge": "from",
                                        "was": round(t, 3), "now": round(beats[j], 3)})
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

    if moved or notes or dupes or chapters_moved or spans_moved:
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
            "spans_moved_with_them": spans_moved,
            "why_spans_move": "a build ends at the thing it builds into. Moving a drop and "
                              "leaving the span alone left Don't Look Down declaring a build "
                              "until 41.74 s when the drop it leads to had moved to 41.23 -- "
                              "a build that finishes after its own payoff. A reader ramping "
                              "through that span was still ramping when the drop had gone.",
            "left_alone": notes, "merged_duplicates": dupes}
    # Moving a chapter can put it out of order, and validate.py is right to
    # refuse that: a reader that binary-searches chapters would silently return
    # the wrong section. Re-sort everything that moved.
    # Finding, as distinct from re-timing. Everything above moves a moment that
    # ear.py already wrote; this adds the ones it could not write, because they
    # do not sit on a section boundary. Recorded separately so the two are never
    # confused: `moved` is a correction, `found` is new evidence.
    found, declined_stops = find_stops(wav, beats, mo, per)
    for r in found:
        # `holds` is required and validate.py is right to require it: a reader
        # that blacks out for a stop needs to know when to come back. The two
        # stops already in this map say 1.905 -- one bar, because that is what a
        # section-boundary pass can offer. This one is measured, so it says what
        # was measured.
        m["moments"].append({"at": r["at"], "kind": "stop",
                             "holds": round(r["to"] - r["at"], 3),
                             "size": r["depth"], "found_by": "low-band dropout"})
    if found or declined_stops:
        obs = m.setdefault("observations", {}).setdefault("moment_timing", {})
        obs["stops_found"] = {
            "how": ("low band 35-130 Hz, the band grid.how already names, under " + str(STOP_RATIO) + " of its own "
                    "neighbourhood median for at least " + str(STOP_MIN_S) + " s, "
                    "start snapped to the nearest beat"),
            "why": ("ear.py derives moments from section boundaries, so a stop "
                    "inside a section cannot become a moment however plainly the "
                    "record performs it. The broadband envelope cannot see these "
                    "either -- the kick leaves and the pads stay, so the level "
                    "barely moves."),
            "added": found, "declined": declined_stops}
        m["moments"] = sorted(m["moments"], key=lambda x: (x["at"], x.get("kind", "")))

    if chapters_moved or moved or spans_moved or found:
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

    if write and (moved or notes or dupes or chapters_moved or spans_moved or found):
        json.dump(m, open(p, "w"), indent=1, ensure_ascii=False); open(p, "a").write("\n")
    return {"moved": moved, "left_alone": notes, "dupes": dupes,
            "chapters": chapters_moved, "found": found,
            "declined": declined_stops, "path": p}


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
