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
           "energy": 1.5, "accents": 1.0, "chords": 1.0, "melody": 1.0, "pump": 0.5}


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
    # against the same number of times chosen off the boundaries
    import random
    random.seed(7)
    ctrl = [change(random.uniform(3, dur - 3)) for _ in chs]
    c = sum(ctrl) / max(1, len(ctrl))
    r = real / max(1e-9, c)
    return min(1.0, max(0.0, (r - 0.8) / 1.0)), f"{r:.2f}x more change at a boundary than elsewhere"


def ev_energy(m, B):
    en = m.get("energy") or []
    if len(en) < 8: return None, "no energy curve"
    dt, rms = B["dt"], B["rms"]
    xs, ys = [], []
    for t, v in en:
        i0, i1 = int(t / dt), int((t + 1.8) / dt)
        if i1 >= len(rms): continue
        xs.append(v); ys.append(sum(rms[i0:i1]) / max(1, i1 - i0))
    r = _corr(xs, ys)
    return min(1.0, max(0.0, r)), f"r={r:.2f} against how loud the record is"


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
        ("accents", ev_accents, (m, B)), ("pump", ev_pump, (m, B)),
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
    gate = 1.0 if g is None else min(1.0, max(0.0, g / 0.45))
    total = accuracy * (0.55 + 0.45 * coverage) * gate
    return {"song": slug,
            "map": os.path.relpath(map_path, ROOT) if map_path else "(uploaded)",
            "made_by": (m.get("made_by") or {}).get("who") or (m.get("made_by") or {}).get("how"),
            "total": round(total, 4), "accuracy": round(accuracy, 4),
            "coverage": round(coverage, 4), "grid_gate": round(gate, 4),
            "measured": len(scored),
            "not_claimed": [k for k, v in out.items() if v["score"] is None],
            "fields": out}


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
