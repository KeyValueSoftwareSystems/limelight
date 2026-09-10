#!/usr/bin/env python3
"""Where this record sits against other records, from a corpus of real music.

    python3 listen/percentile.py --corpus <dir> [slug ...] [--write]

This field was null through two rounds, and the reason given was "the corpus is
five songs, and a percentile over five swings 40 points under a bootstrap". That
was true and it was not the whole truth: I wrote "more songs are needed" without
noticing that free corpora of real recordings exist. FMA is 8000 Creative
Commons tracks; MTG-Jamendo is 55000. The blocker was never availability.

The brief was explicit that this must not be filled from `synth/compose.py`, and
it is not: a percentile over generated music describes the distribution of the
generator. Every track behind this number is a real recording by a real person.

WHAT THE CORPUS CAN AND CANNOT SUPPORT. FMA-small ships 30-second excerpts, so
the features here are all TEXTURE -- how busy, how bright, how much the level
moves inside half a minute. Arrangement features are deliberately absent: drops
per minute and whole-song energy range cannot be measured on an excerpt, and
computing them anyway against a corpus that cannot answer them would be the same
mistake in a new place. Those stay null until the corpus is full-length.

To compare like with like, our own songs are measured the same way: every
non-overlapping 30-second window, then the median across windows. A single
window would make the number depend on where the excerpt fell.

The check is the one the brief asked for and it is a gate, not decoration: the
corpus is resampled with replacement, and any feature whose percentile swings
more than MAX_SWING points between the 10th and 90th resample is written as
null with its swing recorded. On five songs every feature swung 40 points. The
same code decides here.
"""
import sys, os, json, math, glob, random

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from mapio import map_path
import mapeval as ME

WINDOW = 30.0
MAX_SWING = 12.0        # percentile points between the 10th and 90th resample
DRAWS = 200
MIN_CORPUS = 60
MIN_SPREAD = 0.15       # (p90-p10)/median across the corpus, before any percentile


def features(B, t0, t1):
    """Texture only, and every one of them a count or a ratio -- nothing that
    moves when the volume does, which is the lesson from the energy composite."""
    dt = B["dt"]
    i0, i1 = int(t0 / dt), int(t1 / dt)
    rms, low, high = B["rms"][i0:i1], B["low"][i0:i1], B["high"][i0:i1]
    if len(rms) < 40:
        return None
    span = max(1e-9, t1 - t0)

    def concentration(series):
        """What share of the onset energy arrives in the busiest tenth of the
        frames. Sparse music concentrates its flux into a few hits; dense music
        spreads it. A shape statistic, so it cannot move when the volume does.

        This replaces an onsets-per-second count that was measuring its own
        threshold: the count used the 80th percentile OF THE SAME WINDOW, so
        roughly a fifth of frames cleared it by construction and the answer came
        out 18.0 to 20.0 across 200 real recordings -- a spread of 0.10 against
        the median. Percentiles built on it would have ranked songs on rounding
        noise."""
        o = sorted((max(0.0, series[i] - series[i - 1]) for i in range(1, len(series))),
                   reverse=True)
        tot = sum(o)
        if tot <= 0:
            return 0.0
        top = max(1, len(o) // 10)
        return sum(o[:top]) / tot

    a = sorted(rms)
    p10, p90 = a[int(0.10 * (len(a) - 1))], a[int(0.90 * (len(a) - 1))]
    tot = sum(low) + sum(high)
    return {
        "onset_concentration": concentration(rms),
        "high_onset_concentration": concentration(high),
        "brightness": (sum(high) / tot) if tot > 0 else 0.0,
        "level_swing_db": 20 * math.log10(max(1e-9, p90) / max(1e-9, p10)),
    }


def corpus_features(paths, limit=None):
    out = []
    for k, p in enumerate(paths if limit is None else paths[:limit]):
        try:
            sig, sr = ME.load(p)
            B = ME.bands(sig, sr)
            dur = B["dt"] * len(B["rms"])
            f = features(B, 0.0, min(WINDOW, dur))
            if f:
                out.append(f)
        except Exception:
            continue
    return out


def song_features(slug):
    """Median across every whole 30-second window, so the answer does not
    depend on which excerpt was taken."""
    sig, sr, cached = ME.audio_for(slug)
    if sig is None:
        return None
    B = cached if cached is not None else ME.bands(sig, sr)
    dur = B["dt"] * len(B["rms"])
    got = []
    t = 0.0
    while t + WINDOW <= dur:
        f = features(B, t, t + WINDOW)
        if f:
            got.append(f)
        t += WINDOW
    if not got:
        return None
    keys = got[0].keys()
    return {k: sorted(g[k] for g in got)[len(got) // 2] for k in keys}, len(got)


def pct(values, x):
    return 100.0 * sum(1 for v in values if v < x) / max(1, len(values))


def stability(values, x, rng):
    """The check: does this percentile survive resampling the corpus?"""
    ps = []
    n = len(values)
    for _ in range(DRAWS):
        samp = [values[rng.randrange(n)] for _ in range(n)]
        ps.append(pct(samp, x))
    ps.sort()
    return ps[int(0.10 * (DRAWS - 1))], ps[int(0.90 * (DRAWS - 1))]


def analyse(slug, corpus, write=False):
    mp = map_path(slug)
    if not mp:
        return {"error": "no map"}
    sf = song_features(slug)
    if sf is None:
        return {"error": "no audio to measure"}
    mine, nwin = sf
    rng = random.Random(20260910)
    out, kept, dropped = {}, 0, 0
    for k in mine:
        vals = [c[k] for c in corpus if k in c]
        if len(vals) < MIN_CORPUS:
            continue
        # First gate: does this feature vary across real music at all? An
        # onsets-per-second count got this far once and it read 18.0 to 20.0
        # across 200 recordings, because its threshold was the 80th percentile
        # of its own window. A percentile over a constant ranks rounding noise,
        # and it looks exactly like a percentile over something real.
        sv = sorted(vals)
        q = lambda f: sv[int(f * (len(sv) - 1))]
        spread = (q(0.9) - q(0.1)) / max(1e-9, abs(q(0.5)))
        if spread < MIN_SPREAD:
            out[k] = {"value": round(mine[k], 4), "percentile": None,
                      "corpus_spread": round(spread, 3),
                      "why_null": "this feature does not vary across the corpus -- p10 %.3f, "
                                  "p90 %.3f, a spread of %.2f against the median. It is "
                                  "measuring its own definition, not the music."
                                  % (q(0.1), q(0.9), spread)}
            dropped += 1
            continue
        p = pct(vals, mine[k])
        lo, hi = stability(vals, mine[k], rng)
        swing = hi - lo
        stable = swing <= MAX_SWING
        out[k] = {
            "value": round(mine[k], 4),
            "percentile": round(p, 1) if stable else None,
            "resample_swing_points": round(swing, 1),
            "corpus_spread": round(spread, 3),
            "stable": stable,
        }
        if not stable:
            out[k]["why_null"] = ("the percentile moves %.0f points between the 10th and 90th "
                                  "resample of the corpus, past the %.0f-point limit. A number "
                                  "that unstable is a fact about which tracks are in the "
                                  "corpus." % (swing, MAX_SWING))
        kept += 1 if stable else 0
        dropped += 0 if stable else 1

    m = json.load(open(mp))
    m.setdefault("observations", {})["percentile"] = {
        "rate": "per_song",
        "unit": "0-100, the share of corpus tracks this record is above",
        "corpus": {"n": len(corpus), "source": "FMA-small (Free Music Archive), Creative "
                                               "Commons, real recordings",
                   "excerpt_seconds": WINDOW},
        "how": "texture features on every whole %.0f-second window of this record, median "
               "across windows, against the same features on the first %.0f seconds of each "
               "corpus track" % (WINDOW, WINDOW),
        "windows_measured": nwin,
        "provenance": "measured",
        "not_from_synthetic_audio": "there is a generator in this repository and it was not "
                                    "used. A percentile over generated music describes the "
                                    "distribution of the generator, and nothing about the "
                                    "number's shape would reveal that.",
        "texture_only": "all four features are counts or ratios measured inside half a minute. "
                        "Arrangement features -- drops per minute, whole-song energy range -- "
                        "are absent because a 30-second excerpt cannot answer them, and they "
                        "stay null until the corpus is full-length tracks.",
        "checked_by": "two gates. A feature must VARY across the corpus -- (p90-p10)/median at "
                      "least %.2f -- and its percentile must survive %d resamples of the "
                      "corpus without swinging more than %.0f points. A feature failing "
                      "either is written null with the number that failed it."
                      % (MIN_SPREAD, DRAWS, MAX_SWING),
        "features": out,
    }
    if write:
        json.dump(m, open(mp, "w"), indent=1, ensure_ascii=False)
        open(mp, "a").write("\n")
    return {"slug": slug, "windows": nwin, "stable": kept, "unstable": dropped,
            "features": out, "wrote": write}


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    cdir = None
    for i, a in enumerate(sys.argv):
        if a == "--corpus" and i + 1 < len(sys.argv):
            cdir = sys.argv[i + 1]
    if not cdir:
        print("need --corpus <dir of audio files>")
        sys.exit(2)
    paths = sorted(glob.glob(os.path.join(cdir, "**", "*.mp3"), recursive=True)
                   + glob.glob(os.path.join(cdir, "**", "*.wav"), recursive=True))
    args = [a for a in args if a != cdir]
    print("  corpus: %d files under %s" % (len(paths), cdir))
    corpus = corpus_features(paths)
    print("  measured %d of them" % len(corpus))
    if len(corpus) < MIN_CORPUS:
        print("  need at least %d usable tracks" % MIN_CORPUS)
        sys.exit(1)
    for slug in args or ["levels", "starlight", "mizhiyoram", "dont-look-down", "the-nights"]:
        r = analyse(slug, corpus, write)
        if "error" in r:
            print("  %-16s %s" % (slug, r["error"]))
            continue
        print("  %-16s %d windows | %d stable, %d unstable%s"
              % (slug, r["windows"], r["stable"], r["unstable"],
                 "  -> written" if write else ""))
        for k, v in r["features"].items():
            print("     %-24s %8.3f  ->  %s  (swing %.0f pts)"
                  % (k, v["value"],
                     ("%5.1f pct" % v["percentile"]) if v["stable"] else " null    ",
                     v["resample_swing_points"]))
