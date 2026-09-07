#!/usr/bin/env python3
"""Are the dimensions we chose the right ones? Two tests the map can answer.

A dimension list is an architecture decision -- it is the contract between whoever
produces maps and whoever builds rigs -- so it should be argued from evidence
rather than from taste. Two things are measurable without any new listening.

INDEPENDENCE. If two dimensions move together in every song they are one
dimension wearing two names, and keeping both means the rig gets told the same
thing twice while something else goes unsaid. Correlate them per bar.

NOVELTY. How much of a song repeats, and where it genuinely changes. This is the
one nothing in the map records, and it is the answer to "the show feels
repetitive" -- a show should repeat where the song repeats and change where it
changes, and right now it cannot know which is which.

    python3 listen/dimaudit.py levels the-nights
"""
import sys, os, json, math

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def per_bar(slug):
    p = os.path.join(ROOT, "synth", "truth", slug + ".map.json")
    if not os.path.exists(p):
        p = os.path.join(ROOT, "synth", "songs", slug + ".map.json")
    d = json.load(open(p))
    g = d["grid"]; per = g["period"]; bar = per * 4; ph = g["phase"]
    nb = int((d["song"]["length"] - ph) / bar)
    obs = d.get("observations") or {}
    inst = obs.get("instruments") or {}
    parts = inst.get("parts") or {}
    S = {k: [0.0] * nb for k in
         ("energy", "density", "hits", "harmony", "pitch", "vocal", "bass")}

    def idx(t):
        i = int((t - ph) / bar)
        return i if 0 <= i < nb else None

    for t, v in (d.get("energy") or []):
        i = idx(t)
        if i is not None: S["energy"][i] = v
    for t, v in (inst.get("density_per_bar") or []):
        i = idx(t)
        if i is not None: S["density"][i] = v
    for e in ((d.get("accents") or {}).get("events") or []):
        i = idx(e["at"])
        if i is not None: S["hits"][i] += 1
    ch = (obs.get("chords") or {}).get("events") or []
    for k in range(1, len(ch)):
        if ch[k]["chord"] != ch[k - 1]["chord"]:
            i = idx(ch[k]["at"])
            if i is not None: S["harmony"][i] = 1
    acc = {}
    for e in ((obs.get("melody") or {}).get("notes") or []):
        if e and len(e) >= 3:
            i = idx(e[0])
            if i is not None: acc.setdefault(i, []).append(e[2])
    for i, v in acc.items(): S["pitch"][i] = sum(v) / len(v)
    for name, key in (("vocals", "vocal"), ("bass", "bass")):
        v = (parts.get(name) or {}).get("level_per_bar") or []
        for i, x in enumerate(v[:nb]): S[key][i] = x
    return {k: v for k, v in S.items() if any(v)}, nb, d


def corr(a, b):
    n = len(a); ma = sum(a) / n; mb = sum(b) / n
    sxy = sxx = syy = 0.0
    for x, y in zip(a, b):
        p, q = x - ma, y - mb
        sxy += p * q; sxx += p * p; syy += q * q
    return sxy / math.sqrt(sxx * syy) if sxx > 1e-12 and syy > 1e-12 else 0.0


def main():
    for slug in (sys.argv[1:] or ["levels"]):
        S, nb, d = per_bar(slug)
        ks = sorted(S)
        print(f"\n{slug}: {nb} bars, {len(ks)} candidate dimensions")
        print("  independence -- pairs that move together are one dimension, not two")
        dup = []
        for i, a in enumerate(ks):
            for b in ks[i + 1:]:
                r = corr(S[a], S[b])
                if abs(r) > 0.7: dup.append((a, b, r))
        for a, b, r in dup:
            print(f"     {a} and {b}: {r:+.2f}   <-- collapse or rotate")
        if not dup:
            print("     none; every pair carries something the others do not")

        F = [[S[k][i] for k in ks] for i in range(nb)]
        dist = lambda x, y: math.sqrt(sum((p - q) ** 2 for p, q in zip(x, y)))
        nov = [0.0] * nb
        for i in range(4, nb):
            nov[i] = min(dist(F[i], F[j]) for j in range(max(0, i - 64), i - 3))
        lo, hi = min(nov[4:]), max(nov[4:]); rng = (hi - lo) or 1
        same = sum(1 for v in nov[4:] if (v - lo) / rng < 0.2)
        print(f"  novelty -- {same} of {nb-4} bars are near-identical to an earlier bar "
              f"({100*same/(nb-4):.0f}%)")
        per, ph = d["grid"]["period"], d["grid"]["phase"]
        chs = d.get("chapters") or []
        top = sorted(range(4, nb), key=lambda i: -nov[i])[:6]
        miss = 0
        for i in sorted(top):
            t = ph + i * per * 4
            near = min(((abs(c["at"] - t), c["name"]) for c in chs), default=(99, "-"))
            if near[0] >= 3:
                miss += 1
                print(f"     bar {i:3d} at {t:6.1f}s changes hard and NOTHING in the map marks it")
        if not miss:
            print("     every big change is already marked")


if __name__ == "__main__":
    main()
