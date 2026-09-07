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
WEIGHTS = {"grid": 3.0, "bars": 2.0, "downbeats": 1.5, "sections": 1.5,
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
    cannot be gamed by a self-consistent map."""
    beats = m.get("beats") or []
    if len(beats) < 8: return None, "no beats"
    dt, low = B["dt"], B["low"]
    on = sum(_at(low, dt, t) for t in beats) / len(beats)
    allm = sum(low) / len(low)
    if allm <= 0: return None, "silent recording"
    ratio = on / allm
    return min(1.0, max(0.0, (ratio - 1.0) / 0.8)), f"kick {ratio:.2f}x louder on the beats"


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
    marks = []
    for key, field in (("chapters", "at"), ("moments", "at"), ("spans", "from")):
        for r in (m.get(key) or []):
            if isinstance(r, dict) and field in r:
                marks.append((key, (r[field] - ph) / per))
    if len(marks) < 4:
        return None, "nothing structural to check"
    def on_line(pos):
        d = ((pos - bp) % 4 + 4) % 4
        return min(d, 4 - d) < 0.06
    on = sum(1 for _, p in marks if on_line(p))
    frac = on / len(marks)
    worst = {}
    for k, p in marks:
        if not on_line(p):
            worst[k] = worst.get(k, 0) + 1
    detail = ", ".join(f"{v} {k}" for k, v in sorted(worst.items())) or "all of them"
    return frac, (f"{on} of {len(marks)} structural marks are on a bar line"
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
    if len(db) < 4 or len(beats) < 16: return None, "no downbeats", True
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
    if not d or not o: return None, "downbeats do not line up with beats", True
    r = (sum(d) / len(d)) / max(1e-9, sum(o) / len(o))
    return min(1.0, max(0.0, (r - 1.0) / 0.4)), f"bar lines {r:.2f}x the other beats", False


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

    real = sum(change(t) for t in chs if 2 < t < dur - 2) / max(1, len(chs))
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
    if len(ev) < 20: return None, "no accents", True
    dt, low = B["dt"], B["low"]
    raw = [max(0.0, low[i] - low[i - 1]) for i in range(1, len(low))]
    if not raw: return None, "no onsets in the audio", True
    # smoothed to a drum's length: at 5 ms resolution a hit is several hops wide,
    # and demanding the exact hop be the maximum was too sharp to see anything
    k = 3
    on = [max(raw[max(0, i - k):i + k + 1]) for i in range(len(raw))]
    W = 12

    def peaky(t):
        i = int(round(t / dt))
        if i < W or i >= len(on) - W: return 0.0
        w = max(on[i - W:i + W + 1])
        return on[i] / w if w > 0 else 0.0

    import random
    rng = random.Random(3)
    real = sum(peaky(e["at"]) for e in ev) / len(ev)
    ctrl = sum(peaky(e["at"] + rng.uniform(-0.09, 0.09)) for e in ev) / len(ev)
    if ctrl <= 0: return None, "accents could not be checked", True

    # the ceiling: the same number of claims, placed as well as this audio allows
    order = sorted(range(W, len(on) - W), key=lambda i: -on[i])
    picked, used = [], []
    for i in order:
        if any(abs(i - j) < W for j in used): continue
        used.append(i); picked.append(i * dt)
        if len(picked) >= len(ev): break
    ideal = sum(peaky(t) for t in picked) / max(1, len(picked))

    edge, ceiling = real / ctrl - 1.0, max(0.05, ideal / ctrl - 1.0)
    frac = max(0.0, min(1.0, edge / ceiling))
    return frac, (f"{real/ctrl:.2f}x better than a jittered copy of itself, against "
                  f"{ideal/ctrl:.2f}x for the best placement this audio allows -- "
                  f"{100*frac:.0f}% of the available signal"), False


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
    scores = []
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
        got = sum(pc[p] for p in want) / tot
        scores.append(got / (len(want) / 12.0))          # 1.0 means no better than flat
    if not scores: return None, "chords could not be checked"
    r = sum(scores) / len(scores)
    return min(1.0, max(0.0, (r - 1.0) / 1.2)), f"claimed notes carry {r:.2f}x their share of the energy"


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
    if not n: return None, "melody could not be checked"
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
    if not vals: return None, "pump could not be checked"
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
        ("sections", ev_sections, (m, B)), ("energy", ev_energy, (m, B)),
        ("accents", ev_accents, (m, B)), ("pump", ev_pump, (m, B)),
        ("chords", ev_chords, (m, B, sig, sr)), ("melody", ev_melody, (m, B, sig, sr)),
    ):
        try:
            r = fn(*args)
            score, why = r[0], r[1]
            na = r[2] if len(r) > 2 else (score is None)
        except Exception as e:
            score, why, na = None, f"threw: {e}", False
        out[name] = {"score": None if score is None else round(score, 4),
                     "said": why, "na": bool(na)}
    scored = [(WEIGHTS[k], v["score"]) for k, v in out.items() if v["score"] is not None]
    accuracy = sum(w * v for w, v in scored) / sum(w for w, _ in scored) if scored else 0.0
    # Coverage, because a map that claims nothing was scoring above one that claims
    # everything: five fields at 0.72 beat eight fields at 0.65, so the richer and
    # more useful map came second. Silence should not be a way to win.
    coverage = (sum(WEIGHTS[k] for k, v in out.items() if v["score"] is not None)
                / sum(WEIGHTS.values()))
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
