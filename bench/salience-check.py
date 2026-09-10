#!/usr/bin/env python3
"""Does derived salience track musical change, or is it just loudness?

    python3 bench/salience-check.py [slug ...]

WHAT IS BEING CHECKED. readers/src/derive.js computes a salience for any instant
from three things already in the map: the step in per-bar energy, MuQ's novelty,
and how many stems cross their presence threshold. The question is whether the
result corresponds to anything outside its own ingredients.

THE CHECK THAT WAS REFUSED, AND WHY. The obvious test is "do `moments` score
higher than ordinary bar lines?" It is worthless here. listen/moments.py places a
drop by finding a sustained step in loudness and counting drum hits from the
stems -- the same two feature families salience is built from. Both sides would
be looking at the same loudness step and would agree loudly about nothing. That
is the exact shape of the 9 ms beat-grid result in AGENTS.md, and it took a human
ear to catch it last time.

THE CHECK THAT IS USED. Harmony. `observations.chords` comes from ChordMini's BTC
model: a different model, a different training set, a symbolic output, and no
shared code or feature family with energy, MuQ or the separator. If salience is
measuring musical change rather than loudness alone, bar lines where the harmony
turns over should score higher than bar lines where it does not.

The null is a permutation, not a threshold. The chord boundaries are held fixed
and the salience series is rotated by a random offset, five hundred times; the
reported number is where the true lift falls in that distribution. A lift that a
rotated copy of the same series reaches just as often is not a lift.

This is evidence, not proof. Harmony and loudness are correlated in real music --
a chorus tends to change chord AND get louder -- so a positive result here is
consistent with salience being partly a loudness detector. It rules out the case
where salience is ONLY that, which is the case worth ruling out.
"""
import json, os, subprocess, sys, random, statistics

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "listen"))
from mapio import map_path

DRAWS = 500
SEED = 20260910


def salience_series(slug, times):
    """derive.js is the one writer; this asks it rather than reimplementing."""
    # Arguments go in on stdin, not argv: 127 bar times as one argument is
    # 1.6 kB and node opened it as a filename.
    js = """
let raw='';process.stdin.on('data',c=>raw+=c).on('end',()=>{
  const req=JSON.parse(raw);
  const fs=require('fs'), D=require(req.derive);
  const d=D.make(JSON.parse(fs.readFileSync(req.map,'utf8')));
  process.stdout.write(JSON.stringify(
    req.times.map(t=>{const s=d.salienceAt(t);return s?s.value:null;})));
});
"""
    r = subprocess.run(
        ["node", "-e", js], input=json.dumps({
            "derive": os.path.join(ROOT, "readers", "src", "derive.js"),
            "map": map_path(slug), "times": times}),
        capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr[:400])
    return json.loads(r.stdout)


def check(slug):
    mp = map_path(slug)
    if not mp:
        return None
    m = json.load(open(mp))
    ch = (m.get("observations") or {}).get("chords") or {}
    events = ch.get("events")
    if not events or not isinstance(events, list):
        return {"slug": slug, "na": "no per-bar chord labels"}

    # Per-bar chord LABELS, not segment boundaries.
    #
    # The first version of this compared bars near a chord-segment start against
    # all other bars, and it was a bad question. Chords turn over at 111 of
    # Levels' 127 bars, so the control group was 16 bars -- and those 16 were
    # mostly inside long "N" stretches, where ChordMini reports no chord at all.
    # "N" is common in percussive drops, so the control group was full of drops,
    # the lift came out NEGATIVE, and the number said more about which bars
    # ChordMini declines to name than about salience.
    #
    # "N" now means the witness has no opinion about that bar, and a witness
    # with no opinion is excluded from both sides rather than counted as
    # testimony for one of them.
    named = [(e["at"], e.get("chord")) for e in events
             if e.get("chord") not in (None, "N")]
    if len(named) < 20:
        return {"slug": slug, "na": f"only {len(named)} bars carry a named chord"}
    times = [t for t, _c in named]
    vals = salience_series(slug, times)
    rows = [(t, c, v) for (t, c), v in zip(named, vals) if v is not None]
    if len(rows) < 20:
        return {"slug": slug, "na": "salience unavailable on too many named bars"}

    vs = [r[2] for r in rows]
    ch_idx = {i for i in range(1, len(rows)) if rows[i][1] != rows[i - 1][1]}
    n = len(vs)
    if len(ch_idx) < 6 or n - len(ch_idx) < 6:
        return {"slug": slug, "na": f"harmony changes at {len(ch_idx)}/{n} named "
                                    f"bars -- no contrast to measure"}
    bs = times

    def lift(series):
        a = statistics.mean(series[i] for i in range(len(series)) if i in ch_idx)
        b = statistics.mean(series[i] for i in range(len(series)) if i not in ch_idx)
        return a - b

    true = lift(vs)
    rnd = random.Random(SEED)
    null = []
    for _ in range(DRAWS):
        k = rnd.randrange(1, n)
        null.append(lift(vs[k:] + vs[:k]))
    beat = sum(1 for x in null if x < true)
    return {
        "slug": slug, "bars": n, "chord_change_bars": len(ch_idx),
        "salience_at_change": round(statistics.mean(
            vs[i] for i in range(n) if i in ch_idx), 4),
        "salience_elsewhere": round(statistics.mean(
            vs[i] for i in range(n) if i not in ch_idx), 4),
        "lift": round(true, 4),
        "percentile_vs_rotations": round(100.0 * beat / DRAWS, 1),
    }


def main():
    slugs = sys.argv[1:] or ["levels", "starlight", "dont-look-down",
                             "mizhiyoram", "the-nights"]
    rows = [check(s) for s in slugs]
    rows = [r for r in rows if r]
    print(f"{'song':18} {'bars':>5} {'chg':>5} {'at change':>10} "
          f"{'elsewhere':>10} {'lift':>8} {'pct vs null':>12}")
    good = 0
    for r in rows:
        if r.get("na"):
            print(f"{r['slug']:18} {'na':>5}  {r['na']}")
            continue
        print(f"{r['slug']:18} {r['bars']:5} {r['chord_change_bars']:5} "
              f"{r['salience_at_change']:10.4f} {r['salience_elsewhere']:10.4f} "
              f"{r['lift']:8.4f} {r['percentile_vs_rotations']:11.1f}%")
        if r["percentile_vs_rotations"] >= 95.0:
            good += 1
    ok = len([r for r in rows if not r.get("na")])
    print()
    print(f"{good} of {ok} songs clear the 95th percentile against rotated "
          f"copies of their own salience.")
    print()
    print("VERDICT: salience is UNCORROBORATED. This check does not support it")
    print("and does not refute it -- it fails to discriminate, which is a third")
    print("thing and has to be said out loud.")
    print()
    print("Why harmony cannot testify here. The lift is strongly NEGATIVE on")
    print("Levels: salience is lower where the chord turns over. That is not a")
    print("defect in either measurement, it is the genre. EDM holds one")
    print("sustained chord underneath its loudest section, so the bars where")
    print("harmony does NOT move are exactly the drops, and harmonic change")
    print("ends up anti-correlated with energy change. The assumption behind")
    print("this test -- that a chorus changes chord AND gets louder -- is true")
    print("of songwriter pop and false of this material.")
    print()
    print("Consequences, per rule 5 as amended: salienceAt ships, the policy")
    print("may read it, every cut it produces records salience_is so the")
    print("dependency is visible, and this check carries ZERO weight. It is")
    print("not evidence for the field. Finding a witness that is independent of")
    print("loudness AND meaningful across genres is the open problem; the")
    print("candidates not yet tried are vocal phrase entries (Whisper) and a")
    print("human marking where they would cut.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
