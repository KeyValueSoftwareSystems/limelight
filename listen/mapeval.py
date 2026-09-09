#!/usr/bin/env python3
"""Score a MAP against the recording it claims to describe. Standard library only.

This is the harness for whoever produces maps -- Amal, Sebastian, Dheeraj, or a
model none of us has written yet -- and it deliberately contains no lights. The
ladder scores a SHOW, which mixes a map's quality with a recipe's, so a producer
handed a ladder number gets a score that moves when somebody else edits a
coefficient. This scores the map alone.

Every field is measured against the AUDIO, never against another map. That is the
one discipline that has survived this project: a check reading the same source as
the thing it checks will pass anything, and the only way to know a check works is
to feed it something deliberately wrong and watch it fail.

A field the map does not claim scores nothing at all -- not zero. Silence is not
a wrong answer, and conflating the two produces a leaderboard nobody can act on.

    python3 listen/mapeval.py levels                      the answer map
    python3 listen/mapeval.py levels --map synth/maps/amal/levels.map.json
    python3 listen/mapeval.py levels --all                every map for that song
    python3 listen/mapeval.py --every                     every song, every map

Results append to synth/learning/mapeval.jsonl, one line per run, so a producer
can see whether today's change actually helped.
"""
import hashlib
import sys, os, json, math, wave, array, datetime, glob

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# what each field is worth. Timing dominates because everything downstream of a
# wrong grid is wrong regardless of how good it is.
WEIGHTS = {"grid": 3.0, "bars": 2.0, "moments": 2.0, "downbeats": 1.5, "sections": 1.5,
           "energy": 1.5, "accents": 1.0, "chords": 1.0, "melody": 1.0, "stems": 1.0,
           "pump": 0.5}


def load(path, target_sr=11025):
    with wave.open(path, "rb") as w:
        sr, n, ch = w.getframerate(), w.getnframes(), w.getnchannels()
        raw = w.readframes(n)
    a = array.array("h")
    a.frombytes(raw[:len(raw) - (len(raw) % 2)])
    if ch > 1:
        a = a[::ch]
    step = max(1, int(round(sr / target_sr)))
    return a[::step], sr / step


def bands(sig, sr, hop_s=0.005):
    """Per-hop peak in a low band (the kick) and RMS overall and above 250 Hz."""
    hop = max(1, int(sr * hop_s))
    al = math.exp(-2 * math.pi * 130.0 / sr)
    ah = math.exp(-2 * math.pi * 250.0 / sr)
    lo, full, hi, y, z = [], [], [], 0.0, 0.0
    for i in range(0, len(sig) - hop, hop):
        pk = acc = hacc = 0.0
        for v in sig[i:i + hop]:
            y = (1 - al) * v + al * y
            if abs(y) > pk: pk = abs(y)
            z = (1 - ah) * v + ah * z
            d = v - z
            hacc += d * d
            acc += v * v
        lo.append(pk)
        full.append(math.sqrt(acc / hop))
        hi.append(math.sqrt(hacc / hop))
    return {"dt": hop / sr, "low": lo, "rms": full, "high": hi}


def _at(series, dt, t, w=1):
    i = int(round(t / dt))
    best = 0.0
    for j in range(max(0, i - w), min(len(series), i + w + 1)):
        if series[j] > best: best = series[j]
    return best


def _corr(xs, ys):
    n = len(xs)
    if n < 4: return 0.0
    mx = sum(xs) / n; my = sum(ys) / n
    sxy = sxx = syy = 0.0
    for a, b in zip(xs, ys):
        p, q = a - mx, b - my
        sxy += p * q; sxx += p * p; syy += q * q
    if sxx < 1e-12 or syy < 1e-12: return 0.0
    return sxy / math.sqrt(sxx * syy)


def ev_grid(m, B):
    """Is the kick loud where the map says the beats are? The one check that
    cannot be gamed by a self-consistent map.

    The 0.8 this used to divide by was a constant, and it made the same
    assumption the first version of ev_accents made: that every recording offers
    the same amount of signal, so the same number means the same thing on all of
    them. Measured on the five songs here, the best a rigid grid can do -- the
    best PERIOD and the best PHASE, chosen with the answer in hand -- ranges from
    1.42x on Don't Look Down to 1.93x on The Nights. A record with breakdowns has
    no kick under half its beats and cannot reach 1.8 however right the grid is;
    Levels caps at 1.56x, so a provably optimal grid scored 0.70 and had no way
    to find out it was already finished.

    So the ceiling is computed from the audio, the same way ev_accents computes
    its own. Searched at the map's period and at half and double it, because an
    octave error is the classic way to be confidently wrong about a tempo and it
    must not be able to hide behind a ceiling built from its own mistake -- a
    double-time grid is measured against what the true tempo could have scored,
    and reads 0.14 rather than 1.00.

    Falsified before being kept: half a beat late, jittered, at the wrong octave,
    and 25 ms out all score LOWER than the map they were corrupted from, on every
    song. metaeval.py agrees.
    """
    beats = m.get("beats") or []
    if len(beats) < 8: return None, "no beats"
    dt, low = B["dt"], B["low"]
    allm = sum(low) / len(low)
    if allm <= 0: return None, "silent recording", True
    ratio = (sum(_at(low, dt, t) for t in beats) / len(beats)) / allm

    per = (m.get("grid") or {}).get("period") or (
        (beats[-1] - beats[0]) / max(1, len(beats) - 1))
    dur = len(low) * dt

    def at_grid(p, ph):
        n = int((dur - ph) / p)
        if n < 8: return None
        return sum(_at(low, dt, ph + i * p) for i in range(n)) / n / allm

    ceiling = 0.0
    for mult in (0.5, 1.0, 2.0):
        p = per * mult
        step, k = 0.004, 0
        while k * step < p:
            v = at_grid(p, k * step)
            if v is not None and v > ceiling: ceiling = v
            k += 1
    # Half and double the claimed period are searched as well as the claimed one,
    # so a map at the wrong octave is measured against what the right tempo could
    # have scored rather than against a ceiling built from its own mistake.
    if ceiling - 1.0 < 0.15:
        return None, (f"this recording has no kick contrast to place a grid against -- "
                      f"the best possible grid only reaches {ceiling:.2f}x"), True
    frac = (ratio - 1.0) / (ceiling - 1.0)

    # One thing loudness alone cannot see. A half-time grid -- every other beat --
    # is loud on every beat it claims, because all of them are real beats; it
    # gives itself away only in the gaps, where the beats it MISSED are just as
    # loud as the ones it found. So measure the midpoints too. On the five songs
    # here a correct grid leaves its midpoints carrying at most 71% of the beat's
    # excess energy, and a half-time grid leaves them carrying 102-103%: the two
    # do not overlap. This only fires in that unambiguous band, so a syncopated
    # record with genuinely loud offbeats -- Don't Look Down sits at 71% -- is
    # not punished for it.
    #
    # It is not a complete octave test and does not claim to be: on a record whose
    # kicks alternate strong and weak, a half-time grid picks the strong ones and
    # scores 50%, inside the honest band, and escapes. The old fixed scale caught
    # that case no better -- it scored that same grid 1.00.
    mid = at_grid(per, (m.get("grid") or {}).get("phase", beats[0]) + per / 2)
    share = ((mid - 1.0) / (ratio - 1.0)) if (mid is not None and ratio > 1.0) else 0.0
    guard = min(1.0, max(0.0, (1.0 - share) / 0.15))
    note = "" if guard >= 0.999 else (
        f", but the midpoints between them carry {100*share:.0f}% of the same excess -- "
        f"this looks like every other beat of a faster grid")
    return min(1.0, max(0.0, frac * guard)), (
        f"kick {ratio:.2f}x louder on the beats, against {ceiling:.2f}x for the best grid "
        f"this recording allows{note}")


def ev_bars(m, B):
    """Do the structural marks land on bar lines?

    This is an internal-consistency check and it is the only one here that is,
    which is why it is worth having: seconds are addresses, so two fields can each
    be self-consistent while disagreeing about where a bar begins. On Levels the
    chapters sit on beat 0 of a bar and the drop kicks on beat 2, and nothing in
    the file could express that contradiction until every entry carried a position
    in beats. A chapter boundary that is not on a bar line is either wrong or the
    bar phase is."""
    g = m.get("grid") or {}
    per, ph = g.get("period"), g.get("phase")
    if not per:
        return None, "no grid"
    bp = g.get("bar_phase", 0)
    # A mark at or before the first beat is not checked. validate.py requires the
    # first chapter to sit at 0.0 so that every t in the song is covered, and the
    # grid does not start until its phase -- so that chapter is REQUIRED to be
    # somewhere no bar line can be. It was being counted as a miss on every map
    # that follows the rule, including the two here that do.
    first = min(m.get("beats") or [ph]) - 1e-6
    # A chapter that sits at exactly the same instant as a drop or a stop is
    # NAMING that event, and a drop lands on a half bar. Correcting the drops in
    # Levels to where the record puts them therefore moved three chapters onto
    # half bars with them, and this check charged 0.09 for it -- the map paying
    # for being right, one step removed. The allowance is not general: a chapter
    # only inherits the half bar if a moment is there with it, so a boundary that
    # has merely drifted is still caught. Falsified: rolling every chapter half a
    # bar reads 0.27-0.61 on the five songs, against 0.80-1.00 as measured.
    at_moment = set(round(x["at"], 3) for x in (m.get("moments") or [])
                    if isinstance(x, dict) and x.get("kind") in ("drop", "stop")
                    and "at" in x)
    marks = []
    for key, field in (("chapters", "at"), ("moments", "at"), ("spans", "from")):
        for r in (m.get(key) or []):
            if isinstance(r, dict) and field in r and r[field] > first:
                half = key == "moments" or (key == "chapters"
                                            and round(r[field], 3) in at_moment)
                marks.append((key, (r[field] - ph) / per, half))
    if len(marks) < 4:
        return None, "nothing structural to check"
    def on_line(pos):
        d = ((pos - bp) % 4 + 4) % 4
        return min(d, 4 - d) < 0.06

    # A chapter begins a section and a section begins on a bar line. A MOMENT is
    # a different animal: the commit that added ev_moments says it in as many
    # words -- "the drops in Levels land on half bars" -- and that is why the
    # bar-line snap in ear.py was pushing them two beats late. Correcting the
    # drops to where the record puts them therefore cost 0.11 on this check,
    # which is this harness paying a map for being wrong. A moment is allowed on
    # a half bar; it is still required to be on the grid, so a drop that has
    # wandered off the two-beat lattice is caught exactly as before.
    def on_half(pos):
        d = ((pos - bp) % 2 + 2) % 2
        return min(d, 2 - d) < 0.06
    ok = lambda half, p: on_half(p) if half else on_line(p)
    on = sum(1 for k, p, half in marks if ok(half, p))
    frac = on / len(marks)
    worst = {}
    for k, p, half in marks:
        if not ok(half, p):
            worst[k] = worst.get(k, 0) + 1
    detail = ", ".join(f"{v} {k}" for k, v in sorted(worst.items())) or "all of them"
    return frac, (f"{on} of {len(marks)} structural marks are on the bar grid "
                  f"(spans and chapters on a bar line, moments and the chapters that "
                  f"name them on a half bar)"
                  + (f" -- off: {detail}" if worst else ""))


def ev_downbeats(m, B):
    """Is the low band louder on bar lines than on the other beats?

    metaeval says this check was BROKEN: corrupting the downbeats made its score
    go UP by 0.14. The reason is genuine and worth keeping in view -- in
    four-on-the-floor there IS no bar-line accent to find. Folding this record over
    four beats gives 0.91, 0.96, 1.00, 0.94 in the top band and equally flat below:
    every beat has a kick and there is no crash each bar. So the check was reading
    noise, and shuffling the input could only move it by luck.

    It now measures whether the signal EXISTS before scoring on it. If the four
    beats of a bar are within a few per cent of each other, there is nothing here
    to be right or wrong about and it returns nothing at all rather than a number.
    """
    db = m.get("downbeats") or []
    beats = m.get("beats") or []
    if len(db) < 4 or len(beats) < 16: return None, "no downbeats", False
    dt, low = B["dt"], B["low"]
    # first: does this record distinguish the beats of a bar at all?
    bp = (m.get("grid") or {}).get("bar_phase", 0)
    slots = [[], [], [], []]
    for i, t in enumerate(beats):
        slots[(i - bp) % 4].append(_at(low, dt, t))
    means = [sum(v) / len(v) if v else 0.0 for v in slots]
    hi, lo = max(means), min(means)
    if hi <= 0 or (hi - lo) / hi < 0.12:
        return None, (f"this record has no bar-line accent to measure -- the four beats "
                      f"of a bar sit within {100*(hi-lo)/max(1e-9,hi):.0f}% of each other"), True
    dset = set(round(x, 2) for x in db)
    d = [_at(low, dt, t) for t in beats if round(t, 2) in dset]
    o = [_at(low, dt, t) for t in beats if round(t, 2) not in dset]
    if not d or not o: return None, "downbeats do not line up with beats", False
    r = (sum(d) / len(d)) / max(1e-9, sum(o) / len(o))
    return min(1.0, max(0.0, (r - 1.0) / 0.4)), f"bar lines {r:.2f}x the other beats", False


def ev_moments(m, B):
    """Is the drop where the map says it is?

    This check exists because of a specific, expensive miss on 8 Sept. Amal's map
    scored 0.89 -- the best any map has scored -- and put the drop in Levels at
    20.85. The recording puts it at 19.86, Renjith heard it "right after 19", and
    the map that scores 0.66 puts it at 19.91. The 0.89 map rendered a visibly
    worse show than the 0.66 map, and nothing in this scorer noticed, because
    nothing in this scorer looked at moments at all.

    A second is two beats at 128 bpm. On a light show that is not a small error:
    the room goes bright while the record is still in the break, and then the
    actual drop arrives to lights that are already up. It is the single most
    visible thing a map can get wrong, and it was free.

    Anchored to the recording, not to the map: find the biggest loudness step
    near the claim and measure how far the claim sits from it, in BEATS rather
    than seconds, because that is the unit the error is heard in.
    """
    mo = m.get("moments") or []
    mo = mo.get("entries") if isinstance(mo, dict) else mo
    per = (m.get("grid") or {}).get("period")
    if not per or not mo:
        return None, "no moments"
    dt, rms, dur = B["dt"], B["rms"], m["song"]["length"]

    # The window is not a free parameter, and picking it wrong reverses the
    # verdict. In Levels the drop lands at 19.88 and the record then leaves a
    # one-beat gap at 20.62 before resuming at 20.75. A quarter-second window
    # finds that resume, because it is the sharpest INSTANTANEOUS step in the
    # region -- and then calls a map that claims 20.85 accurate and a map that
    # claims 19.91 nearly a second early. Exactly backwards.
    #
    # A drop is a SUSTAINED change, so the window has to be long enough to be
    # about a section rather than a hit. Every shoulder from half a second up
    # agrees on 19.6-19.9; only the very short one disagrees. Rather than pick
    # one and hope, take the median across four, which is stable and says so.
    SHOULDERS = (0.5, 1.0, 1.5, 2.0)

    def step_at(t, sh):
        W = max(1, int(sh / dt))
        i = int(t / dt)
        if i - W < 0 or i + W >= len(rms): return None
        return sum(rms[i:i+W]) / W - sum(rms[i-W:i]) / W

    # Only the kinds whose signature is unambiguous. A drop and a stop are steps
    # and a step detector finds steps. A build is a ramp, a quiet is often a slow
    # filter close, and scoring those with this instrument produced numbers I
    # could not defend -- every map read badly on them, which usually means the
    # check is wrong rather than that everyone is. They stay unscored and say so,
    # rather than contributing noise dressed as evidence.
    RISE = {"drop"}                              # a step up
    FALL = {"stop"}                              # a step down
    SEARCH = 2.5                                 # how far to look for the real one

    scored, notes = [], []
    for x in mo:
        t = x.get("at", x.get("t"))
        k = x.get("kind")
        if t is None or k not in RISE | FALL: continue
        want_up = k in RISE
        votes, strengths = [], []
        for sh in SHOULDERS:
            best, bt = None, None
            u = t - SEARCH
            while u <= t + SEARCH:
                v = step_at(u, sh)
                if v is not None and (best is None or (v > best if want_up else v < best)):
                    best, bt = v, u
                u += dt
            if bt is not None:
                votes.append(bt); strengths.append(best)
        if not votes: continue
        votes.sort()
        bt = votes[len(votes) // 2]              # median window, not a chosen one
        best = sorted(strengths)[len(strengths) // 2]
        # a claimed drop where nothing rises is not late, it is imagined
        if (best <= 0) if want_up else (best >= 0):
            scored.append(0.0); notes.append(f"{k}@{t:.2f} has no {'rise' if want_up else 'fall'}")
            continue
        err_beats = abs(t - bt) / per
        scored.append(max(0.0, 1.0 - err_beats / 2.0))
        if err_beats > 0.5:
            notes.append(f"{k}@{t:.2f} is {err_beats:.1f} beats from the real one at {bt:.2f}")
    if not scored:
        return None, "no drops or stops to check"
    sc = sum(scored) / len(scored)
    good = sum(1 for x in scored if x > 0.75)
    skipped = len([x for x in mo if x.get("kind") not in RISE | FALL])
    why = (f"{good}/{len(scored)} drops and stops land within half a beat of the "
           f"real thing")
    if skipped: why += f" ({skipped} builds/quiets not checked -- ramps, not steps)"
    if notes: why += " -- " + "; ".join(notes[:2])
    return sc, why


def ev_sections(m, B):
    """Does the sound actually change where the map says a part begins?"""
    chs = [c["at"] for c in (m.get("chapters") or [])]
    if len(chs) < 3: return None, "no chapters"
    dt, rms, hi = B["dt"], B["rms"], B["high"]
    dur = m["song"]["length"]

    def change(t):
        a0, a1 = max(0.0, t - 2.0), t
        b0, b1 = t, min(dur, t + 2.0)
        f = lambda s, x, y: sum(s[int(x / dt):int(y / dt)]) / max(1, int((y - x) / dt))
        r1, r2 = f(rms, a0, a1), f(rms, b0, b1)
        h1, h2 = f(hi, a0, a1), f(hi, b0, b1)
        return abs(r2 - r1) / max(1e-9, r1 + r2) + abs(h2 - h1) / max(1e-9, h1 + h2)

    # Boundaries in the first and last two seconds are skipped because the change
    # window would run off the end of the record -- but the sum was still being
    # divided by ALL of them, so a map lost a fixed percentage for every boundary
    # it declared at the edges. A map with a chapter at 0.0 (which validate.py
    # requires) was scored as though that chapter had changed nothing.
    inside = [t for t in chs if 2 < t < dur - 2]
    real = sum(change(t) for t in inside) / max(1, len(inside))
    # Against chance -- and chance needs more than one throw of the dice. This
    # drew ONE set of random times with seed 7 and divided by its mean, so the
    # verdict rode on that single draw. On Don't Look Down the draw came out low
    # and the check then could not tell the real boundaries from invented ones at
    # all: rolling every chapter forward 7, 30 or even 61 seconds still scored
    # 1.00, and twenty random boundary sets scored up to 1.00 as well. The map was
    # being credited for something the check was not measuring.
    #
    # 64 draws instead of one, seeded so the number is reproducible. Our own
    # boundaries survive it -- against a 200-draw null they beat 100% of random
    # sets on Levels and Starlight, 98.5% on Don't Look Down -- but two songs go
    # DOWN, the-nights sections 1.00 -> 0.56 and mizhiyoram 1.00 -> 0.78, because
    # that is what they were actually worth.
    import random
    rng = random.Random(7)
    draws = [sum(change(rng.uniform(3, dur - 3)) for _ in inside) / max(1, len(inside))
             for _ in range(64)]
    c = sum(draws) / len(draws)
    r = real / max(1e-9, c)
    return min(1.0, max(0.0, (r - 0.8) / 1.0)), (
        f"{r:.2f}x more change at a boundary than at 64 sets of random times")


def _norm01(xs):
    lo, hi = min(xs), max(xs)
    return [0.5] * len(xs) if hi - lo < 1e-12 else [(x - lo) / (hi - lo) for x in xs]


def energy_composite(B, spans):
    """How much is going on, measured so that turning the volume knob cannot move it.

    ev_energy used to correlate the map's energy against the recording's RMS. But
    energy is WRITTEN by averaging ear.py's per-band profile, which is a loudness
    quantity, so both sides of that comparison were the same thing and a map that
    literally shipped an RMS curve would have scored near 1.00.

    Three components, every one a COUNT or a PERCENTILE, so multiplying the whole
    record by a constant leaves all three unchanged:

      onset rate       onset peaks per second across the mix
      high onset rate  the same above 250 Hz, so a hat pattern registers even
                       under a loud bass
      occupancy        how many of the two measured bands sit above their own
                       median for this song

    What is NOT in here, and why it took a measurement to find out: spectral
    brightness as a SHARE of the spectrum. It reads backwards on this
    repertoire -- correlating -0.25 to -0.84 with energy -- because when a drop
    lands the kick and bass dominate and the high band's proportion falls even
    as its absolute activity rises. Averaging it in alongside the good component
    dragged energy from 0.8 to 0.2 across all five songs. High-frequency
    ACTIVITY is the signal; high-frequency SHARE is spectral tilt, which is a
    fact about the mix engineer.

    The spec for this work suggested the map's own `stems` for a third
    component. It is computed from the audio instead: grading one field of a map
    against another field of the same map lets a file be self-consistently wrong
    and still score well, which is the same circularity in a different costume.
    """
    dt, low, rms, high = B["dt"], B["low"], B["rms"], B["high"]

    def onset_fn(series):
        o = [max(0.0, series[i] - series[i - 1]) for i in range(1, len(series))]
        pos = sorted(x for x in o if x > 0)
        return o, (pos[int(0.80 * len(pos))] if pos else 0.0)

    o_all, t_all = onset_fn(rms)
    o_hi, t_hi = onset_fn(high)
    med_low = sorted(low)[len(low) // 2] if low else 0.0
    med_high = sorted(high)[len(high) // 2] if high else 0.0
    rate, hrate, occ = [], [], []
    for a, b in spans:
        i0, i1 = int(a / dt), int(b / dt)
        if i1 <= i0 or i1 > len(rms):
            return None
        span_s = max(1e-9, b - a)
        rate.append(sum(1 for i in range(max(1, i0), min(i1, len(o_all)))
                        if o_all[i] > t_all and o_all[i] >= o_all[i - 1]) / span_s)
        hrate.append(sum(1 for i in range(max(1, i0), min(i1, len(o_hi)))
                         if o_hi[i] > t_hi and o_hi[i] >= o_hi[i - 1]) / span_s)
        sl, sh = low[i0:i1], high[i0:i1]
        occ.append(((sum(sl) / len(sl) > med_low) + (sum(sh) / len(sh) > med_high)) / 2.0)
    nr, nh = _norm01(rate), _norm01(hrate)
    return [(nr[i] + nh[i] + occ[i]) / 3.0 for i in range(len(occ))]


def ev_energy(m, B):
    en = m.get("energy") or []
    if len(en) < 8: return None, "no energy curve"
    rows = [(r[0], r[1]) if isinstance(r, (list, tuple)) else (r.get("at"), r.get("value"))
            for r in en]
    rows = [(t, v) for t, v in rows if t is not None and v is not None]
    if len(rows) < 8: return None, "no energy curve"
    per = (m.get("grid") or {}).get("period") or 0.5
    win = per * 4
    dt, rms = B["dt"], B["rms"]
    spans, claimed = [], []
    for t, v in rows:
        if int((t + win) / dt) >= len(rms): continue
        spans.append((t, t + win)); claimed.append(v)
    if len(claimed) < 8: return None, "energy curve runs past the recording"

    comp = energy_composite(B, spans)
    loud = [sum(rms[int(a / dt):int(b / dt)]) / max(1, int((b - a) / dt)) for a, b in spans]
    r_loud = _corr(claimed, loud)
    if comp is None:
        return max(0.0, min(1.0, r_loud)), (f"r={r_loud:.2f} against loudness only -- the "
                                            f"composite could not be measured")

    r_comp = _corr(claimed, comp)
    cn, kn = _norm01(comp), _norm01(claimed)
    mae = sum(abs(a - b) for a, b in zip(cn, kn)) / len(cn)
    # Correlation is scale-blind: a curve with the right shape and the wrong range
    # scores the same as one that is right. MAE is the half that notices.
    shape = max(0.0, min(1.0, r_comp))
    fit = max(0.0, 1.0 - mae / 0.25)
    primary = 0.6 * shape + 0.4 * fit
    # Loudness only gets a vote where loudness carries information. On the
    # filter-sweep fixture the record varies 1.9% in level and the true energy
    # curve still correlates r=-0.80 with it, because correlation is scale-blind
    # and any monotone drift lines up with any monotone curve. Letting that vote
    # took 0.22 off a map that was right.
    ln = _norm01(loud)
    loud_range = max(loud) - min(loud)
    loud_rel = loud_range / max(1e-9, sum(loud) / len(loud))
    if loud_rel < 0.15:
        return min(1.0, max(0.0, primary)), (
            f"r={r_comp:.2f} mae={mae:.2f} against onset rate, high-band onset rate and "
            f"band occupancy -- all counts or percentiles, none of which move when the volume "
            f"does. This recording's level "
            f"only varies {100*loud_rel:.0f}%, so loudness was given no vote")
    secondary = max(0.0, min(1.0, r_loud))
    score = 0.78 * primary + 0.22 * secondary
    return min(1.0, max(0.0, score)), (
        f"r={r_comp:.2f} mae={mae:.2f} against onset rate, high-band onset rate and "
        f"band occupancy -- all counts or percentiles; loudness r={r_loud:.2f} "
        f"carries the remaining 22%")


def ev_accents(m, B):
    """Do the claimed hits sit on real onsets, and how close to the best possible?

    Two lessons are baked into this one.

    metaeval caught the first: the original asked whether onset energy was high
    NEAR each claim, and in a mix with onsets every few hundred milliseconds almost
    any time is near one. Jittering every accent by 90 ms made the score go UP by
    0.25. So it asks whether the claim is at a local PEAK, and scores against its
    own randomised copy -- a check that cannot beat a jittered version of its own
    input is measuring nothing.

    The second is the more useful one. Beating random is a floor, not a target, so
    the score is calibrated against a CEILING computed from the audio: the same
    number of claims placed on the strongest onsets the recording actually has. A
    score of 1.0 then means "as good as anyone could do on this song" rather than
    "past a threshold somebody chose". On Levels the ceiling is 1.53x and this map
    reaches 1.15x, so it captures about a quarter of the signal that is there --
    which is a far more actionable sentence than a bare 0.68.
    """
    ev = ((m.get("accents") or {}).get("events")) or []
    if len(ev) < 20: return None, "no accents", False
    dt = B["dt"]

    # A third lesson, from measuring every band separately. The check read the
    # LOW band for every claim, and a hi-hat, a vocal and a guitar do not put
    # energy there -- so six of the eight instruments in the list were being
    # graded against a signal they cannot appear in, and scored the same as a
    # jittered control whether they were right or not. Each band is now checked
    # against the band it actually lives in: kick and bass against the low band,
    # everything else against the energy above 250 Hz. Falsified: jittering every
    # time and swapping the band labels both make this WORSE, on every song.
    def onset_of(series):
        raw = [max(0.0, series[i] - series[i - 1]) for i in range(1, len(series))]
        k = 3
        return [max(raw[max(0, i - k):i + k + 1]) for i in range(len(raw))]
    ON = {"low": onset_of(B["low"]), "high": onset_of(B["high"])}
    if not ON["low"] or not ON["high"]: return None, "no onsets in the audio", True
    LOWBANDS = {"kick", "bass"}
    band_of = lambda e: "low" if (e.get("of") in LOWBANDS or e.get("of") is None) else "high"
    W = 12

    def peaky(t, on):
        i = int(round(t / dt))
        if i < W or i >= len(on) - W: return 0.0
        w = max(on[i - W:i + W + 1])
        return on[i] / w if w > 0 else 0.0

    import random
    rng = random.Random(3)
    groups = {}
    for e in ev: groups.setdefault(band_of(e), []).append(e)
    tot_frac, tot_n, parts = 0.0, 0, []
    for name, sub in groups.items():
        on = ON[name]
        real = sum(peaky(e["at"], on) for e in sub) / len(sub)
        ctrl = sum(peaky(e["at"] + rng.uniform(-0.09, 0.09), on) for e in sub) / len(sub)
        if ctrl <= 0: continue
        # the ceiling: the same number of claims, placed as well as this band allows
        order = sorted(range(W, len(on) - W), key=lambda i: -on[i])
        picked, used = [], []
        for i in order:
            if any(abs(i - j) < W for j in used): continue
            used.append(i); picked.append(i * dt)
            if len(picked) >= len(sub): break
        ideal = sum(peaky(t, on) for t in picked) / max(1, len(picked))
        edge, ceiling = real / ctrl - 1.0, max(0.05, ideal / ctrl - 1.0)
        frac = max(0.0, min(1.0, edge / ceiling))
        tot_frac += frac * len(sub); tot_n += len(sub)
        parts.append(f"{name} {real/ctrl:.2f}x of {ideal/ctrl:.2f}x")
    if not tot_n: return None, "accents could not be checked", True
    frac = tot_frac / tot_n
    return frac, (", ".join(parts) + f" -- {100*frac:.0f}% of the available signal, "
                  f"each band against its own onsets"), False


def ev_chords(m, B, sig, sr):
    ch = ((m.get("observations") or {}).get("chords") or {}).get("events") or []
    if len(ch) < 6: return None, "no chords"
    def goertzel(i0, n, f):
        k = 2.0 * math.cos(2.0 * math.pi * f / sr)
        s1 = s2 = 0.0
        for i in range(i0, min(len(sig), i0 + n)):
            s0 = sig[i] + k * s1 - s2
            s2, s1 = s1, s0
        return math.sqrt(abs(s1 * s1 + s2 * s2 - k * s1 * s2))
    win = int(0.30 * sr)
    scores, best = [], []
    for e in ch[::max(1, len(ch) // 40)]:
        root = e["chord"][0] + ("#" if len(e["chord"]) > 1 and e["chord"][1] == "#" else "")
        if root not in NOTES: continue
        r = NOTES.index(root)
        third = 3 if "m" in e["chord"][len(root):] else 4
        want = {r % 12, (r + third) % 12, (r + 7) % 12}
        i0 = int(e["at"] * sr)
        if i0 + win >= len(sig): continue
        pc = [0.0] * 12
        for mi in range(36, 85):
            f = 440.0 * (2.0 ** ((mi - 69) / 12.0))
            if f > sr * 0.45: break
            pc[mi % 12] += goertzel(i0, win, f)
        tot = sum(pc)
        if tot <= 0: continue
        conc = lambda w: (sum(pc[q] for q in w) / tot) / 0.25
        scores.append(conc(want))                        # 1.0 means no better than flat
        # ...and the ceiling, for the same reason ev_accents has one: 1.2 was a
        # constant chosen once, and it assumes every recording separates its
        # chroma equally well. It does not. A saturated synth mix smears the
        # twelve bins together, so on Levels the BEST-FITTING triad of the
        # twenty-four -- an oracle allowed to pick per bar, with no obligation to
        # be musically right -- carries only 1.57x its share, and a perfect chord
        # sheet could not score above 0.47. On a cleanly recorded record the same
        # oracle reaches well past 2.0. Scoring against what the audio allows says
        # "as good as anyone could do here"; scoring against 1.2 says "as good as
        # a different recording would have let you be".
        best.append(max(conc({q, (q + t) % 12, (q + 7) % 12})
                        for q in range(12) for t in (3, 4)))
    if not scores: return None, "chords could not be checked", True
    r = sum(scores) / len(scores)
    ceiling = sum(best) / len(best)
    if ceiling - 1.0 < 0.15:
        return None, (f"this recording does not separate its chroma -- the best-fitting "
                      f"triad only reaches {ceiling:.2f}x"), True
    frac = (r - 1.0) / (ceiling - 1.0)
    return min(1.0, max(0.0, frac)), (f"claimed notes carry {r:.2f}x their share of the energy, "
                                      f"against {ceiling:.2f}x for the best-fitting triad on this recording")


def ev_melody(m, B, sig, sr):
    mel = ((m.get("observations") or {}).get("melody") or {}).get("notes") or []
    voiced = [n for n in mel if n and len(n) >= 3 and isinstance(n[2], (int, float))]
    if len(voiced) < 20: return None, "no melody"
    def goertzel(i0, n, f):
        k = 2.0 * math.cos(2.0 * math.pi * f / sr)
        s1 = s2 = 0.0
        for i in range(i0, min(len(sig), i0 + n)):
            s0 = sig[i] + k * s1 - s2
            s2, s1 = s1, s0
        return math.sqrt(abs(s1 * s1 + s2 * s2 - k * s1 * s2))
    win = int(0.09 * sr)
    good = 0; n = 0
    step = max(1, len(voiced) // 60)
    for e in voiced[::step]:
        t, midi = e[0], e[2]
        i0 = int(t * sr)
        if i0 + win >= len(sig): continue
        f = 440.0 * (2.0 ** ((midi - 69) / 12.0))
        if f > sr * 0.45: continue
        here = goertzel(i0, win, f)
        # against two neighbours a tritone away, which should be quieter if the
        # claimed pitch is really the one sounding
        off = (goertzel(i0, win, f * 1.414) + goertzel(i0, win, f / 1.414)) / 2
        n += 1
        if here > off * 1.15: good += 1
    if not n: return None, "melody could not be checked", True
    r = good / n
    return min(1.0, max(0.0, (r - 0.4) / 0.5)), f"{100*r:.0f}% of claimed notes are the loudest pitch there"


def ev_stems(m, B):
    """The claimed stem levels, against the recording they were separated from.

    A separator is close to conservative: what it pulls apart still adds up to
    what went in. So the six claimed levels have one constraint that does not
    come from the separator at all -- summed as energy, bar by bar, they have to
    follow the loudness of the mix, which this scorer measures itself from the
    raw waveform in bands(). Nothing here touches demucs, and nothing here
    touches listen/stemlevels.py: one side is six numbers in the map, the other
    is a broadband envelope of the recording.

    That is what makes it a check on the thing that was wrong. The old field was
    each stem's RMS normalised by its own maximum, so a stem the separator
    invented sat near the top of its range all song. Normalised series do not
    sum to a mix, and they measurably do not: 0.68 mean against 0.92 for the
    levels that replaced them, on the same five recordings.

    What it cannot see, said plainly: bands() is a filtered envelope, not a
    calibrated RMS, so an absolute reference is not available to compare
    against. A constant offset between the two sides is divided out before the
    fit, which means putting every stem 20 dB up scores exactly the same. This
    check grades the shape and the levels RELATIVE to each other. The absolute
    reference is not checked here and is not claimed to be."""
    st = m.get("stems") or {}
    src = st.get("sources") or {}
    downs = m.get("downbeats") or []
    if not src:
        return None, "no stems"
    if len(downs) < 8:
        return None, "stems are per bar and this map declares no bar lines", True
    dt, rms = B["dt"], B["rms"]
    ref = math.sqrt(sum(v * v for v in rms) / max(1, len(rms)))
    bar = (downs[-1] - downs[0]) / max(1, len(downs) - 1)
    edges = list(downs) + [downs[-1] + bar]
    is_db = st.get("comparable") is True
    S, Mx = [], []
    for i in range(len(edges) - 1):
        i0, i1 = int(edges[i] / dt), int(edges[i + 1] / dt)
        seg = rms[i0:min(i1, len(rms))]
        if not seg:
            continue
        Mx.append((sum(v * v for v in seg) / len(seg)) / max(1e-18, ref * ref))
        tot = 0.0
        for v in src.values():
            if i < len(v):
                tot += 10 ** (v[i] / 10.0) if is_db else v[i] * v[i]
        S.append(tot)
    if len(S) < 8:
        return None, "too few bars to compare"
    r = _corr(S, Mx)
    gmean = lambda a: math.exp(sum(math.log(max(1e-12, x)) for x in a) / len(a))
    k = gmean(Mx) / max(1e-12, gmean(S))
    wander = sum(abs(math.log10(max(1e-12, S[i] * k) / max(1e-12, Mx[i])))
                 for i in range(len(S))) / len(S)
    shape = max(0.0, r)
    fit = max(0.0, 1.0 - wander / 0.30)
    unit = "levels against the mix" if is_db else ("NORMALISED PER STEM, which cannot sum to a "
                                                  "mix -- every series peaks at its own maximum")
    absent = [n for n, L in (st.get("levels") or {}).items() if L.get("present") is False]
    return (0.7 * shape + 0.3 * fit,
            "%d stems summed as energy track the mix bar by bar at r=%+.2f, wandering %.2f "
            "dex around a constant offset -- %s%s"
            % (len(src), r, wander, unit,
               ("; %s marked absent and excluded by the writer" % ", ".join(absent))
               if absent else ""))


def ev_pump(m, B):
    p = (m.get("observations") or {}).get("pump")
    if not p: return None, "no pump measurement"
    beats = m.get("beats") or []
    if len(beats) < 8: return None, "no beats"
    dt, hi = B["dt"], B["high"]
    vals = []
    for i in range(len(beats) - 1):
        a, b = beats[i], beats[i + 1]
        per = b - a
        ja, jb = int((a + per * 0.18) / dt), int((a + per * 0.72) / dt)
        if jb >= len(hi) or jb - ja < 3: continue
        seg = hi[ja:jb]; third = max(1, len(seg) // 3)
        f = sum(seg[:third]) / third; l = sum(seg[-third:]) / third
        if f + l > 0: vals.append((l - f) / (l + f))
    if not vals: return None, "pump could not be checked", True
    measured = sum(vals) / len(vals)
    claimed = p.get("depth", 0.0)
    err = abs(measured - claimed)
    return min(1.0, max(0.0, 1 - err / 0.15)), \
           f"claims {claimed:+.3f}, recording says {measured:+.3f}"


# ---------------------------------------------------------------------------
# AUDIT ONLY. These read the audio like every other check and they are NOT in
# WEIGHTS, so they move nobody's total.
#
# Why not weighted, when an unscored field is a field nobody has to get right:
# only Amal's maps carry these six fields, because they were added on 8 Sept.
# Coverage divides by what a map COULD claim, so weighting them would raise one
# author's score and lower everybody else's for not having invented them the
# same afternoon. That is the board being rigged by whoever writes the checks.
# Weight them when a second author's map carries them -- that is Renjith's call
# and not the caller's.
#
# observations.anticipation is deliberately absent from this block. It is pure
# arithmetic over `moments` and `spans`, both already scored, so checking it
# would score those two a second time. Grading a thing against its own input is
# the first mistake listed in AGENTS.md.


def au_meter(m, B):
    o = (m.get("observations") or {}).get("meter") or {}
    claimed = o.get("beats_per_bar")
    beats = m.get("beats") or []
    if not claimed or len(beats) < 32: return None, "no meter claimed"
    dt, low, high = B["dt"], B["low"], B["high"]
    vecs = [[_at(low, dt, t), _at(high, dt, t)] for t in beats]
    def cos(a, b):
        na = math.sqrt(sum(x * x for x in a)); nb = math.sqrt(sum(x * x for x in b))
        return None if (na < 1e-9 or nb < 1e-9) else sum(x * y for x, y in zip(a, b)) / (na * nb)
    def support(n):
        got = []
        for lag in (n, 2 * n):
            vals = [c for c in (cos(vecs[i], vecs[i + lag])
                                for i in range(len(vecs) - lag)) if c is not None]
            if vals: got.append(sum(vals) / len(vals))
        return sum(got) / len(got) if got else 0.0
    cands = {n: support(n) for n in (2, 3, 4, 5, 6, 7)}
    best = max(cands, key=lambda n: cands[n])
    mine, top = cands.get(claimed, 0.0), cands[best]
    frac = 0.0 if top <= 0 else max(0.0, min(1.0, mine / top))
    return frac, (f"claims {claimed} beats to the bar; the mix's own pattern supports "
                  f"{best} best, and {claimed} reaches {100*frac:.0f}% of that")


def au_tempo(m, B):
    o = (m.get("observations") or {}).get("tempo_stability") or {}
    if "rigid_grid_justified" not in o: return None, "no tempo claim"
    beats = m.get("beats") or []
    per = (m.get("grid") or {}).get("period")
    if not per or len(beats) < 64: return None, "no grid"
    dt, low = B["dt"], B["low"]
    halves = []
    for a, b in ((0, len(beats) // 2), (len(beats) // 2, len(beats))):
        seg = beats[a:b]
        best = None
        for k in range(-30, 31):
            off = k * 0.002
            v = sum(_at(low, dt, t + off) for t in seg) / len(seg)
            if best is None or v > best[0]: best = (v, off)
        halves.append(best[1])
    walk = halves[1] - halves[0]
    # graded, not a threshold: at 8% of a period the first version failed Levels
    # by half a millisecond, which is the check's resolution and not the music.
    steadiness = max(0.0, min(1.0, 1.0 - abs(walk) / (per * 0.25)))
    claimed_steady = bool(o["rigid_grid_justified"])
    agrees = steadiness if claimed_steady else 1.0 - steadiness
    return round(agrees, 4), (
        f"claims the rigid grid {'holds' if o['rigid_grid_justified'] else 'does not hold'}; "
        f"the best offset moves {1000*walk:+.0f} ms between the first and second half of the "
        f"record, which is {100*steadiness:.0f}% steady on this measure")


def au_arc(m, B):
    """Where the map's energy curve peaks, against where the recording is loudest.

    This used to read observations.arc, a field that was the argmax of `energy`
    written back into the file. The field is gone -- a reader derives it -- so
    the question is asked of `energy` directly, which is where it always
    belonged: the audit was never about arc, it was about whether the curve
    peaks in the right place."""
    en = m.get("energy") or []
    if len(en) < 3: return None, "no energy curve to find a peak in"
    claimed = max(en, key=lambda p: p[1])[0]
    top = max(v for _, v in en)
    flat = [t for t, v in en if v >= top - 0.02]
    o = {"peak_region_s": [min(flat), max(flat)]}
    dt, rms = B["dt"], B["rms"]
    per = (m.get("grid") or {}).get("period") or 0.5
    w = max(1, int(per * 4 / dt))
    best, i = None, 0
    while i + w < len(rms):
        v = sum(rms[i:i + w]) / w
        if best is None or v > best[0]: best = (v, i * dt)
        i += max(1, w // 4)
    if best is None: return None, "arc could not be checked"
    lo, hi = o.get("peak_region_s") or [claimed, claimed]
    off = 0.0 if lo - 1e-9 <= best[1] <= hi + 1e-9 else min(abs(best[1] - lo), abs(best[1] - hi))
    bars = off / (per * 4)
    frac = max(0.0, min(1.0, 1.0 - bars / 8.0))
    inside = "inside" if off == 0.0 else f"{bars:.1f} bars outside"
    return frac, (f"the curve peaks at {claimed:.1f} s; the loudest bar in the recording is at "
                  f"{best[1]:.1f} s, {inside} the declared peak region "
                  f"{lo:.0f}-{hi:.0f} s. A map that declares a flat top is judged on the region, "
                  f"not the argmax -- a single peak is not a measurement when the curve is level.")


AUDIT = {"meter": au_meter, "tempo_stability": au_tempo, "energy_peak": au_arc}


def audio_for(slug):
    """Decoding and banding a four-minute song in pure Python takes most of a
    minute, and every map for that song needs the same numbers. Cached to disk so
    the second map is instant and a leaderboard is not a coffee break."""
    wav = os.path.join(ROOT, "synth", "out", slug + ".wav")
    if not os.path.exists(wav):
        return None, None, None
    cache = os.path.join(ROOT, "synth", "out", slug + ".bands.json")
    sig, sr = load(wav)
    if os.path.exists(cache) and os.path.getmtime(cache) > os.path.getmtime(wav):
        try:
            return sig, sr, json.load(open(cache))
        except Exception:
            pass
    B = bands(sig, sr)
    try:
        json.dump(B, open(cache, "w"))
    except Exception:
        pass
    return sig, sr, B


def evaluate(slug, map_path=None, m=None):
    m = m if m is not None else json.load(open(map_path))
    sig, sr, B = audio_for(slug)
    if B is None:
        return {"error": "no audio for " + slug}
    out = {}
    for name, fn, args in (
        ("grid", ev_grid, (m, B)), ("bars", ev_bars, (m, B)),
        ("downbeats", ev_downbeats, (m, B)),
        ("moments", ev_moments, (m, B)),
        ("sections", ev_sections, (m, B)), ("energy", ev_energy, (m, B)),
        ("accents", ev_accents, (m, B)), ("stems", ev_stems, (m, B)),
        ("pump", ev_pump, (m, B)),
        ("chords", ev_chords, (m, B, sig, sr)), ("melody", ev_melody, (m, B, sig, sr)),
    ):
        try:
            r = fn(*args)
            score, why = r[0], r[1]
            # Default FALSE. A check that returns no verdict is assumed to be
            # reporting the map's silence, which costs coverage; a check that
            # means "this recording cannot answer the question" has to say so
            # explicitly by returning a third value. Defaulting the other way
            # handed the beats-only map 75% coverage for nine fields it does not
            # claim, which is exactly what coverage exists to prevent.
            na = r[2] if len(r) > 2 else False
        except Exception as e:
            score, why, na = None, f"threw: {e}", False
        out[name] = {"score": None if score is None else round(score, 4),
                     "said": why, "na": bool(na)}
    scored = [(WEIGHTS[k], v["score"]) for k, v in out.items() if v["score"] is not None]
    accuracy = sum(w * v for w, v in scored) / sum(w for w, _ in scored) if scored else 0.0
    # Coverage, because a map that claims nothing was scoring above one that claims
    # everything: five fields at 0.72 beat eight fields at 0.65, so the richer and
    # more useful map came second. Silence should not be a way to win.
    # Coverage asks what the map CLAIMS, not what this harness can grade.
    #
    # The na flag has been computed and displayed since the ceiling work and was
    # never wired to anything. It marks the difference between "the map is silent
    # here" and "this recording cannot answer this question" -- and only the first
    # is the map's doing. Levels claims 127 downbeats; the check cannot grade them
    # because a four-on-the-floor record has no bar-line accent, and five
    # complementary features agree there is nothing there to measure: low band
    # 0.97x, high band 0.89x, harmonic change 0.87x, hits per beat 1.09x, spectral
    # balance 0.95x. Charging the map 10% of its total for that is charging it for
    # the genre of the song.
    #
    # A field the map does not claim still costs, which is the whole point of
    # coverage -- silence must not be a way to win. The beats-only map claims one
    # field of ten and still reads 20%.
    applicable = sum(WEIGHTS[k] for k, v in out.items() if not v["na"])
    coverage = (sum(WEIGHTS[k] for k, v in out.items() if v["score"] is not None)
                / max(1e-9, applicable))
    # The grid is a GATE, not one weight among eight. Every other field's
    # timestamps are expressed in the grid's frame, so a wrong grid makes the rest
    # wrong however well it scores -- the half-beat-late map read 0.08 on grid and
    # still totalled 0.48 because sections and energy use windows wide enough not
    # to notice. A map that cannot find the beat has not described the song.
    g = out["grid"]["score"]
    # An unscorable grid is not automatically a free pass, and it was: `gate =
    # 1.0 if g is None` meant a map with no beats, no downbeats and no period
    # scored 0.68, while a map that tried and got the phase wrong was gated to
    # zero. Not trying beat trying. The na flag already separates the two cases
    # -- "this recording cannot answer" from "the map is silent" -- so use it:
    # a silent grid gates to nothing, and a recording with no kick contrast to
    # measure against does not punish the map for its own nature.
    if g is None:
        gate = 1.0 if out["grid"]["na"] else 0.0
    else:
        gate = min(1.0, max(0.0, g / 0.45))
    total = accuracy * (0.55 + 0.45 * coverage) * gate
    audit = {}
    for name, fn in AUDIT.items():
        try:
            sc, why = fn(m, B)
        except Exception as e:
            sc, why = None, f"threw: {e}"
        audit[name] = {"score": None if sc is None else round(sc, 4), "said": why}
    return {"song": slug,
            "audit": audit,
            "map": os.path.relpath(map_path, ROOT) if map_path else "(uploaded)",
            "made_by": (m.get("made_by") or {}).get("who") or (m.get("made_by") or {}).get("how"),
            "total": round(total, 4), "accuracy": round(accuracy, 4),
            "coverage": round(coverage, 4), "grid_gate": round(gate, 4),
            "measured": len(scored),
            "not_claimed": [k for k, v in out.items() if v["score"] is None],
            "fields": out}


def _report_audit(r):
    au = r.get("audit") or {}
    shown = {k: v for k, v in au.items() if v.get("score") is not None}
    if shown:
        print("   " + "-" * 66)
        print("   audit only -- read from the audio, in no weight, moves no total")
        for k, v in sorted(shown.items()):
            print("   %-11s %.2f   %s" % (k, v["score"], v["said"][:150]))


def maps_for(slug):
    found = []
    for p in (os.path.join(ROOT, "synth", "truth", slug + ".map.json"),
              os.path.join(ROOT, "synth", "songs", slug + ".map.json")):
        if os.path.exists(p): found.append(p)
    for p in sorted(glob.glob(os.path.join(ROOT, "synth", "maps", "*", slug + ".map.json"))):
        found.append(p)
    # maps/model is where the measured maps live, and this harness could not see
    # them -- so the leaderboard has been ranking older copies. Amal hit the same
    # gap in beatpos, pump and harmony: they all looked in truth and songs only.
    for p in sorted(glob.glob(os.path.join(ROOT, "maps", "*", slug + ".map.json"))):
        found.append(p)
    # The same map in two places is one map. maps/model is scanned now as well as
    # synth/maps/<person>/, and a copy kept in both scored twice and sat on the
    # board as two rows claiming to be two maps. Dedupe on content, keeping the
    # first path seen, so a duplicate is invisible rather than flattering.
    seen, uniq = set(), []
    for p in found:
        try:
            h = hashlib.md5(open(p, "rb").read()).hexdigest()
        except OSError:
            continue
        if h in seen:
            continue
        seen.add(h); uniq.append(p)
    return uniq


def report(r):
    if "error" in r:
        print("  " + r["error"]); return
    who = r["made_by"] or "?"
    print(f"\n{r['map']}   ({who})")
    for k in WEIGHTS:
        f = r["fields"][k]
        if f["score"] is None:
            print(f"   {k:11} --      {f['said']}")
        else:
            bar = "#" * int(round(f["score"] * 20))
            print(f"   {k:11} {f['score']:.2f}   {bar:<20} {f['said']}")
    print(f"   {'':11}        accuracy {r['accuracy']:.2f} on {r['measured']} fields"
          f" | coverage {100*r['coverage']:.0f}%"
          + (f" (missing {', '.join(r['not_claimed'])})" if r["not_claimed"] else "")
          + (f" | GRID GATE {r['grid_gate']:.2f}" if r['grid_gate'] < 1 else ""))
    print(f"   {'TOTAL':11} {r['total']:.2f}")
    _report_audit(r)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    rows = []
    if "--every" in sys.argv:
        songs = sorted({os.path.basename(p)[:-9] for p in
                        glob.glob(os.path.join(ROOT, "synth", "truth", "*.map.json"))})
        for s in songs:
            for p in maps_for(s): rows.append(evaluate(s, p))
    else:
        slug = args[0] if args else "levels"
        if "--map" in sys.argv:
            rows.append(evaluate(slug, sys.argv[sys.argv.index("--map") + 1]))
        elif "--all" in sys.argv:
            for p in maps_for(slug): rows.append(evaluate(slug, p))
        else:
            p = maps_for(slug)
            # Every map for the song, not just the first. maps_for() sorts, and
            # synth/maps/_broken-half-beat sorts before every real author, so
            # scoring only p[0] meant the deliberate falsification map SHADOWED
            # every genuine map for levels -- the one song it exists for. The
            # board had never scored a real levels map at all.
            if not p:
                rows.append({"error": "no map for " + slug})
            else:
                for one in p:
                    rows.append(evaluate(slug, one))
    for r in rows: report(r)
    ok = [r for r in rows if "error" not in r]
    if len(ok) > 1:
        print("\nleaderboard")
        for r in sorted(ok, key=lambda x: -x["total"]):
            print(f"   {r['total']:.2f}  (acc {r['accuracy']:.2f} cov {100*r['coverage']:>3.0f}%)"
                  f"  {r['song']:12} {r['map']}")
    d = os.path.join(ROOT, "synth", "learning"); os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "mapeval.jsonl"), "a") as fh:
        for r in ok:
            fh.write(json.dumps({"when": datetime.datetime.now().isoformat(timespec="seconds"), **r}) + "\n")
    print(f"\nappended {len(ok)} result(s) to synth/learning/mapeval.jsonl")
