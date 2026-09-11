#!/usr/bin/env python3
"""How close to silence it gets just before the payoff.

    python3 listen/prehush.py where-are-u-now --write

WHY. Two ways of scoring a build-into-drop were tried and both rank the same
arcs the same way: energy contrast across the payoff, and the change in accent
rate across it. Both measure HOW MUCH MORE HAPPENS AFTER. Neither measures the
silence before, and the silence is what a listener actually reacts to -- asked
which moment of Where Are U Now was worth building a film around, a person
picked the one both metrics rank third.

At 257.21 in that record everything except a low thud stops: mid band at 0.04 of
its peak, high at 0.01. The per-downbeat energy curve reads that whole stretch
as 0.593 because it samples once every 1.9 s and a 0.65 s hole vanishes into its
neighbours. The information was never in the map.

WHAT IT WRITES. For each drop and return, the deepest the mix gets in the 1.5 s
before it, as a fraction of the song's own median level. Low means a hole. It
goes in `observations`, which is append-only and which readers ignore when they
do not recognise it, because this is not one of the six moment kinds and has no
business pretending to be.
"""
import sys, os, json, wave, math, array

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "listen"))
from mapio import map_path

LOOK_BACK_S = 1.5
HOP_S = 0.02


def envelope(path):
    with wave.open(path, "rb") as w:
        sr, n, ch = w.getframerate(), w.getnframes(), w.getnchannels()
        raw = w.readframes(n)
    a = array.array("h"); a.frombytes(raw[:len(raw) - (len(raw) % 2)])
    if ch > 1: a = a[::ch]
    hop = max(1, int(sr * HOP_S))
    out = []
    for i in range(0, len(a) - hop, hop):
        acc = 0
        for v in a[i:i + hop]: acc += v * v
        out.append(math.sqrt(acc / hop))
    return out, HOP_S


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    if not args:
        print("usage: prehush.py <slug> [--write]", file=sys.stderr); return 2
    slug = args[0]
    p = map_path(slug)
    wav = os.path.join(ROOT, "synth", "out", slug + ".wav")
    if not p or not os.path.exists(wav):
        print("no map or no audio", file=sys.stderr); return 2
    m = json.load(open(p))
    env, dt = envelope(wav)
    if not env: return 2
    med = sorted(env)[len(env) // 2] or 1.0

    rows = []
    for mo in m.get("moments", []):
        if mo.get("kind") not in ("drop", "return"): continue
        i1 = int(mo["at"] / dt)
        i0 = max(0, int((mo["at"] - LOOK_BACK_S) / dt))
        if i1 - i0 < 3: continue
        lo = min(env[i0:i1])
        rows.append({"at": round(mo["at"], 3), "kind": mo["kind"],
                     "quietest_before": round(lo / med, 4),
                     "looked_back_s": LOOK_BACK_S})
    rows.sort(key=lambda r: r["quietest_before"])
    for r in rows:
        print(f"  {r['at']:8.2f}  {r['kind']:7s}  quietest before: "
              f"{r['quietest_before']:.3f} of the song's median")
    if write:
        obs = m.setdefault("observations", {})
        obs["prehush"] = {
            "how": ("deepest broadband level in the 1.5 s before each drop or "
                    "return, over the song's median level, at 20 ms resolution"),
            "why": ("the energy curve is sampled once a downbeat and cannot see a "
                    "hole shorter than a bar. Contrast and accent-rate both score "
                    "what happens AFTER a payoff; this is the silence before it, "
                    "which is the part a listener reacts to."),
            "events": rows}
        json.dump(m, open(p, "w"), indent=1, ensure_ascii=False)
        open(p, "a").write("\n")
        print(f"\n  written to {p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
