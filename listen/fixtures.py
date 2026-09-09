import sys, os, json, math, wave, array, struct

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

SR = 32000
BPM = 120.0
PER = 60.0 / BPM
BARS = 16
DUR = BARS * 4 * PER


def _write_wav(path, samples):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    a = array.array("h", (max(-32768, min(32767, int(v * 32767))) for v in samples))
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(a.tobytes())


def filter_sweep(path):
    n = int(DUR * SR)
    out = [0.0] * n
    for b in range(BARS):
        t0 = b * 4 * PER
        harmonics = 2 + int(22 * b / max(1, BARS - 1))
        i0, i1 = int(t0 * SR), min(n, int((t0 + 4 * PER) * SR))
        seg = [0.0] * (i1 - i0)
        for k in range(1, harmonics + 1):
            f = 110.0 * k
            if f > SR * 0.45:
                break
            amp = 1.0 / k
            for i in range(len(seg)):
                seg[i] += amp * math.sin(2 * math.pi * f * (i / SR))
        for beat in range(4):
            bi = int(beat * PER * SR)
            for i in range(bi, min(len(seg), bi + int(0.05 * SR))):
                x = (i - bi) / (0.05 * SR)
                seg[i] += (
                    1.4
                    * math.exp(-9 * x)
                    * math.sin(2 * math.pi * 58.0 * (i - bi) / SR)
                )
        rms = math.sqrt(sum(v * v for v in seg) / max(1, len(seg))) or 1e-9
        g = 0.22 / rms
        for i in range(len(seg)):
            out[i0 + i] = seg[i] * g
    _write_wav(path, out)
    return {"bars": BARS, "period": PER}


def sweep_map(rising, slug):
    beats = [round(i * PER, 6) for i in range(BARS * 4)]
    downs = beats[0::4]
    energy = []
    for b, d in enumerate(downs):
        f = b / max(1, len(downs) - 1)
        energy.append([round(d, 6), round(0.08 + 0.84 * f, 4) if rising else 0.5])
    return {
        "map": "0.3",
        "song": {"title": slug + ".wav", "artist": "?", "length": round(DUR, 3)},
        "made_by": {
            "how": "synthetic",
            "who": "listen/fixtures.py",
            "note": "the times here are CAUSES: the audio was rendered from this file. "
            "Constant RMS per bar, a filter opening from 2 to 24 harmonics "
            "across the record. Loudness does not move; how much is going on "
            "does.",
        },
        "grid": {
            "period": round(PER, 6),
            "phase": 0.0,
            "bpm": BPM,
            "bar_phase": 0,
            "locked": True,
            "how": "authored",
        },
        "beats": beats,
        "downbeats": downs,
        "chapters": [{"at": 0.0, "name": "intro"}],
        "moments": [],
        "spans": [],
        "energy": energy,
        "confidence": 0.9,
    }


def broken_corrections():
    # rule 5 asks every field for a broken-file entry that must fail. A correction is
    # testimony, so there is no measurement to corrupt -- the strict schema is the whole
    # check, and this is the file that has to be refused by it.
    import corrections as CO

    cases = [
        ("a reason nobody wrote",
         [{"at": "x", "field": "grid", "was": 1, "now": 2, "why": "   ", "who": "me"}]),
        ("the same correction twice",
         [{"at": "x", "field": "grid", "was": 1, "now": 2, "why": "ok", "who": "me"},
          {"at": "x", "field": "grid", "was": 1, "now": 2, "why": "ok", "who": "me"}]),
        ("no who",
         [{"at": "x", "field": "grid", "was": 1, "now": 2, "why": "ok"}]),
        ("no was, so nothing to learn from",
         [{"at": "x", "field": "grid", "now": 2, "why": "ok", "who": "me"}]),
        ("a key the schema never agreed to",
         [{"at": "x", "field": "grid", "was": 1, "now": 2, "why": "ok", "who": "me",
           "cue": "strobe"}]),
        ("not an object at all", ["moved the drop"]),
    ]
    good = [{"at": "x", "field": "grid", "was": 1, "now": 2, "why": "ok", "who": "me"}]

    ok = True
    print("== a corrections log that must be refused")
    for name, entries in cases:
        errs = CO.validate(entries)
        ok = ok and bool(errs)
        print("   %s %-34s %s" % ("ok  " if errs else "FAIL", name,
                                  errs[0] if errs else "ACCEPTED -- the schema is not strict"))
    errs = CO.validate(good)
    ok = ok and not errs
    print("   %s %-34s %s" % ("ok  " if not errs else "FAIL", "a well-formed one is accepted",
                              "; ".join(errs) if errs else "no complaints"))
    return ok


def normalised_stems():
    """The stems fixture rule 5 asks for: the exact fault that was in the file.

    stems.sources was each stem's RMS divided by its own maximum. The check
    added with the rewrite asks whether the six levels, summed as energy, follow
    the mix's own loudness -- and a set of series each normalised to its own peak
    cannot, because the quiet ones are inflated to the same height as the loud
    ones. This asserts the broken form scores materially worse on every song we
    have, not on average."""
    import json, copy
    import mapeval as ME
    from mapio import map_path

    ok = True
    print("== stems normalised per stem, which is what the file used to hold")
    for slug in ("levels", "starlight", "mizhiyoram", "dont-look-down", "the-nights"):
        mp = map_path(slug)
        if not mp:
            continue
        m = json.load(open(mp))
        sig, sr, cached = ME.audio_for(slug)
        if sig is None:
            print("   --   %-16s no audio, skipped" % slug)
            continue
        B = cached if cached is not None else ME.bands(sig, sr)
        good = ME.ev_stems(m, B)[0]
        bad_m = copy.deepcopy(m)
        src = bad_m["stems"]["sources"]
        for n, v in src.items():
            lo, hi = min(v), max(v)
            src[n] = [round((x - lo) / max(1e-9, hi - lo), 4) for x in v]
        bad_m["stems"].pop("comparable", None)
        bad = ME.ev_stems(bad_m, B)[0]
        good = 0.0 if good is None else good
        bad = 0.0 if bad is None else bad
        worse = good - bad >= 0.15
        ok = ok and worse
        print("   %s %-16s levels %.2f, normalised %.2f  (%.2f worse)"
              % ("ok  " if worse else "FAIL", slug, good, bad, good - bad))
    return ok


def wrong_meter_and_tempo():
    """rule 5's broken-file entries for meter and tempo_stability.

    meter: claim a bar length harmony contradicts. 3, 5, 7 and 9 all put chord
    changes in mid-bar over and over on records whose changes sit on 2s, 4s and
    8s. Not 2 or 8 -- harmony genuinely cannot tell a bar from its double or
    half, this check says so in its docstring, and asserting otherwise here
    would be asserting something false.

    tempo_stability: nudge the period by 0.05%. That is 120 ms of accumulated
    slip across a four-minute record, which ev_grid barely notices (0.93 on
    Levels) and this check has to."""
    import json, copy
    import mapeval as ME
    from mapio import map_path

    ok = True
    print("== a bar length harmony contradicts, and a tempo 0.05% out")
    for slug in ("levels", "starlight", "mizhiyoram", "dont-look-down", "the-nights"):
        mp = map_path(slug)
        sig, sr, cached = ME.audio_for(slug)
        if not mp or sig is None:
            continue
        B = cached if cached is not None else ME.bands(sig, sr)
        m = json.load(open(mp))

        good = ME.ev_meter(m, B)[0]
        if good is None:
            print("   --   %-16s meter: harmony cannot answer on this record, so nothing to "
                  "falsify" % slug)
        else:
            worst = 0.0
            for n in (3, 5, 7, 9):
                mm = copy.deepcopy(m)
                mm.setdefault("grid", {})["beats_per_bar"] = n
                v = ME.ev_meter(mm, B)[0]
                worst = max(worst, 0.0 if v is None else v)
            good_enough = good - worst >= 0.30
            ok = ok and good_enough
            print("   %s %-16s meter: 4 beats scores %.2f, the best of 3/5/7/9 scores %.2f"
                  % ("ok  " if good_enough else "FAIL", slug, good, worst))

        per, ph = m["grid"]["period"], m["grid"]["phase"]
        base = ME.ev_tempo(m, B)[0]
        mm = copy.deepcopy(m)
        p2 = per * 1.0005
        mm["grid"]["period"] = p2
        mm["beats"] = [ph + i * p2 for i in range(len(m["beats"]))]
        off = ME.ev_tempo(mm, B)[0]
        base = 0.0 if base is None else base
        off = 0.0 if off is None else off
        caught = base - off >= 0.15
        ok = ok and caught
        print("   %s %-16s tempo: as claimed %.2f, 0.05%% fast %.2f  (%.2f worse)"
              % ("ok  " if caught else "FAIL", slug, base, off, base - off))
    return ok


def flipped_pan():
    """rule 5's broken-file entry for pan, and the cleanest one in the set:
    negating every claimed pan leaves a perfectly well-formed field that says
    the opposite thing. It has to score zero, and shuffling the claims has to
    land at chance."""
    import json, copy, random
    import mapeval as ME
    from mapio import map_path

    ok = True
    print("== a pan field with every side swapped")
    for slug in ("levels", "starlight", "mizhiyoram", "dont-look-down", "the-nights"):
        mp = map_path(slug)
        sig, sr, cached = ME.audio_for(slug)
        if not mp or sig is None:
            continue
        B = cached if cached is not None else ME.bands(sig, sr)
        m = json.load(open(mp))
        if not ((m.get("observations") or {}).get("pan") or {}).get("entries"):
            print("   --   %-16s no pan claimed" % slug)
            continue
        good = ME.ev_pan(m, B, slug)[0]
        flip = copy.deepcopy(m)
        for e in flip["observations"]["pan"]["entries"]:
            e["pan"] = -e["pan"]
        bad = ME.ev_pan(flip, B, slug)[0]
        shuf = copy.deepcopy(m)
        ents = shuf["observations"]["pan"]["entries"]
        vals = [e["pan"] for e in ents]
        random.Random(5).shuffle(vals)
        for e, v in zip(ents, vals):
            e["pan"] = v
        mid = ME.ev_pan(shuf, B, slug)[0]
        good = 0.0 if good is None else good
        bad = 0.0 if bad is None else bad
        mid = 0.0 if mid is None else mid
        fine = bad <= 0.05 and mid <= 0.30 and good >= 0.50
        ok = ok and fine
        print("   %s %-16s as claimed %.2f, sides swapped %.2f, shuffled %.2f"
              % ("ok  " if fine else "FAIL", slug, good, bad, mid))
    return ok


def run():
    import mapeval as ME

    wav = os.path.join(ROOT, "synth", "out", "_fx-filter-sweep.wav")
    filter_sweep(wav)
    B = ME.bands(*ME.load(wav))

    rise = sweep_map(True, "_fx-filter-sweep")
    flat = sweep_map(False, "_fx-filter-sweep")

    dt, rms = B["dt"], B["rms"]
    per_bar = []
    for b in range(BARS):
        i0, i1 = int(b * 4 * PER / dt), int((b + 1) * 4 * PER / dt)
        seg = rms[i0 : min(i1, len(rms))]
        per_bar.append(sum(seg) / max(1, len(seg)))
    lo, hi = min(per_bar), max(per_bar)
    flatness = (hi - lo) / max(1e-9, hi)

    s_rise = ME.ev_energy(rise, B)
    s_flat = ME.ev_energy(flat, B)
    r_loud = ME._corr([v for _, v in rise["energy"]], per_bar)

    def spearman(a, b):
        ra = sorted(range(len(a)), key=lambda i: a[i])
        rb = sorted(range(len(b)), key=lambda i: b[i])
        pa, pb = [0] * len(a), [0] * len(b)
        for r, i in enumerate(ra):
            pa[i] = r
        for r, i in enumerate(rb):
            pb[i] = r
        return ME._corr(pa, pb)

    spans = [(d, d + 4 * PER) for d, _ in rise["energy"]]
    comp = ME.energy_composite(B, spans)
    claimed = [v for _, v in rise["energy"]]
    rho = spearman(claimed, comp) if comp else 0.0

    ok = True

    def say(name, good, detail):
        nonlocal ok
        ok = ok and good
        print("   %s %-34s %s" % ("ok  " if good else "FAIL", name, detail))

    print("== filter opens, volume stays flat")
    say("the fixture really is flat", flatness < 0.12,
        "loudest bar is %.1f%% above the quietest, so loudness carries no information here"
        % (100 * flatness))
    say("the composite follows the filter", rho >= 0.90,
        "rank correlation %+.2f between the authored curve and the composite" % rho)
    say("a rising energy curve is credited", s_rise[0] is not None and s_rise[0] >= 0.50,
        "rising curve scores %.2f" % (s_rise[0] or 0))
    say("a flat energy curve is not", s_flat[0] is not None and s_rise[0] - s_flat[0] >= 0.20,
        "flat curve scores %.2f, %.2f below the rising one"
        % (s_flat[0] or 0, (s_rise[0] or 0) - (s_flat[0] or 0)))
    # Deliberately NOT asserting anything about r_loud. The first version of this
    # test demanded |r| < 0.5 against loudness and failed at -0.80 -- on a record
    # whose level varies 1.9%. Correlation is scale-blind, so a meaningless drift
    # lines up with any monotone curve. The range check above is the honest form
    # of the same question, and the scorer now gates the loudness vote on it.
    print("   loudness correlation here is r=%+.2f on a %.1f%% range, which is why "
          "correlation alone cannot be trusted" % (r_loud, 100 * flatness))
    print("   rising: %s" % s_rise[1][:150])
    print()
    ok = broken_corrections() and ok
    print()
    ok = normalised_stems() and ok
    print()
    ok = wrong_meter_and_tempo() and ok
    print()
    ok = flipped_pan() and ok
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(run())
