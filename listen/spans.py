#!/usr/bin/env python3
"""spans, decoded rather than scanned.

    python3 listen/spans.py [slug ...] [--write]

What was here before was a greedy walk over the map's own `energy` curve: step
back from each drop while the curve does not fall by more than 0.03, and if you
walked at least three bars call it a build. Three things wrong with that.

It was not a measurement. Every input came from a curve already in the file, so
a reader could compute the same spans -- and by rule 3 that means they do not
belong in the map at all. This decodes from the per-bar STEM LEVELS and the
harmonic rhythm instead, neither of which a reader can turn into a span, and
both of which come from the recording.

It was greedy. A local threshold cannot express "a build is usually 8 or 16
bars", "two builds in a row are one build", or "a build ends on a bar line", so
it produced spans of 3, 12 and 19 bars ending wherever the walk stopped.

And it could not say anything but "build". readers/src/recipe4.js has looked for
`kind === 'quiet'` spans since it was written and no map of ours ever emitted
one, so every quiet passage fell through to guessing from the chapter name.

The decode. States are flat, build and quiet. Segment boundaries are restricted
to four-bar multiples INSIDE the decode rather than snapped afterwards, which is
the difference between a build that ends on a bar line and one that is moved
there once it is too late to reconsider. Durations carry a prior: 8 and 16 bars
are the cheapest, 4 is dear, past 32 is refused. Transitions carry a cost:
build -> build is expensive because that is one build, build -> flat is free
because a build has to resolve into something, and quiet -> build is cheap
because that is how a record is put together. Then a semi-Markov Viterbi over
those segments, which is O(boundaries^2 x states^2) and takes milliseconds.

Features, per bar, all from measured fields and none from `energy`:

  active     how many stems sit within 12 dB of their own 90th percentile. A
             COUNT, not a level -- the same lesson as the energy composite,
             where using a level made the check agree with loudness and
             measure nothing.
  top_share  the share of the bar's stem energy held by anything that is not
             drums or bass. What opens up during a build.
  drum_share the drums' share. What leaves during a build and slams back at
             the drop.
  chord_rate chord changes per bar, from ChordMini.

`rise` stays a shape classification, but of the decoded thickness rather than of
the energy curve, and it now ships with the margin it won by.

Checked in mapeval.ev_spans against the energy composite from section 1a --
onset rate, high-band onset rate, band occupancy -- computed from the raw
waveform, against randomly placed spans of the same durations as a control. The
two sides share the recording and nothing else: this reads separated stem levels
and chord boundaries, that reads onset counts and band occupancy on the mix.
"""
import sys, os, json, math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapio import map_path

STATES = ("flat", "build", "quiet")
BAR_STEP = 4                 # boundaries land on four-bar multiples, in the decode
MIN_BARS, MAX_BARS = 4, 32
NEAR_TOP_DB = 12.0

# Duration prior, in bars, as a cost. Cheapest at 8 and 16 -- the lengths a
# four-on-the-floor record is built out of -- and rising away from them.
def dur_cost(bars, state):
    if bars < MIN_BARS or bars > MAX_BARS:
        return None
    if state == "flat":
        return 0.0
    best = min(abs(math.log2(bars / 8.0)), abs(math.log2(bars / 16.0)))
    return 1.30 * best

TRANS = {
    ("flat", "flat"): 9.9, ("flat", "build"): 0.0, ("flat", "quiet"): 0.15,
    ("build", "flat"): 0.0, ("build", "build"): 2.5, ("build", "quiet"): 0.6,
    ("quiet", "flat"): 0.2, ("quiet", "build"): 0.0, ("quiet", "quiet"): 9.9,
}


def features(m):
    st = m.get("stems") or {}
    src = st.get("sources") or {}
    lv = st.get("levels") or {}
    downs = m.get("downbeats") or []
    if not src or len(downs) < 16:
        return None
    present = [n for n, v in src.items()
               if v and (lv.get(n, {}).get("present") is not False)]
    if len(present) < 3:
        return None
    nb = min(len(downs), min(len(src[n]) for n in present))
    top = {}
    for n in present:
        v = sorted(src[n][:nb])
        top[n] = v[int(0.90 * (len(v) - 1))]
    segs = ((m.get("observations") or {}).get("chords") or {}).get("segments") or []
    starts = [s["from"] for s in segs
              if s.get("from") is not None and s.get("chord") not in (None, "N")]
    bar = (downs[-1] - downs[0]) / max(1, len(downs) - 1)

    active, tops, drums, chords = [], [], [], []
    for i in range(nb):
        lin = {n: 10 ** (src[n][i] / 10.0) for n in present}
        tot = sum(lin.values()) or 1e-12
        active.append(sum(1 for n in present if src[n][i] >= top[n] - NEAR_TOP_DB))
        tops.append(sum(v for n, v in lin.items() if n not in ("drums", "bass")) / tot)
        drums.append(lin.get("drums", 0.0) / tot)
        a, b = downs[i], downs[i] + bar
        chords.append(sum(1 for t in starts if a <= t < b))
    lands = sorted(x["at"] for x in (m.get("moments") or [])
                   if x.get("kind") in ("drop", "stop") and x.get("at") is not None)
    return {"n": nb, "active": active, "top_share": tops, "drum_share": drums,
            "chord_rate": chords, "bar": bar, "downbeats": downs[:nb],
            "present": present, "lands": lands}


def _z(a):
    n = len(a)
    mu = sum(a) / n
    sd = (sum((x - mu) ** 2 for x in a) / n) ** 0.5 or 1e-9
    return [(x - mu) / sd for x in a]


def thickness(F):
    """One number per bar for how much is going on, from a count and a share.
    Deliberately not a level: two of the three inputs cannot move when the
    volume does."""
    za, zt = _z(F["active"]), _z(F["top_share"])
    return [0.6 * za[i] + 0.4 * zt[i] for i in range(F["n"])]


def emit(F, th, i, j, state):
    """What it costs to call bars [i, j) this state. Lower is better."""
    seg = th[i:j]
    n = len(seg)
    if n < 2:
        return 9.9
    if state == "flat":
        return 0.35
    if state == "quiet":
        return max(0.0, 1.6 + sum(seg) / n)          # thin bars are cheap to call quiet
    # build: a build is the run-up to something. The first version of this had
    # no notion of what it runs up TO, and decoded 24-bar builds covering a
    # quarter of Levels and ending nowhere in particular. A build has to end at
    # a drop or a stop -- those are measured from loudness steps in the
    # recording and checked at weight 2.0, so anchoring here inherits their
    # anchoring rather than inventing one.
    end_t = F["downbeats"][min(j, len(F["downbeats"]) - 1)]
    lands = F["lands"]
    if not lands:
        return 9.9
    near = min(abs(end_t - x) for x in lands)
    if near > 0.75 * F["bar"]:
        return 9.9
    # and it cannot contain one. A build resolves at the first drop it reaches;
    # without this the decode ran Levels' first build from 60 s straight past
    # the drops at 64.9 and 79.9 to the stop at 96.8, calling three events one
    # long approach.
    start_t = F["downbeats"][i]
    if any(start_t + 0.5 * F["bar"] < x < end_t - 0.5 * F["bar"] for x in lands):
        return 9.9
    rise = seg[-1] - seg[0]
    ups = sum(1 for k in range(1, n) if seg[k] >= seg[k - 1] - 0.15)
    mono = ups / (n - 1)
    d = F["drum_share"]
    dgain = (sum(d[max(i, j - 2):j]) / max(1, len(d[max(i, j - 2):j]))
             - sum(d[i:i + 2]) / max(1, len(d[i:i + 2])))
    cost = (1.2 - 0.55 * max(0.0, min(2.5, rise)) - 0.9 * mono
            - 1.2 * max(0.0, dgain) + 0.8 * (near / F["bar"]))
    return max(0.0, cost)


def decode(F, th):
    """Semi-Markov Viterbi over four-bar boundaries."""
    n = F["n"]
    # Four-bar multiples, plus the bar each drop or stop lands in. A build STARTS
    # on a four-bar line and ENDS where the record lands, and those are not the
    # same grid: Levels' drops sit on half bars -- which is the correction
    # listen/resnap.py recorded on this very song -- so with four-bar boundaries
    # alone the nearest legal end was 1.5 bars from the drop and the decode
    # found no builds at all on the song whose builds are most obvious.
    bounds = set(range(0, n, BAR_STEP))
    bounds.add(n)
    downs, bar = F["downbeats"], F["bar"]
    for x in F["lands"]:
        k = int(round((x - downs[0]) / bar))
        if 0 < k <= n:
            bounds.add(k)
    bounds = sorted(bounds)
    B = len(bounds)
    NEG = float("inf")
    best = [[NEG] * len(STATES) for _ in range(B)]
    back = [[None] * len(STATES) for _ in range(B)]
    for s in range(len(STATES)):
        best[0][s] = 0.0
    for bj in range(1, B):
        j = bounds[bj]
        for bi in range(bj):
            i = bounds[bi]
            bars = j - i
            for si, state in enumerate(STATES):
                dc = dur_cost(bars, state)
                if dc is None:
                    continue
                e = emit(F, th, i, j, state) + dc
                for sp in range(len(STATES)):
                    if best[bi][sp] == NEG:
                        continue
                    tc = TRANS[(STATES[sp], state)] if bi > 0 else 0.0
                    v = best[bi][sp] + tc + e
                    if v < best[bj][si]:
                        best[bj][si] = v
                        back[bj][si] = (bi, sp)
    end = min(range(len(STATES)), key=lambda s: best[B - 1][s])
    out, bj, s = [], B - 1, end
    while bj > 0 and back[bj][s] is not None:
        bi, sp = back[bj][s]
        out.append((bounds[bi], bounds[bj], STATES[s]))
        bj, s = bi, sp
    out.reverse()
    return out


def shape(seg):
    n = len(seg)
    if n < 3:
        return "steady", 0.0
    lo, hi = seg[0], seg[-1]
    if hi - lo <= 1e-9:
        return "steady", 0.0
    half = (seg[n // 2] - lo) / (hi - lo)
    jumps = sum(1 for k in range(1, n) if abs(seg[k] - seg[k - 1]) > 0.9)
    if jumps >= max(2, n // 3):
        return "stepped", jumps / (n - 1)
    if half < 0.34:
        return "late", 0.34 - half
    if half > 0.66:
        return "early", half - 0.66
    return "steady", 0.5 - abs(half - 0.5)


def analyse(slug, write=False):
    p = map_path(slug)
    if not p:
        return {"error": "no map"}
    m = json.load(open(p))
    F = features(m)
    if F is None:
        return {"error": "needs per-bar stem levels and at least 16 bars"}
    th = thickness(F)
    segs = decode(F, th)
    downs, bar = F["downbeats"], F["bar"]
    spans, kept = [], {"build": 0, "quiet": 0, "flat": 0}
    for i, j, state in segs:
        kept[state] += 1
        if state == "flat":
            continue
        end = downs[j] if j < len(downs) else downs[-1] + bar
        if state == "build" and F["lands"]:
            land = min(F["lands"], key=lambda x: abs(x - end))
            if abs(land - end) <= 0.75 * bar:
                end = land
        sp = {"kind": state,
              "from": round(downs[i], 6),
              "to": round(end, 6),
              "bars": j - i}
        if state == "build":
            sh, marg = shape(th[i:j])
            sp["rise"] = sh
            sp["rise_margin"] = round(marg, 3)
        spans.append(sp)
    spans.sort(key=lambda s: s["from"])
    m["spans"] = spans
    m.setdefault("observations", {})["spans_decode"] = {
        "how": "semi-Markov Viterbi over four-bar boundaries. States flat, build, quiet; "
               "duration prior cheapest at 8 and 16 bars, refused below 4 and above 32; "
               "transition costs make build->build expensive and build->flat free.",
        "features": "how many stems are within %.0f dB of their own 90th percentile (a "
                    "count), the share of bar energy held by anything that is not drums or "
                    "bass, the drums' own share, and chord changes per bar. None of these "
                    "is the energy curve, and two of them cannot move when the volume "
                    "does." % NEAR_TOP_DB,
        "not": "not derived from anything in this file a reader could read. The old spans "
               "were a greedy walk over `energy` and by rule 3 had no business being "
               "written down at all.",
        "provenance": "measured",
        "boundaries": "four-bar multiples, applied inside the decode rather than snapped "
                      "afterwards",
        "stems_used": F["present"],
        "segments": {"build": kept["build"], "quiet": kept["quiet"], "flat": kept["flat"]},
        "checked_against": "the energy composite of section 1a -- onset rate, high-band "
                           "onset rate and band occupancy on the raw mix -- with randomly "
                           "placed spans of the same durations as the control. Shares the "
                           "recording and no feature.",
    }
    if write:
        json.dump(m, open(p, "w"), indent=1, ensure_ascii=False)
        open(p, "a").write("\n")
    return {"slug": slug, "spans": spans, "counts": kept, "wrote": write}


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    for slug in args or ["levels", "starlight", "mizhiyoram", "dont-look-down", "the-nights"]:
        r = analyse(slug, write)
        if "error" in r:
            print("  %-16s %s" % (slug, r["error"]))
            continue
        print("  %-16s %d build, %d quiet, %d flat%s"
              % (slug, r["counts"]["build"], r["counts"]["quiet"], r["counts"]["flat"],
                 "  -> written" if write else ""))
        for s in r["spans"]:
            print("     %-6s %7.2f - %7.2f  %2d bars%s"
                  % (s["kind"], s["from"], s["to"], s["bars"],
                     "  rise " + s["rise"] if "rise" in s else ""))
