#!/usr/bin/env python3
"""Is the edit actually with the music? Measured from the finished video.

    work/vision/bin/python bench/cutscore.py renders/*.mp4
    work/vision/bin/python bench/cutscore.py --ir renders/x.ir.json   # bookkeeping too

THE POINT, AND THE MISTAKE IT AVOIDS. The obvious way to score a music video is
to check that its cuts land near the salient events in the map. That is worth
nothing: the policy PLACED those cuts by reading those events, so the two sides
share not just a feature family but the actual numbers. It would score close to
1.00 on any edit this repo can produce, including a bad one, and it is the same
shape as the 9 ms beat-grid agreement that AGENTS.md opens with.

So nothing here reads the map, the IR, the asset index or the policy. Two curves
are measured from the rendered file:

  visual change   mean absolute difference between consecutive frames of the
                  OUTPUT mp4, at 25 Hz and 160x90. A cut is a spike; a camera
                  move is a bump; a locked-off shot is flat.
  onset strength  half-wave-rectified spectral flux of the audio in the SAME
                  file, at the same rate.

and the question is whether they line up. Both come out of ffmpeg from one file
that has already been rendered. Neither knows what a beat is, what a drop is, or
that a map exists.

WHICH COMPARISON, AND WHY NOT THE OBVIOUS ONE. Correlating the two whole curves
was tried first and is nearly useless: the visual curve is dominated by motion
INSIDE shots -- a camera pan moves every pixel for two seconds -- while a cut is
a spike three frames wide. Across 5924 frames the cuts contribute almost nothing,
every edit scored |r| < 0.04, and the ranking was noise. The number the edit
actually controls is where its cuts fall, so the headline measure isolates them:
detect the cuts in the output, detect the onset peaks in the audio, and ask how
close the cuts sit to the peaks. The curve correlation is kept as a secondary,
because "does the picture get busier when the music does" is a real question --
just a different one, and a much weaker signal.

THE NULL. Correlation on its own means nothing, because both curves are bursty
and a bursty curve correlates with anything bursty. The reported number is where
the true alignment sits among DRAWS circular rotations of the visual curve
against the same audio. A rotation destroys the timing relationship and keeps
every other property -- the same number of cuts, the same shot lengths, the same
burstiness. If a rotated copy scores as well as the real thing, the edit is not
synchronised, it is merely busy.

WHAT THIS DOES NOT MEASURE. Whether the video is any good. Alignment is
necessary and nowhere near sufficient: cutting on every beat scores extremely
well here and is exactly the thing this project argues against. That is why
`restraint` and `spread` are reported beside it, and why a human verdict --
bench/verdict.py -- is the authority. This is a ruler, not a god.
"""
import argparse, json, os, subprocess, sys, math

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RATE = 25.0          # both curves live at this rate
VW, VH = 160, 90
DRAWS = 500
SEED = 20260910


def video_change(path):
    """Frame-to-frame change in the rendered file. Nothing to do with the plan."""
    r = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-vf", f"scale={VW}:{VH},fps={RATE}",
         "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    n = len(r.stdout) // (VW * VH)
    if n < 4:
        return None
    f = np.frombuffer(r.stdout[:n * VW * VH], np.uint8).reshape(n, VH * VW)
    return np.abs(np.diff(f.astype(np.float32), axis=0)).mean(axis=1) / 255.0


def onset_strength(path, sr=22050, band=None):
    """Spectral flux of the audio in the same file.

    `band` is (lo_hz, hi_hz) or None for the whole spectrum.

    THE WHOLE SPECTRUM IS THE WRONG BAND FOR DANCE MUSIC, and this cost a
    evening to notice. On Levels, the flux at the exact instant of a beat sits
    at the 7th percentile of the song, while 40 ms either side of it sits near
    the 50th. The flux is at a local MINIMUM on the beat.

    That is sidechain compression, not a bug. The mix ducks on the kick and
    swells after it, so positive spectral flux peaks land BETWEEN beats. The
    map's own `observations.pump` -- written by listen/pump.py from the envelope
    above 250 Hz, sharing no code with this file -- measures the release at 0.39
    of a beat, which at 128 bpm is 182 ms after the kick. Measuring beats
    against flux peaks here put the best offset at +100 to +140 ms. Two
    unrelated methods, the same displacement.

    So a full-spectrum onset detector penalises beat-aligned cutting on any
    sidechained record, which is most of the genre this repo works in. The low
    band is the fix and it is not a tuned one: the pump is applied to everything
    ABOVE the kick, so the kick's own band still peaks where the beat is.
    """
    r = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(sr),
         "-f", "f32le", "-"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    a = np.frombuffer(r.stdout, np.float32)
    if a.size < sr:
        return None
    hop = int(round(sr / RATE))
    win = hop * 2
    n = (a.size - win) // hop
    if n < 4:
        return None
    w = np.hanning(win).astype(np.float32)
    frames = np.lib.stride_tricks.as_strided(
        a, shape=(n, win), strides=(a.strides[0] * hop, a.strides[0])) * w
    S = np.abs(np.fft.rfft(frames, axis=1))
    if band:
        freqs = np.fft.rfftfreq(win, 1.0 / sr)
        keep = (freqs >= band[0]) & (freqs <= band[1])
        S = S[:, keep]
    S = np.log1p(S * 100.0)
    flux = np.maximum(0.0, np.diff(S, axis=0)).sum(axis=1)
    return flux


# Where the kick lives. The same split mapeval.bands() already uses.
LOW_BAND = (20.0, 130.0)


# Where flux[i] actually happened, in seconds after i/RATE.
#
# flux[i] is the change between two overlapping 80 ms windows, and a click first
# disturbs a window that STARTS up to 80 ms before the click itself. So the flux
# rises about three hops early, and labelling the peak i/RATE reports every
# onset roughly 90 ms before it happened.
#
# This was not a rounding detail. With no correction, cuts placed exactly on
# beats scored a hit rate of 0.000 against these peaks, and every policy --
# including the beat-cut baseline -- came out BELOW its own null. The edits were
# not the problem; the ruler was bent, and it was bent in a direction that made
# everything look equally bad, which is the hardest kind to notice.
#
# I first guessed the sign from the window arithmetic and got it backwards.
# The number below is MEASURED: --selftest renders clicks at times this file
# chose and reports the median error against them. Anything that changes the
# window, the hop or the flux has to re-run it.
ONSET_TIME_OFFSET_S = 0.092


def z(x):
    x = np.asarray(x, np.float64)
    s = x.std()
    return (x - x.mean()) / s if s > 1e-12 else x * 0.0


def align(v, a):
    """Where the true alignment sits among rotations of the video curve."""
    n = min(len(v), len(a))
    if n < int(RATE * 20):
        return None
    v, a = z(v[:n]), z(a[:n])
    true = float((v * a).mean())
    rng = np.random.default_rng(SEED)
    null = np.empty(DRAWS)
    for i in range(DRAWS):
        k = int(rng.integers(int(RATE * 2), n - int(RATE * 2)))
        null[i] = float((np.roll(v, k) * a).mean())
    return {
        "r": round(true, 4),
        "null_mean": round(float(null.mean()), 4),
        "null_sd": round(float(null.std()), 4),
        "percentile": round(100.0 * float((null < true).mean()), 1),
        "z": round(float((true - null.mean()) / max(1e-9, null.std())), 2),
    }


def cuts_from_video(v, rate=RATE):
    """Where the picture jumps, found in the output rather than read from the IR."""
    if v is None or len(v) < 5:
        return []
    med = np.median(v)
    mad = np.median(np.abs(v - med)) + 1e-9
    out = []
    for i, x in enumerate(v):
        if x > med + 6 * mad and x > 0.045:
            t = (i + 1) / rate
            if not out or t - out[-1] > 0.3:
                out.append(round(t, 3))
    return out


def onset_peaks(a, rate=RATE, refractory=0.30):
    """Local maxima of the onset curve, no two closer than `refractory`.

    The refractory period is the whole point. Without it the picking returned a
    peak every 0.24 s, which means EVERY possible instant is within 120 ms of
    one, and the distance from a cut to the nearest peak came out at the frame
    resolution for a musical edit, a random edit and a beat-cut edit alike. A
    measure that cannot separate those is not measuring.

    0.30 s is one beat at 200 bpm, so peaks can still be as dense as the beat of
    anything anyone would call fast, and no denser. It is a resolution choice
    about the audio, made without reference to any edit, and it is applied
    identically to every file scored.
    """
    if a is None or len(a) < 5:
        return []
    med = np.median(a)
    mad = np.median(np.abs(a - med)) + 1e-9
    cands = [(a[i], i / rate + ONSET_TIME_OFFSET_S) for i in range(1, len(a) - 1)
             if a[i] >= a[i - 1] and a[i] > a[i + 1] and a[i] > med + 3.0 * mad]
    cands.sort(reverse=True)               # strongest first
    kept = []
    for _v, t in cands:
        if all(abs(t - k) >= refractory for k in kept):
            kept.append(t)
    return sorted(kept)


TOL = 0.080          # two frames at 25 Hz, which is the floor on this anyway


def cut_alignment(cuts, peaks, dur):
    """What share of cuts land ON an onset, against rotated copies of the cuts.

    A HIT RATE, not a mean distance. Distance-to-nearest was tried and is the
    wrong statistic when peaks are dense: its whole range was 0 to half a peak
    gap, so a musical edit and a random one differed by a few milliseconds. A
    hit rate at a fixed tolerance asks the question the edit can actually answer.

    The null rotates the CUT TIMES around the song. That keeps their number and
    their spacing exactly and destroys only their relationship to the audio, so
    a busy edit gets no free credit for being busy. Cuts that hit no more often
    than a rotated copy of themselves are not synchronised, whatever they look
    like.
    """
    if len(cuts) < 4 or len(peaks) < 8 or dur <= 0:
        return None
    P = np.asarray(peaks)

    def hits(ts):
        idx = np.searchsorted(P, ts)
        idx = np.clip(idx, 1, len(P) - 1)
        d = np.minimum(np.abs(ts - P[idx - 1]), np.abs(P[idx] - ts))
        return float((d <= TOL).mean())

    C = np.asarray(cuts)
    true = hits(C)
    rng = np.random.default_rng(SEED)
    null = np.array([hits(np.sort((C + float(rng.uniform(0, dur))) % dur))
                     for _ in range(DRAWS)])
    return {
        "cuts": len(cuts), "peaks": len(peaks),
        "hit_rate": round(true, 3),
        "null_hit_rate": round(float(null.mean()), 3),
        "percentile": round(100.0 * float((null < true).mean()), 1),
        "z": round(float((true - null.mean()) / max(1e-9, null.std())), 2),
    }


def cut_energy(cuts, a, dur):
    """How eventful the music is AT each cut, as a percentile of the whole song.

    A second, blunter question than the hit rate, and a better discriminator.
    `on-onset` asks whether a cut coincides with a RETAINED peak, and peak
    picking keeps only the locally strongest within 0.30 s -- so a cut can land
    on a genuinely loud instant and still miss, because a louder one nearby
    suppressed the peak it would have matched. That makes the hit rate noisy
    between policies that all cut on beats.

    This asks the simpler thing: is there more going on in the music at the
    instants this edit chose than at an average instant? Same independence --
    the flux comes from the rendered file's own audio, the cut times from
    frame-differencing its own picture.
    """
    if not cuts or a is None or len(a) < 10:
        return None
    t = np.arange(len(a)) / RATE + ONSET_TIME_OFFSET_S
    order = np.sort(a)

    def pct_at(times):
        idx = np.clip(np.searchsorted(t, times), 0, len(a) - 1)
        return float(np.median(np.searchsorted(order, a[idx]) / len(order)))

    C = np.asarray(cuts)
    true = pct_at(C)
    rng = np.random.default_rng(SEED)
    null = np.array([pct_at(np.sort((C + float(rng.uniform(0, dur))) % dur))
                     for _ in range(DRAWS)])
    return {
        "percentile_of_song": round(100 * true, 1),
        "null": round(100 * float(null.mean()), 1),
        "z": round(float((true - null.mean()) / max(1e-9, null.std())), 2),
        "beats_null_pct": round(100.0 * float((null < true).mean()), 1),
    }


def restraint(v, cuts, dur):
    """How unevenly visual attention is spent. 0 = flat, 1 = all in one place."""
    if not cuts or dur <= 0:
        return {"shots": len(cuts) + 1, "gini": None, "cuts_per_min": 0.0}
    lens = np.diff([0.0] + cuts + [dur])
    lens = lens[lens > 0]
    if len(lens) < 2:
        return {"shots": len(lens), "gini": None,
                "cuts_per_min": 60.0 * len(cuts) / dur}
    s = np.sort(lens)
    n = len(s)
    gini = float((2 * np.arange(1, n + 1) - n - 1).dot(s) / (n * s.sum()))
    return {
        "shots": int(n),
        "shot_s_median": round(float(np.median(s)), 2),
        "shot_s_min": round(float(s.min()), 2),
        "shot_s_max": round(float(s.max()), 2),
        "gini": round(gini, 3),
        "cuts_per_min": round(60.0 * len(cuts) / dur, 1),
    }


def score(path):
    v = video_change(path)
    a = onset_strength(path)
    lo = onset_strength(path, band=LOW_BAND)
    if v is None:
        return {"file": path, "error": "no video frames"}
    if a is None:
        return {"file": path, "error": "no audio -- alignment cannot be measured"}
    dur = len(v) / RATE
    cuts = cuts_from_video(v)
    return {
        "file": os.path.relpath(path, ROOT),
        "duration_s": round(dur, 1),
        "cut_align": cut_alignment(cuts, onset_peaks(lo), dur),
        "cut_align_full": cut_alignment(cuts, onset_peaks(a), dur),
        "cut_energy": cut_energy(cuts, lo, dur),
        "cut_energy_full": cut_energy(cuts, a, dur),
        "curve_align": align(v, a),
        **restraint(v, cuts, dur),
    }


def bookkeeping(ir_path):
    """From the IR. NOT independent -- the policy wrote it. Reported separately
    and never mixed into the alignment number, because a system marking its own
    homework has to be visibly doing so."""
    d = json.load(open(ir_path))
    tl = d.get("timeline", [])
    musical = sum(1 for e in tl
                  if str(e.get("because", {}).get("rule", "")).startswith(("moment:", "callback")))
    forced = sum(1 for e in tl
                 if e.get("because", {}).get("rule") in ("brief-max-shot", "footage-limit"))
    return {
        "shots": len(tl),
        "cuts_with_a_musical_reason": musical,
        "cuts_forced_by_a_cap": forced,
        "share_musical": round(musical / max(1, len(tl)), 3),
        "holds": len(d.get("holds", [])),
        "budget": d.get("budget", {}),
    }


def selftest():
    """Measure the onset detector's lag against clicks at times we chose.

    The same argument as assets/generated: a detector graded against its own
    output measures nothing, so this renders audio FROM a list of times and asks
    where the detector says they are. It is the only reference here that this
    file did not produce.
    """
    import tempfile, wave, struct, random
    sr = 22050
    dur = 40.0
    rnd = random.Random(SEED)
    # Irregular spacing on purpose: evenly spaced clicks would let a detector
    # with a constant lag look correct by landing on the NEXT click.
    times, t = [], 0.7
    while t < dur - 1.0:
        times.append(round(t, 4))
        t += 0.35 + rnd.random() * 0.9
    buf = np.zeros(int(sr * dur), np.float32)
    for tt in times:
        i = int(tt * sr)
        n = int(0.012 * sr)
        env = np.exp(-np.arange(n) / (0.003 * sr))
        buf[i:i + n] += (env * np.sin(2 * np.pi * 1400 *
                                      np.arange(n) / sr)).astype(np.float32)
    buf = np.clip(buf, -1, 1)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        path = f.name
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((buf * 32767).astype("<i2").tobytes())
    try:
        peaks = np.array(onset_peaks(onset_strength(path)))
        errs = []
        for tt in times:
            if not len(peaks):
                break
            errs.append(float(peaks[np.argmin(np.abs(peaks - tt))] - tt))
        errs = np.array(errs)
        matched = int((np.abs(errs) <= 0.15).sum())
        print(f"onset detector self-test: {len(times)} clicks, "
              f"{len(peaks)} peaks, {matched} matched within 150 ms")
        if matched:
            e = errs[np.abs(errs) <= 0.15]
            print(f"  median error {np.median(e)*1000:+.0f} ms, "
                  f"mean {e.mean()*1000:+.0f} ms, "
                  f"|max| {np.abs(e).max()*1000:.0f} ms")
            print(f"  ONSET_TIME_OFFSET_S is {ONSET_TIME_OFFSET_S*1000:.0f} ms; "
                  f"residual bias should be within one frame ({1000/RATE:.0f} ms)")
            ok = abs(np.median(e)) <= 1.0 / RATE
            print("  " + ("within one frame -- ok" if ok else
                          "BIASED: add the median above to ONSET_TIME_OFFSET_S"))
            return 0 if ok else 1
        print("  FAIL: nothing matched")
        return 1
    finally:
        os.unlink(path)


def brief_swap(slug, policy="rules", maps=None):
    """Do the briefs actually change the edit?

    A brief hard-coded into a policy is a brief that has to be re-implemented for
    the next job, and -- worse -- it is undetectable: an edit tuned until the
    demo looked good is indistinguishable from one that generalises, unless you
    can show the policy responds to being told something different.

    So this runs every brief through the same policy over the same song and the
    same footage, and reports how much the resulting cut sets overlap. Two briefs
    producing the same cuts means one of them is not being read.
    """
    briefs = sorted(os.path.splitext(f)[0] for f in
                    os.listdir(os.path.join(ROOT, "briefs")) if f.endswith(".json"))
    env = dict(os.environ)
    if maps:
        env["LIMELIGHT_MAPS"] = maps
    cuts = {}
    for b in briefs:
        r = subprocess.run(
            ["node", os.path.join(ROOT, "readers", "video", "edit.js"),
             "--slug", slug, "--brief", b, "--policy", policy],
            capture_output=True, text=True, cwd=ROOT, env=env)
        if r.returncode != 0:
            print(f"  {b}: failed -- {r.stderr.strip()[:150]}")
            continue
        ir = json.loads(r.stdout)
        cuts[b] = [e["start"] for e in ir["timeline"][1:]]

    print(f"BRIEF SWAP -- {slug}, policy={policy}")
    for b, c in cuts.items():
        print(f"  {b:22} {len(c):4} cuts")
    print()
    names = list(cuts)
    worst = 0.0
    print(f"  {'pair':46} {'shared cuts':>12}")
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a, b = cuts[names[i]], cuts[names[j]]
            if not a or not b:
                continue
            shared = sum(1 for t in a if any(abs(t - u) < 0.05 for u in b))
            frac = shared / max(1, min(len(a), len(b)))
            worst = max(worst, frac)
            print(f"  {names[i][:21]:22} vs {names[j][:21]:22} {frac:11.1%}")
    print()
    if worst > 0.9:
        print(f"FAIL: two briefs share {worst:.0%} of their cuts. One is not being read.")
        return 1
    print(f"Most similar pair shares {worst:.0%} of its cuts. The briefs are")
    print("reaching the policy.")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="*")
    ap.add_argument("--brief-swap", metavar="SLUG")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--policy", default="rules")
    ap.add_argument("--maps")
    ap.add_argument("--ir", action="append", default=[])
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    if a.selftest:
        return selftest()
    if a.brief_swap:
        return brief_swap(a.brief_swap, a.policy, a.maps)

    rows = [score(f) for f in a.files]
    if a.json:
        print(json.dumps({"videos": rows,
                          "ir": {p: bookkeeping(p) for p in a.ir}}, indent=1))
        return 0

    print("MEASURED FROM THE RENDERED FILE -- no map, no IR, no policy")
    print(f"{'file':30} {'cuts/m':>6} {'gini':>6} | "
          f"{'LOW BAND (kick)':>26} | {'full spectrum':>20}")
    print(f"{'':30} {'':6} {'':6} | {'on-onset':>9} {'energy@cut':>10} {'z':>5} | "
          f"{'on-onset':>9} {'energy@cut':>9}")
    for r in rows:
        if r.get("error"):
            print(f"{os.path.basename(r['file'])[:40]:40} {r['error']}")
            continue
        ca = r.get("cut_align") or {}
        ce = r.get("cut_energy") or {}
        caf = r.get("cut_align_full") or {}
        cef = r.get("cut_energy_full") or {}
        nan = float("nan")
        print(f"{os.path.basename(r['file'])[:30]:30} {r['cuts_per_min']:6.1f} "
              f"{(r.get('gini') if r.get('gini') is not None else nan):6.3f} | "
              f"{ca.get('hit_rate', nan):9.3f} "
              f"{ce.get('percentile_of_song', nan):9.1f}% {ce.get('z', nan):5.2f} | "
              f"{caf.get('hit_rate', nan):9.3f} "
              f"{cef.get('percentile_of_song', nan):8.1f}%")
    print()
    print("The LOW BAND is the one to read. Full-spectrum flux is displaced by")
    print("sidechain compression -- the mix ducks on the kick and swells after")
    print("it, so its peaks land BETWEEN beats and it penalises beat-aligned")
    print("cutting on most dance music. The kick's own band is not ducked.")
    print()
    print(f"on-onset  share of cuts within {TOL*1000:.0f} ms of a retained onset peak.")
    print("energy@cut  how eventful the music is at the cut, as a percentile of")
    print("            the whole song. The better discriminator of the two: a cut")
    print("            can land on a loud instant and still miss a peak that a")
    print("            louder neighbour suppressed.")
    print("Both nulls rotate the cut times -- identical count and spacing, no")
    print("relationship to the audio.")
    print()
    print("Beating the null means the cuts are ON something. It does NOT mean the")
    print("edit is good: cutting on every beat wins this outright and is exactly")
    print("what this lane argues against. Read it beside gini, beside how many")
    print("cuts had a musical reason, and beside the human verdict -- which is")
    print("the authority, and which nothing here can substitute for.")

    if a.ir:
        print()
        print("FROM THE IR -- the policy's own account of itself, not independent")
        for p in a.ir:
            b = bookkeeping(p)
            print(f"  {os.path.basename(p)[:52]:52} "
                  f"{b['shots']:4} shots  musical {b['share_musical']:.2f}  "
                  f"forced {b['cuts_forced_by_a_cap']:3}  holds {b['holds']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
