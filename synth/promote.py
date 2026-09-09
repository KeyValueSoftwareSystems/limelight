#!/usr/bin/env python3
"""Pick the best score for each song and keep it, so nobody starts from nothing.

Renjith, 9 Sept: "auto promote the best one and keep it within the repo so that
everyone has a baseline on where they start."

The trap, and we have evidence for it from last night: TOTAL SCORE IS NOT ENOUGH.
Amal's map scored 0.89 -- the highest any map had reached -- and rendered a
visibly worse show than a map scoring 0.66, because its drops were a second late
and nothing in the scorer was looking at moments. Promoting on total alone would
have installed the worse map as everyone's baseline and we would have spent days
building on it.

So promotion has three gates, and a map must pass all three:

  1  the grid gate must be open.      A map that cannot find the beat has
                                      described nothing; the scorer already
                                      collapses it to 0.00.
  2  moments must not be broken.      This is the field that predicts the show.
                                      A late drop is the most expensive error a
                                      map can make and the cheapest to miss.
  3  it must beat the incumbent.      By a margin, so noise in the scorer does
                                      not shuffle the baseline every night.

Nothing is overwritten. Each promotion appends to synth/best/<song>.why.json with
the scorer's own fingerprint, so a promotion can be read, argued with, and undone.

    python3 synth/promote.py              every song
    python3 synth/promote.py levels       one
    python3 synth/promote.py --dry        say what would happen
"""
import sys, os, json, glob, hashlib, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "listen"))
import mapeval as M

BEST = os.path.join(ROOT, "synth", "best")
MOMENTS_FLOOR = 0.35     # below this the drops are wrong enough to ruin a show
MARGIN = 0.02            # must beat the incumbent by this much


def scorer_fingerprint():
    """Which scorer said so. A baseline promoted by a scorer nobody can identify
    is a number without provenance, which is the thing this project exists to
    avoid."""
    h = hashlib.sha256()
    for f in ("mapeval.py", "metaeval.py"):
        p = os.path.join(ROOT, "listen", f)
        if os.path.exists(p): h.update(open(p, "rb").read())
    return h.hexdigest()[:12]


def candidates(slug):
    out = []
    for p in glob.glob(os.path.join(ROOT, "synth", "maps", "*", slug + ".map.json")):
        who = os.path.basename(os.path.dirname(p))
        if who.startswith("_"):            # _broken-* are falsification fixtures
            continue
        out.append((who, p))
    for extra in (("truth", os.path.join(ROOT, "synth", "truth", slug + ".map.json")),):
        if os.path.exists(extra[1]): out.append(extra)
    return out


def run(slug, dry=False):
    cands = candidates(slug)
    if not cands:
        print(f"  {slug}: no candidates"); return
    rows = []
    for who, p in cands:
        r = M.evaluate(slug, p)
        if "error" in r:
            rows.append((who, p, None, r["error"])); continue
        f = r["fields"]
        mo = f.get("moments", {}).get("score")
        rows.append((who, p, r, {"total": r["total"], "gate": r["grid_gate"],
                                 "moments": mo}))
    rows = [x for x in rows if isinstance(x[3], dict)]
    if not rows:
        print(f"  {slug}: nothing scoreable"); return
    rows.sort(key=lambda x: -x[3]["total"])

    print(f"\n  {slug}")
    for who, p, r, d in rows:
        mo = d["moments"]
        why = []
        if d["gate"] < 1.0: why.append("grid gate")
        if mo is not None and mo < MOMENTS_FLOOR: why.append(f"moments {mo:.2f}")
        if mo is None: why.append("no moments claimed")
        print(f"    {d['total']:.3f}  gate {d['gate']:.2f}  "
              f"moments {('%.2f' % mo) if mo is not None else ' -- '}  {who:16}"
              + ("   BLOCKED: " + ", ".join(why) if why else "   eligible"))

    ok = [x for x in rows if x[3]["gate"] >= 1.0
          and x[3]["moments"] is not None and x[3]["moments"] >= MOMENTS_FLOOR]
    if not ok:
        print(f"    -> nothing qualifies. The best total is "
              f"{rows[0][3]['total']:.3f} but it fails a gate, and installing it "
              f"as the baseline would spread the fault.")
        return
    win_who, win_p, win_r, win_d = ok[0]

    os.makedirs(BEST, exist_ok=True)
    whyp = os.path.join(BEST, slug + ".why.json")
    hist = json.load(open(whyp)) if os.path.exists(whyp) else []
    cur = hist[-1]["total"] if hist else None
    if cur is not None and win_d["total"] < cur + MARGIN:
        print(f"    -> keeping {hist[-1]['from']} at {cur:.3f}; "
              f"{win_who} at {win_d['total']:.3f} does not beat it by {MARGIN}")
        return
    print(f"    -> promote {win_who} at {win_d['total']:.3f}"
          + (f" (was {cur:.3f})" if cur is not None else ""))
    if dry: return
    json.dump(json.load(open(win_p)),
              open(os.path.join(BEST, slug + ".map.json"), "w"), indent=1)
    hist.append({"when": datetime.datetime.now().isoformat(timespec="seconds"),
                 "from": win_who, "path": os.path.relpath(win_p, ROOT),
                 "total": round(win_d["total"], 4),
                 "moments": round(win_d["moments"], 4),
                 "grid_gate": win_d["gate"],
                 "scorer": scorer_fingerprint(),
                 "gates": {"moments_floor": MOMENTS_FLOOR, "margin": MARGIN}})
    json.dump(hist, open(whyp, "w"), indent=1)


if __name__ == "__main__":
    dry = "--dry" in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    songs = args or sorted({os.path.basename(p).replace(".map.json", "")
                            for p in glob.glob(os.path.join(ROOT,"synth","maps","*","*.map.json"))})
    songs = [s for s in songs if os.path.exists(os.path.join(ROOT,"synth","out",s+".wav"))]
    print(f"  scorer {scorer_fingerprint()}   moments floor {MOMENTS_FLOOR}   margin {MARGIN}")
    for s in songs: run(s, dry)
    print()
