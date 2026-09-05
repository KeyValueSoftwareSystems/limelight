#!/usr/bin/env python3
"""Turn the per-bar stem levels into things a light reader can act on.

The map already knows how loud each instrument is in every bar. What it does not
say is the thing a lighting person actually cares about: WHEN the piano comes in,
when the vocal drops out, which instrument is carrying the song right now, and
whether a part is growing or fading. Those are all derivable from the series we
have, and none of them needs the stem audio we do not have.

Nothing here is invented. Every field is a function of stems.sources and the
downbeat times, and the note on each one says which.
"""
import sys, os, json

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def enrich(path):
    m = json.load(open(path))
    st = (m.get("stems") or {}).get("sources") or {}
    if not st:
        return None
    at = (m.get("stems") or {}).get("at") or m.get("downbeats") or []
    n = min(len(at), min(len(v) for v in st.values()))
    if n < 4:
        return None
    at = at[:n]

    parts = {}
    for name, ser in st.items():
        s = ser[:n]
        hi = max(s)
        if hi <= 0:
            continue
        # "in" means clearly present, "out" means clearly gone; the gap between the
        # two thresholds stops a wobble near the line producing dozens of fake cues
        on, off = 0.42 * hi, 0.26 * hi
        entries, exits, live = [], [], False
        for i, v in enumerate(s):
            if not live and v >= on:
                live = True; entries.append(round(at[i], 3))
            elif live and v <= off:
                live = False; exits.append(round(at[i], 3))
        # how much of the song it plays for, and where it is loudest
        span = sum(1 for v in s if v >= on) / n
        peak = at[s.index(hi)]
        parts[name] = {
            "enters": entries, "leaves": exits,
            "share_of_song": round(span, 3),
            "loudest_at": round(peak, 3),
            "level_per_bar": [round(v / hi, 4) for v in s],
        }

    # who is carrying the song in each bar, by the loudest stem that is not drums
    lead = []
    melodic = [k for k in st if k != "drums"]
    for i in range(n):
        best, bv = None, 0.0
        for k in melodic:
            v = st[k][i] / (max(st[k]) or 1)
            if v > bv:
                bv, best = v, k
        lead.append([round(at[i], 3), best, round(bv, 3)])

    # bars where the arrangement changes: an instrument arrives or leaves
    cues = []
    for name, p in parts.items():
        for t in p["enters"]:
            cues.append({"at": t, "what": name, "kind": "enters"})
        for t in p["leaves"]:
            cues.append({"at": t, "what": name, "kind": "leaves"})
    cues.sort(key=lambda c: c["at"])

    # how thick the arrangement is, which is not the same as how loud it is
    density = [[round(at[i], 3),
                round(sum(1 for k in st if st[k][i] >= 0.42 * (max(st[k]) or 1)) / len(st), 3)]
               for i in range(n)]

    m.setdefault("observations", {})["instruments"] = {
        "how": ("derived from stems.sources, which is htdemucs presence per bar. enters "
                "and leaves use two thresholds, 42% and 26% of that stem's own peak, so a "
                "level wobbling near one line does not produce a string of false cues. "
                "No new listening was done and no stem audio was used -- every number "
                "here is a function of the per-bar levels already in this file."),
        "rate": "per_downbeat",
        "parts": parts,
        "lead_per_bar": lead,
        "arrangement_cues": cues,
        "density_per_bar": density,
        "made_by": {"how": "model", "who": "synth/enrich.py",
                    "reproduce": f"python3 synth/enrich.py {os.path.basename(path)}"},
    }
    json.dump(m, open(path, "w"), indent=1)
    return {"parts": len(parts), "cues": len(cues), "bars": n,
            "detail": {k: (len(v["enters"]), len(v["leaves"]), v["share_of_song"])
                       for k, v in parts.items()}}


if __name__ == "__main__":
    for a in sys.argv[1:]:
        p = a if os.path.exists(a) else os.path.join(HERE, "truth", a + ".map.json")
        r = enrich(p)
        if not r:
            print(f"{a}: no stems to work from"); continue
        print(f"{a}: {r['bars']} bars, {r['parts']} instruments, {r['cues']} arrangement cues")
        for k, (e, x, s) in sorted(r["detail"].items()):
            print(f"    {k:8} enters {e:2d}x  leaves {x:2d}x  plays {s*100:4.0f}% of the song")
