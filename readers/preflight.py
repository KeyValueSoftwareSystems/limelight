#!/usr/bin/env python3
"""Before a single frame: can THIS reader, on THIS rig, carry THIS song?

A limit is only useful while there is still time to do something else. So this
runs before any frame is computed, and it answers one question per dimension the
song actually has -- not a fixed wishlist that every song gets asked.

Three files meet here and nowhere else:

    the song's dimensions   what it asks for, as a channel and a rate.
                            Names no reader, no rig, no fixture.
    the reader declaration  which channels I serve, and with which capability
                            words. readers/<reader>/reader.json.
    the layout              what units exist, what each one can do.

Because the join lives here, a new reader is a new directory and nothing
upstream moves. Lighting is the first reader, not the only one; readers/haptics
exists to prove that, and it fails on hue exactly as it should.

    python3 readers/preflight.py levels
    python3 readers/preflight.py levels --reader lights --rig small
"""
import sys, os, json, glob
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def readers():
    out = {}
    for p in sorted(glob.glob(os.path.join(HERE, "*", "reader.json"))):
        d = json.load(open(p))
        d["_dir"] = os.path.dirname(p)
        out[d["reader"]] = d
    return out


def layouts_for(rd):
    """A reader keeps its rigs beside it: either <dir>/layout.json for a reader
    with one rig, or <dir>/<rig>/layout.json for a reader with several."""
    out, seen = {}, set()
    for pat in ("layout.json", os.path.join("*", "layout.json")):
        for p in sorted(glob.glob(os.path.join(rd["_dir"], pat))):
            rp = os.path.realpath(p)
            if rp in seen: continue
            seen.add(rp)
            try: d = json.load(open(p))
            except Exception: continue
            if d.get("fixtures"):
                out[d.get("room") or os.path.basename(os.path.dirname(p))] = d
    return out


def having(lay, cap):
    return [f for f in lay["fixtures"] if cap in (f.get("can") or [])]


def kinds_of(fx):
    c = Counter(f.get("kind") for f in fx)
    return ", ".join(f"{n} {k}" for k, n in c.most_common(3))


def spread_of(fx):
    xs = [f["at"][0] for f in fx if f.get("at")]
    return (max(xs) - min(xs)) if len(xs) > 1 else 0.0


def gesture(lay, g, bar_s, dim, out_hz):
    """Can this rig make this one gesture? Returns yes / no / unknown."""
    if g.get("timing"):
        frame = 1000.0 / out_hz
        sw = (dim.get("detail") or {}).get("swing_ms")
        if sw is None:
            return "unknown", "this song states no groove"
        if sw < frame:
            return "no", (f"the groove is {sw:.0f} ms and one frame at {out_hz:.0f} Hz "
                          f"is {frame:.1f} ms -- {sw/frame:.1f} frames, it cannot be sent")
        return "yes", (f"groove {sw:.0f} ms against a {frame:.1f} ms frame, "
                       f"{sw/frame:.1f} frames wide")
    if g.get("kind"):
        have = [f for f in lay["fixtures"] if f.get("kind") == g["kind"]]
        return ("yes" if len(have) >= g["n"] else "no"), f"{len(have)} {g['kind']}"
    have = having(lay, g["cap"])
    if len(have) < g["n"]:
        return "no", f"{len(have)} units can {g['cap']}, needs {g['n']}"
    if g.get("spread"):
        w, room = spread_of(have), (lay.get("size_m") or {}).get("w", 0)
        if room and w < room * 0.35:
            return "no", (f"{len(have)} can {g['cap']} but span {w:.1f} m of a "
                          f"{room:.1f} m room -- not a row")
    if g.get("motor"):
        lim = (lay.get("limits") or {}).get("max_pan_per_s")
        if not lim:
            return "unknown", f"{len(have)} can move, but the layout states no max_pan_per_s"
        reach, widest = lim * bar_s, 0.62
        if reach < widest:
            return "no", (f"{len(have)} can move but cover {reach:.2f} of range in a bar, "
                          f"and the fan is {widest:.2f} wide")
        return "yes", (f"{len(have)} can move ({kinds_of(have)}); a bar gives {reach:.2f} "
                       f"against {widest:.2f} needed, {reach/widest:.1f}x headroom")
    return "yes", f"{len(have)} can {g['cap']} ({kinds_of(have)})"


def channel_verdict(rd, lay, ch, dim, bar_s, out_hz):
    s = (rd.get("serves") or {}).get(ch)
    if s is None:
        return "no", f"this reader does not know the channel {ch}", []
    if not s.get("via"):
        return "no", s.get("cannot") or f"this reader cannot serve {ch}", []
    gs = s.get("gestures") or []
    if not gs:
        return "yes", s.get("note") or f"served by {'/'.join(s['via'])}", []
    res = [(g, *gesture(lay, g, bar_s, dim, out_hz)) for g in gs]
    ok = [r for r in res if r[1] == "yes"]
    if ok:
        return "yes", f"{len(ok)} of {len(res)} ways work -- {ok[0][2]}", res
    unk = [r for r in res if r[1] == "unknown"]
    if unk:
        return "unknown", unk[0][2], res
    return "no", res[0][2], res


def rate_note(dim, out_hz):
    """Dimensions have rates; an output chain has a rate ceiling. Matching them
    is arithmetic, and it is the cheapest check in the whole system."""
    r = dim.get("rate_hz")
    if r is None: return None
    if r > out_hz:
        return f"asks {r:.2f}/s but the chain runs {out_hz:.0f}/s -- impossible"
    usable = (dim.get("detail") or {}).get("usable_rate_hz")
    if usable and r > usable * 1.5:
        return (f"asks {r:.2f}/s but a room only reads this {usable:.2f}/s "
                f"-- send about 1 in {r/usable:.0f}")
    return None


def dimensions_of(m, slug):
    """Renjith's call, 8 Sept: the dimensions ride inside the score file for now.
    They live at observations.dimensions -- the append-only tier -- so a reader
    that does not know them ignores them and no interface door was opened.

    Read the map first, because that is the writer. The standalone file under
    synth/dimensions/ is a projection kept for people who want to eyeball one,
    and it is only used when a map predates the merge."""
    obs = (m.get("observations") or {}).get("dimensions")
    if obs and obs.get("entries"):
        stale = False
        try:
            sys.path.insert(0, os.path.join(HERE, "lights"))
            from dimensions_json import body_hash
            stale = bool(obs.get("of_map")) and body_hash(m) != obs["of_map"]
        except Exception:
            pass
        return obs["entries"], "the map, observations.dimensions", stale
    dp = os.path.join(ROOT, "synth", "dimensions", slug + ".dimensions.json")
    if os.path.exists(dp):
        return json.load(open(dp))["dimensions"], "the standalone projection", False
    return None, None, False



def run(slug, only_reader=None, only_rig=None):
    sys.path.insert(0, os.path.join(HERE, "lights"))
    from dimensions_json import map_path      # one resolver, so the enricher and
    mp = map_path(slug)                       # the pre-flight cannot disagree
    if not mp:
        print(f"no map for {slug}"); return
    m = json.load(open(mp))
    dims, where, stale = dimensions_of(m, slug)
    if dims is None:
        print(f"{slug}: the map carries no dimensions, and no projection exists.\n"
              f"  run: python3 readers/lights/dimensions_json.py {slug}")
        return
    bar_s = m["grid"]["period"] * 4
    print(f"{slug}: {m['grid']['bpm']:.1f} bpm, one bar is {bar_s:.3f} s, "
          f"{len(dims)} dimensions to carry\n  map: {os.path.relpath(mp, ROOT)}"
          f"   dimensions: {where}")
    if stale:
        print("  ! the map has changed since these dimensions were written.\n"
              f"  ! rerun: python3 readers/lights/dimensions_json.py {slug}")
    print()

    for rname, rd in readers().items():
        if only_reader and rname != only_reader: continue
        for lname, lay in layouts_for(rd).items():
            if only_rig and lname != only_rig: continue
            out_hz = (lay.get("limits") or {}).get(
                "output_hz", rd.get("default_output_hz", 44.0))
            rows = []
            for d in dims:
                chs = d["channel"].split("+")
                vs = [channel_verdict(rd, lay, c, d, bar_s, out_hz) for c in chs]
                worst = ("no" if any(v[0] == "no" for v in vs)
                         else "unknown" if any(v[0] == "unknown" for v in vs) else "yes")
                why = next((v[1] for v in vs if v[0] == worst), "")
                rows.append((d, worst, why, rate_note(d, out_hz)))
            yes = sum(1 for _, v, _, _ in rows if v == "yes")
            print(f"  {rname}/{lname}   {len(lay['fixtures'])} units   "
                  f"{out_hz:.0f} Hz   {yes}/{len(rows)} dimensions carried")
            for d, v, why, rn in rows:
                mark = {"yes": "  ok ", "no": "  NO ", "unknown": "  ?  "}[v]
                print(f"  {mark} {d['key']:9} {d['channel']:18} {why}")
                if rn: print(f"        {'':9} {'':18} rate: {rn}")
            print()


def plan(slug, reader="lights", rig=None):
    """The same answer run() prints, as a document an application can hold.

    run() writes for a person standing at a rig. This writes for software that
    has to decide what to do about it, and it deliberately calls the same
    helpers -- if the two ever disagree, that is the bug, not a difference of
    opinion.

    The one thing added here is the outcome, which run() leaves implicit across
    a verdict and a rate note. Three outcomes, because two were never enough:
    a field FITS, or it is SMOOTHED down to what the room can actually read, or
    it is UNPAYABLE. A curve may be smoothed; a moment may not, because you
    either land the drop or you do not.

    The identifier is a hash of what went in -- the map, the dimensions, the
    reader and the rig -- so two identical rigs produce the same plan, nothing
    here holds a session, and a plan a client already has keeps working when
    the network does not."""
    import hashlib
    sys.path.insert(0, os.path.join(HERE, "lights"))
    from dimensions_json import map_path
    mp = map_path(slug)
    if not mp:
        return {"error": f"no map for {slug}"}
    m = json.load(open(mp))
    dims, where, stale = dimensions_of(m, slug)
    if dims is None:
        return {"error": f"{slug} carries no dimensions",
                "how": f"python3 readers/lights/dimensions_json.py {slug}"}
    rds = readers()
    rd = rds.get(reader)
    if rd is None:
        return {"error": f"no reader {reader}", "known": sorted(rds)}
    lays = layouts_for(rd)
    if rig is None:
        rig = sorted(lays)[0] if lays else None
    lay = lays.get(rig)
    if lay is None:
        return {"error": f"{reader} has no rig {rig}", "known": sorted(lays)}

    g = m["grid"]
    bar_s = g["period"] * 4
    out_hz = (lay.get("limits") or {}).get(
        "output_hz", rd.get("default_output_hz", 44.0))

    fields = []
    for d in dims:
        chs = d["channel"].split("+")
        vs = [channel_verdict(rd, lay, c, d, bar_s, out_hz) for c in chs]
        verdict = ("no" if any(v[0] == "no" for v in vs)
                   else "unknown" if any(v[0] == "unknown" for v in vs) else "yes")
        why = next((v[1] for v in vs if v[0] == verdict), "")
        rn = rate_note(d, out_hz)
        rate = d.get("rate_hz")
        usable = (d.get("detail") or {}).get("usable_rate_hz")
        kind = "moment" if not rate else "curve"

        every_nth = None
        if verdict == "no" or (rn and "impossible" in rn):
            outcome = "unpayable"
        elif rn and usable and rate:
            # A moment cannot be thinned -- you either land the drop or you do
            # not -- so a rate it cannot meet is a refusal, not a compromise.
            if kind == "moment":
                outcome = "unpayable"
            else:
                outcome = "smoothed"
                every_nth = max(2, round(rate / usable))
        else:
            outcome = "fits"

        fields.append({
            "key": d["key"], "channel": d["channel"], "kind": kind,
            "rate_hz": rate, "readable_rate_hz": usable,
            "outcome": outcome, "every_nth": every_nth,
            "verdict": verdict, "why": why, "rate_note": rn,
            "trust": d.get("trust"), "from": d.get("from"),
        })

    seed = "|".join([slug, reader, rig,
                     hashlib.sha256(open(mp, "rb").read()).hexdigest()[:16],
                     json.dumps([f["key"] for f in fields], sort_keys=True)])
    pid = "pl_" + hashlib.sha256(seed.encode()).hexdigest()[:6]

    return {
        "plan": pid, "song": slug, "reader": reader, "rig": rig,
        "map": os.path.relpath(mp, ROOT), "dimensions_from": where, "stale": stale,
        "grid": {"bpm": g["bpm"], "beats_per_bar": g.get("beats_per_bar", 4),
                 "beat_seconds": g["period"], "bar_seconds": bar_s,
                 "first_beat_s": g.get("phase", 0.0)},
        "output_hz": out_hz, "units": len(lay["fixtures"]),
        "carried": sum(1 for f in fields if f["outcome"] != "unpayable"),
        "of": len(fields),
        "fields": fields,
    }


def main():
    a = sys.argv[1:]
    slug = a[0] if a and not a[0].startswith("-") else "levels"
    g = lambda f: a[a.index(f) + 1] if f in a else None
    run(slug, g("--reader"), g("--rig"))


if __name__ == "__main__":
    main()
