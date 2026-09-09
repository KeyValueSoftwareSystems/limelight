#!/usr/bin/env python3
"""stems.sources, in a unit that lets the six series be compared.

    $LIMELIGHT_PY_AUDIO listen/stemlevels.py [slug ...] [--write]

The old field was "RMS of each separated stem over one bar, NORMALISED PER
STEM". Every series therefore touched 1.0 at its own loudest bar, whatever that
bar sounded like. On Levels the piano stem -- which is separator noise, the
instrument is not in the record -- sat between 0.68 and 0.72 for the whole song
and so read louder than the drums for most of it. Starlight read as piano-led
for 43 bars from a stem 20 dB below the mix. A reader cannot recover the scale
that was divided out, so the file was carrying a number that looked like a
level and was not one.

Each bar is now the stem's RMS against the MIX's whole-song RMS, in dB. Same
grid, same rate, same field; a unit that means something across stems. "How far
above its own habit" is still available to a reader -- it is a percentile of
this series, and it is computed in readers/src/derive.js -- but it is derived
from a level rather than replacing it.

Presence is two absolute measurements and a bleed test, and no median anywhere:

  level        the stem's whole-song RMS against the mix's. An instrument that
               is not in the record still gets a stem; it comes out far down.
  movement     p95 - p05 of the per-bar level, in dB. A real part changes over
               a song. A noise floor does not, and that is what separated Levels'
               piano from its drums: 0.4 dB of movement against 24.
  bleed        the correlation of this stem's bar-to-bar shape with each LOUDER
               stem's. A quiet stem whose envelope tracks a loud one is that
               loud source leaking, not a second instrument.

A median presence gate would have failed all three ways at once: it asks whether
a bar is above the middle of its own series, which every series satisfies half
the time regardless of what is in it.
"""
import sys, os, json, math, glob

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from mapio import map_path, stems_dir

STEM_NAMES = ("vocals", "drums", "bass", "guitar", "piano", "other")
STEM_LATENCY_S = 0.025      # htdemucs output runs this far behind the mix; measured
SR = 22050

# Decided from the measurements printed by --survey, not chosen in advance.
FLOOR_DB = -35.0            # below this against the mix, nothing a reader should light
MOVE_DB = 3.0               # a part that never changes level over a whole song is not a part
BLEED_R = 0.90              # and is that shape simply a louder stem's shape?
BLEED_DB = -20.0            # only asked of stems this far down; a loud stem is not bleed


def load(path):
    import librosa
    y, _ = librosa.load(path, sr=SR, mono=True)
    return y


def bar_rms(y, edges):
    out = []
    n = len(y)
    for i in range(len(edges) - 1):
        a = int((edges[i] + STEM_LATENCY_S) * SR)
        b = int((edges[i + 1] + STEM_LATENCY_S) * SR)
        a, b = max(0, min(n, a)), max(0, min(n, b))
        if b <= a:
            out.append(0.0)
            continue
        s = 0.0
        for j in range(a, b):
            s += y[j] * y[j]
        out.append(math.sqrt(s / (b - a)))
    return out


def pct(a, q):
    if not a:
        return 0.0
    b = sorted(a)
    return b[max(0, min(len(b) - 1, int(q * (len(b) - 1))))]


def corr(a, b):
    n = min(len(a), len(b))
    if n < 3:
        return 0.0
    ma, mb = sum(a[:n]) / n, sum(b[:n]) / n
    va = sum((x - ma) ** 2 for x in a[:n])
    vb = sum((x - mb) ** 2 for x in b[:n])
    if va <= 0 or vb <= 0:
        return 0.0
    return sum((a[i] - ma) * (b[i] - mb) for i in range(n)) / math.sqrt(va * vb)


def db(x, ref):
    return round(20.0 * math.log10(max(1e-9, x) / max(1e-9, ref)), 2)


def analyse(slug, write=False):
    mp = map_path(slug)
    wav = os.path.join(ROOT, "synth", "out", slug + ".wav")
    sd = os.path.join(stems_dir(), slug)
    if not mp or not os.path.exists(wav):
        return {"error": "no map or no audio"}
    if not os.path.isdir(sd):
        return {"error": "no stems at " + sd}
    m = json.load(open(mp))
    downs = m.get("downbeats") or []
    if len(downs) < 4:
        return {"error": "no downbeats to measure bars against"}
    dur = (m.get("song") or {}).get("length") or downs[-1]
    bar = (downs[-1] - downs[0]) / max(1, len(downs) - 1)
    edges = list(downs) + [downs[-1] + bar]

    mix = load(wav)
    mix_ref = math.sqrt(sum(v * v for v in mix) / max(1, len(mix)))
    mix_bars = bar_rms(mix, edges)

    raw, order = {}, []
    for name in STEM_NAMES:
        hit = glob.glob(os.path.join(sd, name + ".*"))
        if not hit:
            continue
        y = load(hit[0])
        raw[name] = bar_rms(y, edges)
        order.append((math.sqrt(sum(v * v for v in y) / max(1, len(y))), name))
    if not raw:
        return {"error": "no stem files under " + sd}
    order.sort(reverse=True)

    louder_than = {name: [n for _, n in order[:i]] for i, (_, name) in enumerate(order)}
    levels, sources = {}, {}
    for _, name in order:
        series = raw[name]
        overall = math.sqrt(sum(v * v for v in series) / max(1, len(series)))
        d = [db(v, mix_ref) for v in series]
        p05, p95 = pct(d, 0.05), pct(d, 0.95)
        move = round(p95 - p05, 2)
        lvl = db(overall, mix_ref)
        bleeds = {n: round(corr(series, raw[n]), 3) for n in louder_than[name] if n in raw}
        worst = max(bleeds.items(), key=lambda kv: kv[1]) if bleeds else (None, 0.0)
        reasons = []
        if lvl < FLOOR_DB:
            reasons.append("%.1f dB below the mix -- the instrument is not in this record, "
                           "the separator emitted a stem anyway" % lvl)
        if move < MOVE_DB:
            reasons.append("its level moves %.1f dB across the whole song, which is a noise "
                           "floor rather than a part being played" % move)
        if lvl < BLEED_DB and worst[1] > BLEED_R:
            reasons.append("%.2f correlated with %s, which is louder -- this is that source "
                           "leaking, not a second instrument" % (worst[1], worst[0]))
        levels[name] = {
            "db_re_mix": lvl,
            "movement_db": move,
            "p05_db": p05, "p95_db": p95,
            "bleed_from_louder_stems": bleeds,
            "present": not reasons,
            "why_not": reasons or None,
        }
        sources[name] = [round(x, 2) for x in d]

    m["stems"] = {
        "model": (m.get("stems") or {}).get("model", "htdemucs_6s"),
        "rate": "per_downbeat",
        "unit": "dB of the stem's RMS over one bar, against the mix's whole-song RMS",
        "comparable": True,
        "note": __doc__.split("\n\n")[1].replace("\n", " "),
        "latency_correction_s": STEM_LATENCY_S,
        "thresholds": {"floor_db": FLOOR_DB, "movement_db": MOVE_DB,
                       "bleed_r": BLEED_R, "asked_below_db": BLEED_DB},
        "provenance": "measured",
        "levels": levels,
        "sources": sources,
        "mix_bar_level_db": [db(v, mix_ref) for v in mix_bars],
    }
    if write:
        json.dump(m, open(mp, "w"), indent=1, ensure_ascii=False)
        open(mp, "a").write("\n")
    return {"slug": slug, "bars": len(downs), "levels": levels, "wrote": write}


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    for slug in args or ["levels", "starlight", "mizhiyoram", "dont-look-down", "the-nights"]:
        r = analyse(slug, write)
        if "error" in r:
            print("  %-16s %s" % (slug, r["error"]))
            continue
        print("  %-16s %d bars" % (slug, r["bars"]))
        for n, L in r["levels"].items():
            b = L["bleed_from_louder_stems"]
            worst = max(b.items(), key=lambda kv: kv[1]) if b else ("-", 0.0)
            print("     %-7s %7.1f dB   moves %5.1f dB   worst bleed %s=%.2f   %s%s"
                  % (n, L["db_re_mix"], L["movement_db"], worst[0], worst[1],
                     "present" if L["present"] else "NOT PRESENT",
                     "" if L["present"] else " -- " + L["why_not"][0][:60]))
